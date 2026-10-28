import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeRepository, NativeWorktree } from './native-git';
import type { HistoryCommitDetail, HistoryCommitSummary } from './history-types';

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/core', () => native);

const main: NativeWorktree = { path: '/test/history', name: 'history', branch: 'main', detached: false, bare: false, isMain: true, locked: null, prunable: null, available: true };
const linked: NativeWorktree = { ...main, path: '/test/history-feature', name: 'feature', branch: 'feature/topic', isMain: false };
const mainRepository: NativeRepository = {
  commonDir: '/test/history/.git', repositoryName: 'history', path: main.path, name: main.name, branch: main.branch,
  worktrees: [main, linked], hasHead: true, operation: null,
  remote: { remotes: [], upstream: null, upstreamRemote: null, upstreamBranch: null, defaultRemote: null, ahead: null, behind: null },
  files: [{ path: 'working.ts', originalPath: null, statusIndex: ' ', statusWorktree: 'M', conflicted: false }],
};
const linkedRepository: NativeRepository = { ...mainRepository, path: linked.path, name: linked.name, branch: linked.branch };
const commit: HistoryCommitSummary = {
  oid: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: '历史提交', authorName: 'Demo', authorEmail: 'demo@example.com',
  committedAt: 1_700_000_000, parents: ['b'.repeat(40), 'c'.repeat(40)],
};
const detail: HistoryCommitDetail = {
  commit, message: '历史提交\n\n不应存入设备存储的历史说明', parentOid: commit.parents[0], parentIndex: 0,
  files: [{ path: 'history.ts', oldPath: null, status: 'M', oldMode: '100644', newMode: '100644' }],
};
const saved = new Map<string, string>();
const repositories = new Map<string, NativeRepository>();

/** 模拟重启，只有 localStorage 留存，其余模块内会话重新初始化。 */
async function launch() {
  vi.resetModules();
  const { useWorkbench, usePreferences, findWorktree } = await import('./store');
  const { useHistory } = await import('./history-store');
  return { useWorkbench, usePreferences, useHistory, findWorktree };
}

beforeEach(() => {
  saved.clear();
  repositories.clear();
  repositories.set(main.path, mainRepository).set(linked.path, linkedRepository);
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { localStorage: storage });
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset().mockImplementation(async (command: string, args: { path?: string; repoPath?: string; parentIndex?: number }) => {
    if (command === 'git_history_ref') return { oid: commit.oid };
    if (command === 'git_history') return { commits: [commit], nextCursor: null };
    if (command === 'git_commit_detail') return { ...detail, parentIndex: args.parentIndex ?? 0, parentOid: commit.parents[args.parentIndex ?? 0] };
    if (command === 'git_commit_diff') return { original: '历史旧正文', modified: '历史新正文', notice: null };
    if (command === 'git_diff') return { original: '工作区原文', modified: '工作区编辑内容', notice: null };
    if (command === 'git_open' || command === 'git_status') return repositories.get(args.repoPath ?? args.path!);
    throw new Error(`未预期的写命令：${command}`);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('历史与工作台集成', () => {
  it('切换本地更改和历史，保留文件选择、提交草稿以及历史阅读状态', async () => {
    const { useWorkbench, useHistory, findWorktree } = await launch();
    await useWorkbench.getState().openRepository(main.path);
    const worktree = findWorktree(useWorkbench.getState().repositories, `native:${main.path}`)!;
    useWorkbench.getState().setDraft({ message: '未保存的普通草稿' });
    const localSelection = useWorkbench.getState().selection;
    const localDrafts = useWorkbench.getState().drafts;
    useWorkbench.getState().setView('history');
    await useHistory.getState().ensure(worktree);
    await useHistory.getState().setQuery(worktree, '历史');
    await useHistory.getState().selectParent(worktree, 1);
    const history = useHistory.getState().sessions[worktree.id];
    useWorkbench.getState().setView('changes');
    expect(useWorkbench.getState().selection).toBe(localSelection);
    expect(useWorkbench.getState().drafts).toBe(localDrafts);
    useWorkbench.getState().setView('history');
    await useHistory.getState().ensure(worktree);
    expect(useHistory.getState().sessions[worktree.id]).toBe(history);
    expect(history).toMatchObject({ query: '历史', selectedOid: commit.oid, parentIndex: 1, selectedPath: 'history.ts' });
    expect(useWorkbench.getState().busy).toBe(false);
  });

  it('普通 Git 状态刷新不会覆盖历史缓存、筛选或所选比较对象', async () => {
    const { useWorkbench, useHistory, findWorktree } = await launch();
    await useWorkbench.getState().openRepository(main.path);
    const worktree = findWorktree(useWorkbench.getState().repositories, `native:${main.path}`)!;
    await useHistory.getState().ensure(worktree);
    await useHistory.getState().setReference(worktree, 'refs/remotes/origin/topic');
    await useHistory.getState().selectParent(worktree, 1);
    const history = useHistory.getState().sessions[worktree.id];
    repositories.set(main.path, { ...mainRepository, files: [{ ...mainRepository.files[0], path: 'new-working.ts' }] });
    native.invoke.mockClear();
    await useWorkbench.getState().refresh({ silent: true });
    expect(findWorktree(useWorkbench.getState().repositories, worktree.id)?.files[0].path).toBe('new-working.ts');
    expect(useHistory.getState().sessions[worktree.id]).toBe(history);
    expect(native.invoke.mock.calls.some(([command]) => command.startsWith('git_history') || command.startsWith('git_commit_'))).toBe(false);
  });

  it('切换 worktree 保持历史标签，每个工作区的筛选和父提交分别恢复', async () => {
    const { useWorkbench, useHistory, findWorktree } = await launch();
    await useWorkbench.getState().openRepository(main.path);
    const mainWorktree = findWorktree(useWorkbench.getState().repositories, `native:${main.path}`)!;
    useWorkbench.getState().setView('history');
    await useHistory.getState().ensure(mainWorktree);
    await useHistory.getState().setQuery(mainWorktree, 'main search');
    await useHistory.getState().selectParent(mainWorktree, 1);
    const mainHistory = useHistory.getState().sessions[mainWorktree.id];
    useWorkbench.getState().selectWorktree(`native:${linked.path}`);
    await vi.waitFor(() => expect(useWorkbench.getState().refreshing).toBe(false));
    const linkedWorktree = findWorktree(useWorkbench.getState().repositories, `native:${linked.path}`)!;
    await useHistory.getState().ensure(linkedWorktree);
    await useHistory.getState().setQuery(linkedWorktree, 'feature search');
    expect(useWorkbench.getState().view).toBe('history');
    useWorkbench.getState().selectWorktree(mainWorktree.id);
    await vi.waitFor(() => expect(useWorkbench.getState().refreshing).toBe(false));
    expect(useWorkbench.getState().view).toBe('history');
    expect(useHistory.getState().sessions[mainWorktree.id]).toBe(mainHistory);
    expect(useHistory.getState().sessions[linkedWorktree.id].query).toBe('feature search');
  });

  it('未完成合并的消息和普通提交草稿不会被历史筛选或刷新修改', async () => {
    const operation = { kind: 'merge' as const, head: 'target-head', mergeHeads: ['source-head'], source: 'feature/source', message: '默认合并说明' };
    repositories.set(main.path, { ...mainRepository, operation });
    const { useWorkbench, useHistory, findWorktree } = await launch();
    await useWorkbench.getState().openRepository(main.path);
    const worktree = findWorktree(useWorkbench.getState().repositories, `native:${main.path}`)!;
    useWorkbench.getState().setDraft({ message: '原来的普通提交草稿' });
    useWorkbench.getState().setMergeMessage('手动编辑的合并说明');
    const before = useWorkbench.getState();
    useWorkbench.getState().setView('history');
    await useHistory.getState().ensure(worktree);
    await useHistory.getState().setReference(worktree, 'refs/heads/feature/source');
    await useHistory.getState().refresh(worktree);
    await useWorkbench.getState().refresh({ silent: true });
    const after = useWorkbench.getState();
    expect(after.drafts).toBe(before.drafts);
    expect(after.mergeDrafts).toBe(before.mergeDrafts);
    expect(after.mergeDrafts[worktree.id].message).toBe('手动编辑的合并说明');
    expect(findWorktree(after.repositories, worktree.id)?.operation).toEqual(operation);
    expect(native.invoke.mock.calls.some(([command]) => command === 'git_merge' || command === 'git_commit' || command === 'git_stage')).toBe(false);
  });

  it('仅持久化独立的历史 Diff 模式与栏宽，重启不会恢复历史正文和筛选', async () => {
    const first = await launch();
    await first.useWorkbench.getState().openRepository(main.path);
    const worktree = first.findWorktree(first.useWorkbench.getState().repositories, `native:${main.path}`)!;
    expect(first.usePreferences.getState()).toMatchObject({ diffMode: 'split', historyDiffMode: 'inline' });
    first.usePreferences.getState().setDiffMode('inline');
    first.usePreferences.getState().setHistoryDiffMode('split');
    first.usePreferences.getState().setLayout({ changes: 35, diff: 65 });
    first.usePreferences.getState().setLayout({ historyCommits: 28, historyFiles: 24, historyDiff: 48 });
    await first.useHistory.getState().ensure(worktree);
    await first.useHistory.getState().setQuery(worktree, '本次会话的历史搜索');
    expect(first.useHistory.getState().sessions[worktree.id].diff.file?.index).toBe('历史新正文');
    const stored = [...saved.values()].join('');
    expect(stored).toContain('historyDiffMode');
    expect(stored).not.toMatch(/历史新正文|历史旧正文|历史说明|历史搜索|history\.ts/);
    const reopened = await launch();
    expect(reopened.usePreferences.getState()).toMatchObject({ diffMode: 'inline', historyDiffMode: 'split', layout: { changes: 35, diff: 65, historyCommits: 28, historyFiles: 24, historyDiff: 48 } });
    expect(reopened.useHistory.getState().sessions).toEqual({});
  });
});
