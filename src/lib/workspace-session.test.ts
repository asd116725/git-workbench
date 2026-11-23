import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeRepository, NativeWorktree } from './native-git';

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/core', () => native);

const main: NativeWorktree = {
  path: '/test/editor', name: 'editor', branch: 'main', detached: false,
  bare: false, isMain: true, locked: null, prunable: null, available: true,
};
const linked = { ...main, path: '/test/editor-preview', name: 'preview', branch: 'feature/preview', isMain: false };
const editor: NativeRepository = {
  commonDir: '/test/editor/.git', repositoryName: 'editor', worktrees: [main, linked],
  path: main.path, name: main.name, branch: main.branch, hasHead: true, operation: null,
  remote: { remotes: [], upstream: null, upstreamRemote: null, upstreamBranch: null, defaultRemote: null, ahead: null, behind: null },
  files: [{ path: 'first.ts', originalPath: null, statusIndex: ' ', statusWorktree: 'M', conflicted: false }],
};
const preview = { ...editor, path: linked.path, name: linked.name, branch: linked.branch };
const dashboard: NativeRepository = {
  ...editor, commonDir: '/test/dashboard/.git', repositoryName: 'dashboard',
  path: '/test/dashboard', name: 'dashboard',
  worktrees: [{ ...main, path: '/test/dashboard', name: 'dashboard' }],
};
const saved = new Map<string, string>();
const repositories = new Map<string, NativeRepository>();

/** 重新导入模块模拟退出后重开，仅保留设备存储与磁盘上的仓库状态。 */
async function launch() {
  vi.resetModules();
  return (await import('./store')).useWorkbench;
}

beforeEach(() => {
  saved.clear();
  repositories.clear();
  repositories.set(main.path, editor).set(linked.path, preview).set(dashboard.path, dashboard);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  });
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string, args: { path?: string; repoPath?: string }) => {
    if (command === 'git_diff') return { original: 'before\n', modified: 'current disk contents\n', notice: null };
    const path = args.path ?? args.repoPath!;
    const repository = repositories.get(path);
    if (!repository) throw new Error('目录不存在');
    return repository;
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('删除已登记的工作树', () => {
  it('删除当前工作树后切回主工作区，清理草稿并恢复新的选择', async () => {
    const app = await launch();
    await app.getState().openRepository(linked.path);
    app.getState().setDraft({ message: '当前工作树草稿' });
    const id = `native:${linked.path}`;
    const repositoryId = app.getState().repositories[0].id;
    const invoke = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command, args) => {
      if (command !== 'git_remove_worktree') return invoke(command, args);
      expect(args).toEqual({ commonDir: editor.commonDir, worktreePath: linked.path, mode: 'delete' });
      repositories.delete(linked.path);
      repositories.set(main.path, { ...editor, worktrees: [main] });
      return { warning: null };
    });

    await app.getState().removeWorktree(repositoryId, id, 'delete');

    expect(app.getState().repositories[0].worktrees.map(worktree => worktree.path)).toEqual([main.path]);
    expect(app.getState().activeWorktreeId).toBe(`native:${main.path}`);
    expect(app.getState().drafts[id]).toBeUndefined();
    const reopened = await launch();
    await reopened.getState().restoreSession();
    expect(reopened.getState().activeWorktreeId).toBe(`native:${main.path}`);
    expect(reopened.getState().error).toBeNull();
  });

  it('删除非当前工作树失败时保留该行，重试成功时保持比较对象', async () => {
    const app = await launch();
    await app.getState().openRepository(main.path);
    await vi.waitFor(() => expect(app.getState().diff.file?.working).toBe('current disk contents\n'));
    const { repositories: listed, activeWorktreeId, selection, diff } = app.getState();
    const id = `native:${linked.path}`;
    native.invoke.mockRejectedValueOnce('工作树有未提交改动或未跟踪文件。');
    await expect(app.getState().removeWorktree(listed[0].id, id, 'delete')).rejects.toThrow('未提交改动');
    expect(app.getState().repositories).toBe(listed);
    expect(app.getState().busy).toBe(false);

    native.invoke.mockResolvedValueOnce({ warning: 'Git:\n有文件未能删除' });
    const result = await app.getState().removeWorktree(listed[0].id, id, 'delete');

    expect(result.warning).toContain('有文件未能删除');
    expect(app.getState().repositories[0].worktrees.map(worktree => worktree.path)).toEqual([main.path]);
    expect(app.getState()).toMatchObject({ activeWorktreeId, selection, diff });
  });
});

describe('本地仓库跨重启恢复', () => {
  it('重启恢复工作区的未完成合并，并从 Git 信息初始化独立合并草稿', async () => {
    const first = await launch();
    await first.getState().openRepository(linked.path);
    const operation = {
      kind: 'merge' as const, head: 'target-commit', mergeHeads: ['source-commit'],
      source: 'feature/source', message: "Merge branch 'feature/source'",
    };
    repositories.set(linked.path, { ...preview, operation });

    const reopened = await launch();
    await reopened.getState().restoreSession();
    const state = reopened.getState();
    const current = state.repositories[0].worktrees.find(item => item.id === state.activeWorktreeId)!;
    expect(current.operation).toEqual(operation);
    expect(state.mergeDrafts[current.id].message).toBe(operation.message);
    expect(state.drafts).toEqual({});
    expect([...saved.values()].join('')).not.toContain('source-commit');
  });

  it('恢复多个仓库和最后选中的 worktree，并重新读取 Git 状态与 Diff', async () => {
    const first = await launch();
    await first.getState().openRepository(main.path);
    await first.getState().openRepository(dashboard.path);
    first.getState().selectWorktree(`native:${linked.path}`);
    await vi.waitFor(() => expect(first.getState().refreshing).toBe(false));
    first.getState().setDraft({ message: '未保存的草稿\n\n不持久化正文' });
    repositories.set(linked.path, { ...preview, branch: 'feature/latest', files: [{ ...editor.files[0], path: 'latest.ts' }] });

    const reopened = await launch();
    await reopened.getState().restoreSession();
    expect(reopened.getState().repositories.map(item => item.name)).toEqual(['editor', 'dashboard']);
    expect(reopened.getState().activeWorktreeId).toBe('native:/test/editor-preview');
    const current = reopened.getState().repositories[0].worktrees.find(item => item.path === linked.path)!;
    expect(current.branch).toBe('feature/latest');
    expect(current.files.map(file => file.path)).toEqual(['latest.ts']);
    await vi.waitFor(() => expect(reopened.getState().diff.file?.working).toBe('current disk contents\n'));
    expect(reopened.getState().drafts).toEqual({});
    expect([...saved.values()].join('')).not.toMatch(/current disk contents|first\.ts|未保存的草稿|feature\/preview/);
  });

  it('从兄弟 worktree 重复打开同一个仓库，重启后仍只有一个仓库分组', async () => {
    const first = await launch();
    await first.getState().openRepository(linked.path);
    await first.getState().openRepository(main.path);
    await first.getState().openRepository(linked.path);

    const reopened = await launch();
    await reopened.getState().restoreSession();
    expect(reopened.getState().repositories).toHaveLength(1);
    expect(reopened.getState().repositories[0].worktrees.map(item => item.path)).toEqual([main.path, linked.path]);
    expect(reopened.getState().activeWorktreeId).toBe('native:/test/editor-preview');
  });

  it('部分仓库不可用时继续恢复其余仓库，保留路径供下次启动重试', async () => {
    const first = await launch();
    await first.getState().openRepository(dashboard.path);
    await first.getState().openRepository(main.path);
    const snapshot = new Map(saved);
    repositories.delete(main.path);

    const reopened = await launch();
    await reopened.getState().restoreSession();
    expect(reopened.getState().repositories.map(item => item.name)).toEqual(['dashboard']);
    expect(reopened.getState().activeWorktreeId).toBe('native:/test/dashboard');
    expect(reopened.getState().error).toContain('/test/editor');
    expect(saved).toEqual(snapshot);

    repositories.set(main.path, editor);
    const retried = await launch();
    await retried.getState().restoreSession();
    expect(retried.getState().repositories.map(item => item.name)).toEqual(['dashboard', 'editor']);
    expect(retried.getState().activeWorktreeId).toBe('native:/test/editor');
  });

  it('上次选中的 worktree 已删除时退回可用工作区', async () => {
    const first = await launch();
    await first.getState().openRepository(linked.path);
    repositories.delete(linked.path);
    repositories.set(main.path, { ...editor, worktrees: [main] });

    const reopened = await launch();
    await reopened.getState().restoreSession();
    expect(reopened.getState().activeWorktreeId).toBe('native:/test/editor');
    expect(reopened.getState().busy).toBe(false);
    expect(reopened.getState().restoring).toBe(false);
  });

  it('重复启动恢复请求共用一次读取，恢复期间阻止并发 Git 写操作', async () => {
    const first = await launch();
    await first.getState().openRepository(main.path);
    let finish!: (value: NativeRepository) => void;
    const pending = new Promise<NativeRepository>(resolve => { finish = resolve; });
    native.invoke.mockImplementation(async command => command === 'git_open' ? pending : { original: '', modified: '', notice: null });
    const reopened = await launch();
    const firstRestore = reopened.getState().restoreSession();
    const secondRestore = reopened.getState().restoreSession();
    expect(reopened.getState().restoring).toBe(true);
    expect(reopened.getState().busy).toBe(true);
    await expect(reopened.getState().openRepository(dashboard.path)).rejects.toThrow('Git 操作正在进行');
    finish(editor);
    await Promise.all([firstRestore, secondRestore]);
    expect(reopened.getState().repositories).toHaveLength(1);
    expect(reopened.getState().busy).toBe(false);
    expect(reopened.getState().restoring).toBe(false);
    const calls = native.invoke.mock.calls.filter(([command]) => command === 'git_open');
    expect(calls).toHaveLength(2);
  });

  it('所有保存路径失效时结束恢复并展示错误，仍可手动打开新仓库', async () => {
    const first = await launch();
    await first.getState().openRepository(main.path);
    repositories.delete(main.path);
    const reopened = await launch();
    await reopened.getState().restoreSession();
    expect(reopened.getState().repositories).toEqual([]);
    expect(reopened.getState().restoring).toBe(false);
    expect(reopened.getState().error).toContain('目录不存在');
    await reopened.getState().openRepository(dashboard.path);
    expect(reopened.getState().activeWorktreeId).toBe('native:/test/dashboard');
  });

  it('浏览器演示不恢复真实仓库，也不覆盖桌面会话记录', async () => {
    const first = await launch();
    await first.getState().openRepository(main.path);
    const snapshot = new Map(saved);
    native.isTauri.mockReturnValue(false);
    native.invoke.mockClear();
    const browser = await launch();
    await browser.getState().restoreSession();
    expect(browser.getState().repositories[0].name).toBe('demo-editor');
    expect(native.invoke).not.toHaveBeenCalled();
    expect(saved).toEqual(snapshot);
  });
});
