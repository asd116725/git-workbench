import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { findWorktree, useWorkbench } from './store';
import { useHistory } from './history-store';
import type { NativeRepository } from './native-git';
import type { GitRemoteResult } from './types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));

const metadata = { path: '/test/remote', name: 'remote', branch: 'main', detached: false, bare: false, isMain: true, locked: null, prunable: null, available: true };
const initial: NativeRepository = {
  path: metadata.path, name: metadata.name, branch: metadata.branch, commonDir: `${metadata.path}/.git`,
  repositoryName: 'remote', worktrees: [metadata], hasHead: true, operation: null, files: [],
  remote: { remotes: ['origin'], upstream: 'origin/main', upstreamRemote: 'origin', upstreamBranch: 'main', defaultRemote: 'origin', ahead: 3, behind: 0 },
};
const mockedInvoke = vi.mocked(invoke);
let repository: NativeRepository;

function currentWorktree() {
  const state = useWorkbench.getState();
  return findWorktree(state.repositories, state.activeWorktreeId)!;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function reply(command: string) {
  if (command === 'git_open' || command === 'git_status') return repository;
  if (command === 'git_branches') return [];
  if (command === 'git_history_ref') return { oid: null };
  if (command === 'git_commit') return { commitId: 'new-commit' };
  if (command === 'git_diff') return { original: 'before', modified: 'after', notice: null };
  if (['git_fetch', 'git_pull', 'git_push'].includes(command)) return { warning: null };
}

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true);
  useWorkbench.getState().reset();
  useHistory.getState().reset();
  repository = { ...initial, remote: { ...initial.remote } };
  mockedInvoke.mockReset();
  mockedInvoke.mockImplementation(reply);
});

describe('远程操作与状态刷新', () => {
  it.each(['fetch', 'pull', 'push'] as const)('%s 调用真实接口并刷新计数、分支和已打开的历史，保留草稿', async action => {
    await useWorkbench.getState().openRepository(repository.path);
    useWorkbench.getState().setDraft({ message: '保留草稿' });
    await useHistory.getState().ensure(currentWorktree());
    mockedInvoke.mockClear();
    repository = { ...repository, remote: { ...repository.remote, ahead: 0 } };
    await expect(useWorkbench.getState().runRemote(action)).resolves.toEqual({ warning: null });
    expect(mockedInvoke).toHaveBeenCalledWith(`git_${action}`, action === 'push' ? { repoPath: repository.path, remote: null } : { repoPath: repository.path });
    expect(mockedInvoke).toHaveBeenCalledWith('git_status', { repoPath: repository.path });
    expect(mockedInvoke).toHaveBeenCalledWith('git_branches', { repoPath: repository.path });
    expect(mockedInvoke).toHaveBeenCalledWith('git_history_ref', { repoPath: repository.path, reference: null });
    expect(currentWorktree().remote?.ahead).toBe(0);
    expect(useWorkbench.getState().drafts[currentWorktree().id].message).toBe('保留草稿');
    expect(useWorkbench.getState()).toMatchObject({ busy: false, remoteOperation: null });
  });

  it('无上游时传递用户选定的远程，读取建立后的跟踪信息', async () => {
    repository = { ...repository, remote: { remotes: ['backup', 'team'], upstream: null, upstreamRemote: null, upstreamBranch: null, defaultRemote: null, ahead: null, behind: null } };
    await useWorkbench.getState().openRepository(repository.path);
    repository = { ...repository, remote: { ...repository.remote, upstream: 'team/main', upstreamRemote: 'team', upstreamBranch: 'main', defaultRemote: 'team', ahead: 0, behind: 0 } };
    await useWorkbench.getState().runRemote('push', 'team');
    expect(mockedInvoke).toHaveBeenCalledWith('git_push', { repoPath: repository.path, remote: 'team' });
    expect(currentWorktree().remote?.upstream).toBe('team/main');
  });

  it('操作期间拒绝重复执行和切换工作区，晚到旧刷新不能覆盖新计数', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    const oldStatus = deferred<NativeRepository>();
    const pending = deferred<GitRemoteResult>();
    let statusCalls = 0;
    mockedInvoke.mockImplementation(command => {
      if (command === 'git_status' && ++statusCalls === 1) return oldStatus.promise;
      if (command === 'git_push') return pending.promise;
      return reply(command);
    });
    const refreshing = useWorkbench.getState().refresh({ silent: true });
    const pushing = useWorkbench.getState().runRemote('push');
    expect(useWorkbench.getState()).toMatchObject({ busy: true, remoteOperation: 'push' });
    useWorkbench.getState().selectWorktree('different');
    expect(currentWorktree().path).toBe(metadata.path);
    await expect(useWorkbench.getState().runRemote('push')).rejects.toThrow('Git 操作正在进行');
    repository = { ...repository, remote: { ...repository.remote, ahead: 0 } };
    pending.resolve({ warning: null });
    await pushing;
    oldStatus.resolve({ ...initial, remote: { ...initial.remote, ahead: 99 } });
    await refreshing;
    expect(currentWorktree().remote?.ahead).toBe(0);
    expect(mockedInvoke.mock.calls.filter(([command]) => command === 'git_push')).toHaveLength(1);
  });

  it('远程失败后仍刷新引用，保留原始失败原因并解除锁定', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    mockedInvoke.mockImplementation(command => command === 'git_pull' ? Promise.reject('分支已分叉，请先合并') : reply(command));
    repository = { ...repository, remote: { ...repository.remote, behind: 2 } };
    await expect(useWorkbench.getState().runRemote('pull')).rejects.toThrow('分支已分叉，请先合并');
    expect(currentWorktree().remote?.behind).toBe(2);
    expect(useWorkbench.getState()).toMatchObject({ busy: false, remoteOperation: null, error: '分支已分叉，请先合并' });
  });

  it('推送成功但状态读取失败只返回警告，隐藏失效的待推送数字', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    mockedInvoke.mockImplementation(command => command === 'git_status' ? Promise.reject('暂时不可读') : reply(command));
    await expect(useWorkbench.getState().runRemote('push')).resolves.toEqual({ warning: '操作已完成，但刷新失败：暂时不可读' });
    expect(currentWorktree().remote).toBeUndefined();
    expect(useWorkbench.getState().busy).toBe(false);
  });

  it('提交与自动刷新都更新远程计数', async () => {
    repository = { ...repository, files: [{ path: 'index.ts', statusIndex: 'M', statusWorktree: ' ', originalPath: null, conflicted: false }] };
    await useWorkbench.getState().openRepository(repository.path);
    useWorkbench.getState().setDraft({ message: '新增提交' });
    repository = { ...repository, files: [], remote: { ...repository.remote, ahead: 4 } };
    await useWorkbench.getState().commit();
    expect(currentWorktree().remote?.ahead).toBe(4);
    repository = { ...repository, remote: { ...repository.remote, ahead: 0 } };
    await useWorkbench.getState().refresh({ silent: true });
    expect(currentWorktree().remote?.ahead).toBe(0);
  });

  it('不满足远程条件时不调用原生命令，空分支仍允许获取', async () => {
    repository = { ...repository, hasHead: false, remote: { ...repository.remote, upstream: null } };
    await useWorkbench.getState().openRepository(repository.path);
    mockedInvoke.mockClear();
    await expect(useWorkbench.getState().runRemote('push')).rejects.toThrow('首次提交');
    expect(mockedInvoke).not.toHaveBeenCalled();
    await expect(useWorkbench.getState().runRemote('fetch')).resolves.toEqual({ warning: null });
  });
});
