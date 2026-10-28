import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { NativeRepository } from './native-git';
import { findWorktree, getMergeMessage, useWorkbench } from './store';
import type { GitMergePreview, GitMergeResult, GitOperation } from './types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));

const mockedInvoke = vi.mocked(invoke);
const metadata = {
  path: '/test/merge', name: 'merge', branch: 'main', detached: false,
  bare: false, isMain: true, locked: null, prunable: null, available: true,
};
const operation: GitOperation = {
  kind: 'merge', head: 'target-commit', mergeHeads: ['source-commit'],
  source: 'feature', message: "Merge branch 'feature' into main\n",
};
const baseRepository: NativeRepository = {
  commonDir: '/test/merge/.git', repositoryName: 'merge', worktrees: [metadata],
  path: metadata.path, name: metadata.name, branch: metadata.branch, hasHead: true,
  files: [], operation: null,
  remote: { remotes: [], upstream: null, upstreamRemote: null, upstreamBranch: null, defaultRemote: null, ahead: null, behind: null },
};
const preview: GitMergePreview = {
  targetRef: 'refs/heads/main', targetBranch: 'main', targetOid: operation.head,
  sourceRef: 'refs/heads/feature', sourceName: 'feature', sourceOid: operation.mergeHeads[0],
  incomingCommits: 2, fastForward: false, upToDate: false,
};
const success: GitMergeResult = { outcome: 'merged', commitId: 'merge-commit', warning: null };
let repository: NativeRepository;
let mergeResult: GitMergeResult;

function currentWorktree() {
  const state = useWorkbench.getState();
  return findWorktree(state.repositories, state.activeWorktreeId)!;
}

function currentMessage() {
  return getMergeMessage(currentWorktree(), useWorkbench.getState().mergeDrafts);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true);
  mockedInvoke.mockReset();
  useWorkbench.getState().reset();
  repository = { ...baseRepository };
  mergeResult = { ...success };
  mockedInvoke.mockImplementation(async command => {
    if (command === 'git_open' || command === 'git_status') return repository;
    if (command === 'git_merge_preview') return { ...preview };
    if (command === 'git_merge' || command === 'git_merge_continue' || command === 'git_merge_abort') return mergeResult;
    if (command === 'git_branches') return [];
    if (command === 'git_diff') return { original: 'before', modified: 'after', notice: null };
    return undefined;
  });
});

describe('合并预览与执行', () => {
  it('传递精确引用、快照和合并策略；成功后保留普通提交草稿并刷新分支', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    useWorkbench.getState().setDraft({ message: '以后提交\n\n保留内容' });
    const selected = await useWorkbench.getState().previewMerge(preview.sourceRef);
    await expect(useWorkbench.getState().mergeBranch(selected, true)).resolves.toEqual(success);
    expect(mockedInvoke).toHaveBeenCalledWith('git_merge_preview', { repoPath: repository.path, sourceRef: preview.sourceRef });
    expect(mockedInvoke).toHaveBeenCalledWith('git_merge', { repoPath: repository.path, preview: selected, noFf: true });
    expect(mockedInvoke).toHaveBeenCalledWith('git_branches', { repoPath: repository.path });
    expect(useWorkbench.getState().drafts[currentWorktree().id].message).toBe('以后提交\n\n保留内容');
    expect(useWorkbench.getState()).toMatchObject({ busy: false, mergeDrafts: {} });
  });

  it('更换工作区使晚到的预览失效，已返回的预览也不能用于另一工作区', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    const selected = await useWorkbench.getState().previewMerge(preview.sourceRef);
    const pending = deferred<GitMergePreview>();
    mockedInvoke.mockImplementation(async command => command === 'git_merge_preview' ? pending.promise : repository);
    const loading = useWorkbench.getState().previewMerge(preview.sourceRef);
    const rejected = expect(loading).rejects.toThrow('工作区状态已变化');
    const linked = { ...metadata, path: '/test/merge-linked', name: 'linked', isMain: false };
    repository = { ...baseRepository, path: linked.path, worktrees: [metadata, linked] };
    await useWorkbench.getState().openRepository(linked.path);
    pending.resolve(preview);
    await rejected;
    await expect(useWorkbench.getState().mergeBranch(selected, false)).rejects.toThrow('工作区状态已变化');
    expect(mockedInvoke.mock.calls.some(([command]) => command === 'git_merge')).toBe(false);
  });

  it('合并期间锁定工作区并拒绝重复写入，旧状态不能覆盖合并结果', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    const selected = await useWorkbench.getState().previewMerge(preview.sourceRef);
    const oldStatus = deferred<NativeRepository>();
    const pending = deferred<GitMergeResult>();
    let calls = 0;
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_status') return ++calls === 1 ? oldStatus.promise : { ...repository, operation };
      if (command === 'git_merge') return pending.promise;
      if (command === 'git_branches') return [];
      return undefined;
    });
    const refreshing = useWorkbench.getState().refresh({ silent: true });
    const merging = useWorkbench.getState().mergeBranch(selected, false);
    expect(useWorkbench.getState().busy).toBe(true);
    useWorkbench.getState().selectWorktree('another');
    expect(currentWorktree().path).toBe(metadata.path);
    await expect(useWorkbench.getState().mergeBranch(selected, false)).rejects.toThrow('正在进行');
    pending.resolve({ ...success, outcome: 'conflicts', commitId: null });
    await merging;
    oldStatus.resolve(baseRepository);
    await refreshing;
    expect(currentWorktree().operation).toEqual(operation);
    expect(useWorkbench.getState().busy).toBe(false);
  });

  it('合并命令失败后恢复真实待提交状态并保留 hook 错误', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    const selected = await useWorkbench.getState().previewMerge(preview.sourceRef);
    repository = { ...baseRepository, operation };
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_merge') throw new Error('pre-merge-commit hook 失败');
      if (command === 'git_status') return repository;
      return undefined;
    });
    await expect(useWorkbench.getState().mergeBranch(selected, false)).rejects.toThrow('hook 失败');
    expect(currentWorktree().operation).toEqual(operation);
    expect(currentMessage()).toBe(operation.message);
    expect(useWorkbench.getState().error).toContain('pre-merge-commit hook 失败');
    expect(useWorkbench.getState().busy).toBe(false);
  });

  it('成功后的 hook 警告不变成合并失败', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    const selected = await useWorkbench.getState().previewMerge(preview.sourceRef);
    mergeResult = { ...success, warning: 'post-merge hook 失败，请检查日志。' };
    await expect(useWorkbench.getState().mergeBranch(selected, false)).resolves.toEqual(mergeResult);
    expect(useWorkbench.getState().error).toBe(mergeResult.warning);
  });
});

describe('待完成合并与独立草稿', () => {
  it('打开仓库从 Git 恢复默认信息，同一轮刷新保留手写草稿，新一轮重置', async () => {
    repository = { ...baseRepository, operation };
    await useWorkbench.getState().openRepository(repository.path);
    expect(currentMessage()).toBe(operation.message);
    useWorkbench.getState().setDraft({ message: '普通草稿' });
    useWorkbench.getState().setMergeMessage('合并功能\n\n自定义说明\n');
    repository = { ...repository, operation: { ...operation, message: 'Git 更新的默认信息' } };
    await useWorkbench.getState().refresh({ silent: true });
    expect(currentMessage()).toBe('合并功能\n\n自定义说明\n');
    repository = { ...repository, operation: { ...operation, mergeHeads: ['another-source'], message: '新合并' } };
    await useWorkbench.getState().refresh();
    expect(currentMessage()).toBe('新合并');
    expect(useWorkbench.getState().drafts[currentWorktree().id].message).toBe('普通草稿');
  });

  it('完成合并允许零暂存差异和无关未跟踪文件，传递 HEAD、MERGE_HEAD 及完整信息', async () => {
    repository = { ...baseRepository, operation, files: [
      { path: 'scratch.txt', originalPath: null, statusIndex: '?', statusWorktree: '?', conflicted: false },
    ] };
    await useWorkbench.getState().openRepository(repository.path);
    useWorkbench.getState().setDraft({ message: '独立普通草稿' });
    useWorkbench.getState().setMergeMessage('合并分支\n\n已经解决冲突\n');
    repository = { ...repository, operation: null };
    await expect(useWorkbench.getState().continueMerge()).resolves.toEqual(success);
    expect(mockedInvoke).toHaveBeenCalledWith('git_merge_continue', {
      repoPath: repository.path, expectedHead: operation.head, expectedMergeHeads: operation.mergeHeads,
      message: '合并分支\n\n已经解决冲突',
    });
    expect(currentWorktree().operation).toBeNull();
    expect(useWorkbench.getState().mergeDrafts).toEqual({});
    expect(useWorkbench.getState().drafts[currentWorktree().id].message).toBe('独立普通草稿');
  });

  it('外部结束合并后清理旧草稿，再次合并相同提交也使用新的默认信息', async () => {
    repository = { ...baseRepository, operation };
    await useWorkbench.getState().openRepository(repository.path);
    useWorkbench.getState().setMergeMessage('已经取消的合并草稿');
    repository = { ...baseRepository };
    await useWorkbench.getState().refresh({ silent: true });
    expect(useWorkbench.getState().mergeDrafts).toEqual({});
    repository = { ...baseRepository, operation };
    await useWorkbench.getState().refresh();
    expect(currentMessage()).toBe(operation.message);
  });

  it.each([
    [{ statusIndex: 'U', statusWorktree: 'U', conflicted: true }, '解决冲突'],
    [{ statusIndex: 'M', statusWorktree: 'M', conflicted: false }, '修改未暂存'],
    [{ statusIndex: ' ', statusWorktree: 'D', conflicted: false }, '修改未暂存'],
  ])('冲突或未暂存的跟踪文件不能完成合并：%j', async (status, message) => {
    repository = { ...baseRepository, operation, files: [{ path: 'conflict.txt', originalPath: null, ...status }] };
    await useWorkbench.getState().openRepository(repository.path);
    await expect(useWorkbench.getState().continueMerge()).rejects.toThrow(message);
    expect(mockedInvoke.mock.calls.some(([command]) => command === 'git_merge_continue')).toBe(false);
  });

  it('空信息不能完成合并；提交失败保留合并草稿和操作状态供重试', async () => {
    repository = { ...baseRepository, operation };
    await useWorkbench.getState().openRepository(repository.path);
    useWorkbench.getState().setMergeMessage(' \n ');
    await expect(useWorkbench.getState().continueMerge()).rejects.toThrow('请填写提交信息');
    useWorkbench.getState().setMergeMessage('解决合并冲突');
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_merge_continue') throw '签名失败';
      if (command === 'git_status') return repository;
      return undefined;
    });
    await expect(useWorkbench.getState().continueMerge()).rejects.toThrow('签名失败');
    expect(currentMessage()).toBe('解决合并冲突');
    expect(currentWorktree().operation).toEqual(operation);
    expect(useWorkbench.getState().busy).toBe(false);
  });

  it('中止失败保留合并草稿；成功后只清除合并草稿，原提交草稿不变', async () => {
    repository = { ...baseRepository, operation };
    await useWorkbench.getState().openRepository(repository.path);
    useWorkbench.getState().setDraft({ message: '保留普通草稿' });
    useWorkbench.getState().setMergeMessage('合并手写草稿');
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_merge_abort') throw 'index.lock 已存在';
      if (command === 'git_status') return repository;
      return undefined;
    });
    await expect(useWorkbench.getState().abortMerge()).rejects.toThrow('index.lock');
    expect(currentMessage()).toBe('合并手写草稿');
    repository = { ...baseRepository };
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_merge_abort') return { outcome: 'aborted', commitId: null, warning: null };
      if (command === 'git_status') return repository;
      if (command === 'git_branches') return [];
      return undefined;
    });
    await expect(useWorkbench.getState().abortMerge()).resolves.toMatchObject({ outcome: 'aborted' });
    expect(mockedInvoke).toHaveBeenCalledWith('git_merge_abort', {
      repoPath: repository.path, expectedHead: operation.head, expectedMergeHeads: operation.mergeHeads,
    });
    expect(useWorkbench.getState().mergeDrafts).toEqual({});
    expect(useWorkbench.getState().drafts[currentWorktree().id].message).toBe('保留普通草稿');
  });

  it.each(['merge', 'rebase', 'cherry-pick', 'revert', 'am'] as const)('%s 未结束时禁止切换分支、普通提交和新合并', async kind => {
    repository = { ...baseRepository, operation: { ...operation, kind } };
    await useWorkbench.getState().openRepository(repository.path);
    await expect(useWorkbench.getState().checkoutBranch('refs/heads/feature')).rejects.toThrow('请先完成或中止');
    await expect(useWorkbench.getState().commit()).rejects.toThrow('请先完成或中止');
    await expect(useWorkbench.getState().previewMerge(preview.sourceRef)).rejects.toThrow('请先完成或中止');
    await expect(useWorkbench.getState().mergeBranch(preview, false)).rejects.toThrow('请先完成或中止');
    if (kind !== 'merge') {
      await expect(useWorkbench.getState().continueMerge()).rejects.toThrow('没有待完成的合并');
      await expect(useWorkbench.getState().abortMerge()).rejects.toThrow('没有待完成的合并');
    }
    expect(mockedInvoke.mock.calls.some(([command]) => ['git_checkout', 'git_commit', 'git_merge', 'git_merge_preview'].includes(command))).toBe(false);
  });

  it('完成后状态刷新失败仍返回成功并移除过期合并状态', async () => {
    repository = { ...baseRepository, operation };
    await useWorkbench.getState().openRepository(repository.path);
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_merge_continue') return success;
      if (command === 'git_status') throw '目录不可访问';
      if (command === 'git_branches') return [];
      return undefined;
    });
    await expect(useWorkbench.getState().continueMerge()).resolves.toEqual(success);
    expect(currentWorktree().operation).toBeNull();
    expect(useWorkbench.getState().mergeDrafts).toEqual({});
    expect(useWorkbench.getState().error).toContain('操作已完成，但刷新失败');
  });

  it.each(['error', 'pending'] as const)('合并未完成且刷新失败时不误报操作成功：%s', async outcome => {
    repository = { ...baseRepository, operation };
    await useWorkbench.getState().openRepository(repository.path);
    useWorkbench.getState().setMergeMessage('保留合并草稿');
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_merge_continue') {
        if (outcome === 'error') throw '签名失败';
        return { outcome: 'pending', commitId: null, warning: '签名失败' };
      }
      if (command === 'git_status') throw '目录不可访问';
      if (command === 'git_branches') return [];
      return undefined;
    });
    if (outcome === 'error') await expect(useWorkbench.getState().continueMerge()).rejects.toThrow('签名失败');
    else await expect(useWorkbench.getState().continueMerge()).resolves.toMatchObject({ outcome: 'pending' });
    expect(useWorkbench.getState().error).toContain('签名失败');
    expect(useWorkbench.getState().error).toContain('无法刷新仓库状态：目录不可访问');
    expect(useWorkbench.getState().error).not.toContain('操作已完成');
    expect(currentMessage()).toBe('保留合并草稿');
    expect(currentWorktree().operation).toEqual(operation);
  });
});
