import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { findWorktree, useWorkbench } from './store';
import type { NativeRepository } from './native-git';
import type { GitCreateBranchResult, GitDeleteBranchPreview } from './types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));

const metadata = { path: '/test/branches', name: 'branches', branch: 'main', detached: false, bare: false, isMain: true, locked: null, prunable: null, available: true };
const initial: NativeRepository = {
  path: metadata.path, name: metadata.name, branch: metadata.branch, commonDir: `${metadata.path}/.git`,
  repositoryName: 'branches', worktrees: [metadata], hasHead: true, operation: null,
  files: [{ path: 'index.ts', statusIndex: ' ', statusWorktree: 'M', originalPath: null, conflicted: false }],
};
const preview: GitDeleteBranchPreview = {
  targetRef: 'refs/heads/feature/search', targetName: 'feature/search', targetOid: 'b'.repeat(40),
  headRef: 'refs/heads/main', headOid: 'a'.repeat(40), headName: 'main', unmergedCommits: 2,
};
const mockedInvoke = vi.mocked(invoke);
let repository: NativeRepository;
let created: GitCreateBranchResult;

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
  if (command === 'git_diff') return { original: 'before', modified: 'after', notice: null };
  if (command === 'git_branches') return [];
  if (command === 'git_create_branch') return created;
  if (command === 'git_delete_branch_preview') return { ...preview };
  if (command === 'git_delete_branch') return { branch: preview.targetName, warning: null };
}

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true);
  useWorkbench.getState().reset();
  repository = { ...initial };
  created = { branch: 'feature/new', switched: false, warning: null };
  mockedInvoke.mockReset();
  mockedInvoke.mockImplementation(reply);
});

describe('分支管理写入与阅读状态', () => {
  it('仅创建传递精确起点，保留历史页、文件选择和草稿，不重新读取正文', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    useWorkbench.getState().setDraft({ message: '待提交\n\n说明' });
    useWorkbench.getState().setView('history');
    const before = useWorkbench.getState();
    mockedInvoke.mockClear();
    await expect(before.createBranch('feature/new', 'refs/remotes/origin/main', false)).resolves.toEqual(created);
    expect(mockedInvoke).toHaveBeenCalledWith('git_create_branch', { repoPath: repository.path, name: 'feature/new', startRef: 'refs/remotes/origin/main', checkout: false });
    expect(useWorkbench.getState()).toMatchObject({ view: 'history', selection: before.selection, drafts: before.drafts, busy: false });
    expect(useWorkbench.getState().diff).toBe(before.diff);
    expect(currentWorktree().branch).toBe('main');
    expect(mockedInvoke.mock.calls.map(([command]) => command)).toEqual(['git_create_branch', 'git_branches']);
  });

  it('删除传递预览和强删确认，保留 Diff、草稿及历史页', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    useWorkbench.getState().setDraft({ message: '保留草稿' });
    useWorkbench.getState().setView('history');
    const selected = await useWorkbench.getState().previewDeleteBranch(preview.targetRef);
    const before = useWorkbench.getState();
    mockedInvoke.mockClear();
    await before.deleteBranch(selected, true);
    expect(mockedInvoke).toHaveBeenCalledWith('git_delete_branch', { repoPath: repository.path, preview: selected, force: true });
    expect(useWorkbench.getState()).toMatchObject({ view: 'history', selection: before.selection, drafts: before.drafts });
    expect(useWorkbench.getState().diff).toBe(before.diff);
    expect(mockedInvoke.mock.calls.map(([command]) => command)).toEqual(['git_delete_branch', 'git_branches']);
  });

  it('创建并切换后读取新工作区，保留提交草稿', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    useWorkbench.getState().setDraft({ message: '稍后提交' });
    created = { ...created, switched: true };
    repository = { ...repository, branch: created.branch, worktrees: [{ ...metadata, branch: created.branch }], files: [] };
    await expect(useWorkbench.getState().createBranch(created.branch, 'refs/heads/main', true)).resolves.toEqual(created);
    expect(currentWorktree().branch).toBe(created.branch);
    expect(useWorkbench.getState()).toMatchObject({ selection: null, view: 'changes', diff: { file: null }, busy: false });
    expect(useWorkbench.getState().drafts[currentWorktree().id].message).toBe('稍后提交');
    expect(mockedInvoke).toHaveBeenCalledWith('git_status', { repoPath: repository.path });
  });

  it('已创建但切换被阻止时仍返回成功及警告，原文件和草稿保持可读', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    created = { ...created, warning: '分支已创建，但本地修改阻止切换。' };
    const before = useWorkbench.getState();
    await expect(before.createBranch(created.branch, 'HEAD', true)).resolves.toEqual(created);
    expect(currentWorktree().branch).toBe('main');
    expect(useWorkbench.getState().diff).toBe(before.diff);
    expect(useWorkbench.getState().selection).toBe(before.selection);
  });

  it('切换已完成但状态刷新失败时保留新分支身份，以警告返回并清掉旧文件', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    created = { ...created, switched: true, warning: 'post-checkout hook 返回错误' };
    mockedInvoke.mockImplementation(command => command === 'git_status' ? Promise.reject('无法读取状态') : reply(command));
    const result = await useWorkbench.getState().createBranch(created.branch, 'HEAD', true);
    expect(result).toMatchObject({ branch: created.branch, switched: true });
    expect(result.warning).toContain('post-checkout');
    expect(result.warning).toContain('刷新失败');
    expect(currentWorktree().files).toEqual([]);
    expect(currentWorktree().branch).toBe(created.branch);
    expect(useWorkbench.getState().diff.file).toBeNull();
  });

  it('分支列表刷新失败不推翻已创建结果，也不清空阅读内容', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    const before = useWorkbench.getState().diff;
    mockedInvoke.mockImplementation(command => command === 'git_branches' ? Promise.reject('引用暂时不可读') : reply(command));
    const result = await useWorkbench.getState().createBranch(created.branch, 'HEAD', false);
    expect(result.warning).toContain('操作已完成，但分支列表刷新失败');
    expect(useWorkbench.getState().diff).toBe(before);
    expect(useWorkbench.getState().busy).toBe(false);
  });

  it('仅修改引用期间允许原文件的在途 Diff 完成，避免留下永久加载态', async () => {
    const pending = deferred<{ original: string; modified: string; notice: null }>();
    mockedInvoke.mockImplementation(command => command === 'git_diff' ? pending.promise : reply(command));
    await useWorkbench.getState().openRepository(repository.path);
    expect(useWorkbench.getState().diff.loading).toBe(true);
    await useWorkbench.getState().createBranch(created.branch, 'HEAD', false);
    pending.resolve({ original: 'before', modified: 'after', notice: null });
    await vi.waitFor(() => expect(useWorkbench.getState().diff.loading).toBe(false));
    expect(useWorkbench.getState().diff.file?.working).toBe('after');
  });
});

describe('删除确认与请求隔离', () => {
  it('删除失败消费旧确认；重新读取预览后才可重试', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    const selected = await useWorkbench.getState().previewDeleteBranch(preview.targetRef);
    mockedInvoke.mockImplementation(command => command === 'git_delete_branch' ? Promise.reject('分支引用已变化') : reply(command));
    await expect(useWorkbench.getState().deleteBranch(selected, true)).rejects.toThrow('分支引用已变化');
    await expect(useWorkbench.getState().deleteBranch(selected, true)).rejects.toThrow('重新预览');
    expect(mockedInvoke.mock.calls.filter(([command]) => command === 'git_delete_branch')).toHaveLength(1);
    mockedInvoke.mockImplementation(reply);
    const fresh = await useWorkbench.getState().previewDeleteBranch(preview.targetRef);
    await expect(useWorkbench.getState().deleteBranch(fresh, true)).resolves.toMatchObject({ branch: preview.targetName });
  });

  it('切换工作区后旧预览和晚到响应不能用于新的工作区', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    const selected = await useWorkbench.getState().previewDeleteBranch(preview.targetRef);
    const pending = deferred<GitDeleteBranchPreview>();
    mockedInvoke.mockImplementation(command => command === 'git_delete_branch_preview' ? pending.promise : reply(command));
    const loading = useWorkbench.getState().previewDeleteBranch(preview.targetRef);
    const rejected = expect(loading).rejects.toThrow('工作区状态已变化');
    repository = { ...repository, path: '/test/another', worktrees: [{ ...metadata, path: '/test/another' }] };
    await useWorkbench.getState().openRepository(repository.path);
    pending.resolve({ ...preview });
    await rejected;
    await expect(useWorkbench.getState().deleteBranch(selected, true)).rejects.toThrow('重新预览');
    expect(mockedInvoke.mock.calls.some(([command]) => command === 'git_delete_branch')).toBe(false);
  });

  it('分支创建期间阻止重复写入和更换工作区', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    const selected = await useWorkbench.getState().previewDeleteBranch(preview.targetRef);
    const pending = deferred<GitCreateBranchResult>();
    mockedInvoke.mockImplementation(command => command === 'git_create_branch' ? pending.promise : reply(command));
    const creating = useWorkbench.getState().createBranch(created.branch, 'HEAD', false);
    await expect(useWorkbench.getState().createBranch('another', 'HEAD', false)).rejects.toThrow('正在进行');
    await expect(useWorkbench.getState().deleteBranch(selected, true)).rejects.toThrow('正在进行');
    useWorkbench.getState().selectWorktree('another');
    expect(currentWorktree().path).toBe(metadata.path);
    pending.resolve(created);
    await creating;
    expect(useWorkbench.getState().busy).toBe(false);
  });

  it('未完成合并时禁止创建、预览删除和执行删除', async () => {
    await useWorkbench.getState().openRepository(repository.path);
    const selected = await useWorkbench.getState().previewDeleteBranch(preview.targetRef);
    repository = { ...repository, operation: { kind: 'merge', head: preview.headOid, mergeHeads: [preview.targetOid], message: 'Merge', source: null } };
    await useWorkbench.getState().refresh();
    await expect(useWorkbench.getState().createBranch('new', 'HEAD', false)).rejects.toThrow('先完成或中止');
    await expect(useWorkbench.getState().previewDeleteBranch(preview.targetRef)).rejects.toThrow('先完成或中止');
    await expect(useWorkbench.getState().deleteBranch(selected, true)).rejects.toThrow('先完成或中止');
  });
});

describe('浏览器演示接入', () => {
  it('演示提交后同步分支摘要和创建起点，不继续使用旧 HEAD', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    useWorkbench.getState().reset();
    await useWorkbench.getState().loadBranches();
    useWorkbench.getState().setDraft({ message: '演示新提交' });
    const commitId = await useWorkbench.getState().commit();
    await useWorkbench.getState().loadBranches();
    expect(useWorkbench.getState().branches.items.find(branch => branch.current)?.lastCommit).toMatchObject({ shortHash: commitId.slice(0, 7), subject: '演示新提交' });
    await useWorkbench.getState().createBranch('feature/latest', 'HEAD', false);
    const selected = await useWorkbench.getState().previewDeleteBranch('refs/heads/feature/latest');
    expect(selected.targetOid).toBe(selected.headOid);
    expect(selected.headOid.startsWith(commitId)).toBe(true);
    expect(selected.unmergedCommits).toBe(0);
  });

  it('演示创建、切换和删除共用管理入口，结果只留在内存且不调用原生接口', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    useWorkbench.getState().reset();
    const original = currentWorktree().branch;
    await useWorkbench.getState().loadBranches();
    expect(useWorkbench.getState().branches.items.some(item => item.name === 'feature/search')).toBe(true);
    await useWorkbench.getState().createBranch('feature/demo-test', `refs/heads/${original}`, true);
    expect(currentWorktree().branch).toBe('feature/demo-test');
    await useWorkbench.getState().checkoutBranch(`refs/heads/${original}`);
    const selected = await useWorkbench.getState().previewDeleteBranch('refs/heads/feature/demo-test');
    await useWorkbench.getState().deleteBranch(selected, false);
    expect(useWorkbench.getState().branches.items.some(item => item.name === 'feature/demo-test')).toBe(false);
    expect(mockedInvoke).not.toHaveBeenCalled();
    useWorkbench.getState().reset();
    expect(currentWorktree().branch).toBe(original);
  });
});
