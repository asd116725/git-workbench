import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { historyFileSnapshot } from './history-git';
import { useWorkbench } from './store';
import { useHistory } from './history-store';
import type { HistoryCommitDetail, HistoryCommitSummary, HistoryDiff, HistoryPage } from './history-types';
import type { Worktree } from './types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
const mockedInvoke = vi.mocked(invoke);
const worktree: Worktree = { id: 'native:/repo', name: 'repo', path: '/repo', branch: 'main', source: 'native', commits: [], files: [] };
const secondWorktree: Worktree = { ...worktree, id: 'native:/other', path: '/other' };
const first: HistoryCommitSummary = { oid: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: '添加预览', authorName: 'Lin', authorEmail: 'lin@example.com', committedAt: 1_700_000_000, parents: ['b'.repeat(40)] };
const second: HistoryCommitSummary = { ...first, oid: 'b'.repeat(40), shortHash: 'bbbbbbb', subject: '初始化', parents: [] };
const file = { path: 'src/main.ts', oldPath: null, status: 'M', oldMode: '100644', newMode: '100644' };
const otherFile = { ...file, path: 'README.md' };
const textDiff: HistoryDiff = { original: 'before\n', modified: 'after\n', notice: null };
const detail: HistoryCommitDetail = { commit: first, message: '添加预览\n\n完整说明', parentOid: second.oid, parentIndex: 0, files: [file, otherFile] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function state(target = worktree) { return useHistory.getState().sessions[target.id]; }
function calls(command: string) { return mockedInvoke.mock.calls.filter(([name]) => name === command); }

beforeEach(() => {
  useHistory.getState().reset();
  mockedInvoke.mockReset();
  mockedInvoke.mockImplementation(async (command, args) => {
    if (command === 'git_history_ref') return { oid: first.oid };
    if (command === 'git_history') return { commits: [first, second], nextCursor: null };
    if (command === 'git_commit_detail') {
      const { oid, parentIndex } = args as { oid: string; parentIndex: number };
      return { ...detail, commit: oid === first.oid ? first : second, parentIndex };
    }
    if (command === 'git_commit_diff') return textDiff;
    throw new Error(`意外命令：${command}`);
  });
});

describe('历史初次加载与选择联动', () => {
  it('首屏只加载所选提交和文件正文，始终携带 repoPath', async () => {
    await useHistory.getState().ensure(worktree);
    expect(state()).toMatchObject({ initialized: true, selectedOid: first.oid, selectedPath: file.path, loading: false });
    expect(state().diff.file).toMatchObject({ path: file.path, head: textDiff.original, index: textDiff.modified });
    expect(calls('git_commit_detail')).toHaveLength(1);
    expect(calls('git_commit_diff')).toHaveLength(1);
    for (const [, args] of mockedInvoke.mock.calls) expect(args).toHaveProperty('repoPath', worktree.path);
    await useHistory.getState().ensure(worktree);
    await useHistory.getState().selectFile(worktree, file.path);
    expect(calls('git_history')).toHaveLength(1);
    expect(calls('git_commit_diff')).toHaveLength(1);
  });

  it('切换提交优先保留路径，路径消失时选首个文件', async () => {
    await useHistory.getState().ensure(worktree);
    await useHistory.getState().selectFile(worktree, otherFile.path);
    await useHistory.getState().selectCommit(worktree, second.oid);
    expect(state().selectedPath).toBe(otherFile.path);
    mockedInvoke.mockImplementation(async command => command === 'git_commit_detail' ? { ...detail, files: [file] } : textDiff);
    await useHistory.getState().selectCommit(worktree, first.oid);
    expect(state().selectedPath).toBe(file.path);
  });

  it('切换合并父提交会同步更新文件列表与差异比较对象', async () => {
    await useHistory.getState().ensure(worktree);
    mockedInvoke.mockImplementation(async command => command === 'git_commit_detail' ? { ...detail, parentIndex: 1, parentOid: 'c'.repeat(40), files: [otherFile] } : textDiff);
    await useHistory.getState().selectParent(worktree, 1);
    expect(state()).toMatchObject({ parentIndex: 1, selectedPath: otherFile.path });
    expect(mockedInvoke).toHaveBeenLastCalledWith('git_commit_diff', { repoPath: worktree.path, oid: first.oid, parentIndex: 1, path: otherFile.path });
  });

  it('空提交清空文件选择；空分支不请求正文', async () => {
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_history_ref') return { oid: first.oid };
      if (command === 'git_history') return { commits: [first], nextCursor: null };
      if (command === 'git_commit_detail') return { ...detail, files: [] };
      throw new Error('不应加载正文');
    });
    await useHistory.getState().ensure(worktree);
    expect(state().selectedPath).toBeNull();
    expect(state().diff.file).toBeNull();
    mockedInvoke.mockResolvedValue({ oid: null });
    await useHistory.getState().refresh(worktree);
    expect(state()).toMatchObject({ commits: [], selectedOid: null, detail: null });
    expect(calls('git_commit_diff')).toHaveLength(0);
  });

  it('历史适配保留重命名、删除与不可展示原因，不从工作区补正文', async () => {
    expect(historyFileSnapshot({ ...file, status: 'R', oldPath: 'old.ts' })).toMatchObject({ head: null, index: null, working: null, git: { statusIndex: 'R', originalPath: 'old.ts' } });
    await useHistory.getState().ensure(worktree);
    mockedInvoke.mockResolvedValue({ original: null, modified: null, notice: '二进制文件' });
    await useHistory.getState().selectFile(worktree, otherFile.path);
    expect(state().diff).toMatchObject({ notice: '二进制文件', file: { head: null, index: null } });
  });
});

describe('历史请求竞态与工作区隔离', () => {
  it('防抖尚未生效时保留每个工作区的搜索输入，不提前发送查询', async () => {
    await useHistory.getState().ensure(worktree);
    await useHistory.getState().ensure(secondWorktree);
    mockedInvoke.mockClear();
    useHistory.getState().setSearchInput(worktree, '尚未完成的查询');
    await useHistory.getState().ensure(secondWorktree);
    useHistory.getState().setSearchInput(secondWorktree, '其他工作区');
    await useHistory.getState().ensure(worktree);
    expect(state()).toMatchObject({ searchInput: '尚未完成的查询', query: '' });
    expect(state(secondWorktree)).toMatchObject({ searchInput: '其他工作区', query: '' });
    expect(mockedInvoke).not.toHaveBeenCalled();
    await useHistory.getState().setQuery(worktree, '防抖提交的查询');
    expect(state()).toMatchObject({ searchInput: '尚未完成的查询', query: '防抖提交的查询' });
    useHistory.getState().setSearchInput(worktree, '');
    expect(state().searchInput).toBe('');
    useHistory.getState().reset();
    expect(useHistory.getState().sessions).toEqual({});
  });

  it('快速切换提交时丢弃旧详情，不会覆盖新文件树', async () => {
    await useHistory.getState().ensure(worktree);
    const delayed = deferred<HistoryCommitDetail>();
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === 'git_commit_detail') return (args as { oid: string }).oid === second.oid ? delayed.promise : detail;
      return textDiff;
    });
    const old = useHistory.getState().selectCommit(worktree, second.oid);
    await useHistory.getState().selectCommit(worktree, first.oid);
    delayed.resolve({ ...detail, commit: second, files: [otherFile] });
    await old;
    expect(state().detail?.commit.oid).toBe(first.oid);
    expect(state().selectedPath).toBe(file.path);
  });

  it('快速切换文件和关闭文件会淘汰迟到正文', async () => {
    await useHistory.getState().ensure(worktree);
    await useHistory.getState().selectFile(worktree, otherFile.path);
    const delayed = deferred<HistoryDiff>();
    mockedInvoke.mockImplementation(async (_, args) => (args as { path: string }).path === file.path ? delayed.promise : { ...textDiff, modified: 'readme' });
    const old = useHistory.getState().selectFile(worktree, file.path);
    await useHistory.getState().selectFile(worktree, otherFile.path);
    delayed.resolve({ ...textDiff, modified: 'old' });
    await old;
    expect(state().diff.file?.index).toBe('readme');
    const closing = deferred<HistoryDiff>();
    mockedInvoke.mockReturnValue(closing.promise);
    const pending = useHistory.getState().selectFile(worktree, file.path);
    useHistory.getState().closeFile(worktree);
    closing.resolve(textDiff);
    await pending;
    expect(state().selectedPath).toBeNull();
    expect(state().diff.file).toBeNull();
  });

  it('搜索和分支快速切换不会串入旧查询结果', async () => {
    await useHistory.getState().ensure(worktree);
    const delayed = deferred<HistoryPage>();
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === 'git_history_ref') return { oid: first.oid };
      if (command === 'git_history') return (args as { query: string }).query === 'old' ? delayed.promise : { commits: [], nextCursor: null };
      return detail;
    });
    const old = useHistory.getState().setQuery(worktree, 'old');
    await vi.waitFor(() => expect(calls('git_history')).toHaveLength(2));
    await useHistory.getState().setQuery(worktree, 'new');
    delayed.resolve({ commits: [second], nextCursor: null });
    await old;
    expect(state()).toMatchObject({ query: 'new', commits: [], selectedOid: null });
    await useHistory.getState().setReference(worktree, 'refs/remotes/origin/topic');
    expect(mockedInvoke).toHaveBeenCalledWith('git_history_ref', { repoPath: worktree.path, reference: 'refs/remotes/origin/topic' });
    expect(mockedInvoke.mock.calls.some(([command]) => command === 'git_checkout')).toBe(false);
  });

  it('多个 worktree 保留各自筛选和选择，重置淘汰所有在途响应', async () => {
    await useHistory.getState().ensure(worktree);
    await useHistory.getState().setQuery(worktree, 'preview');
    await useHistory.getState().selectFile(worktree, otherFile.path);
    await useHistory.getState().ensure(secondWorktree);
    expect(state()).toMatchObject({ query: 'preview', selectedPath: otherFile.path });
    expect(state(secondWorktree)).toMatchObject({ query: '', selectedPath: file.path });
    const pending = deferred<{ oid: string }>();
    mockedInvoke.mockReturnValue(pending.promise);
    const refresh = useHistory.getState().refresh(worktree);
    useHistory.getState().reset();
    pending.resolve({ oid: first.oid });
    await refresh;
    expect(useHistory.getState().sessions).toEqual({});
  });
});

describe('历史分页、静默检测与错误恢复', () => {
  it('推送后仅上游改变也更新标识，不重置正在阅读的提交和 Diff', async () => {
    const original = mockedInvoke.getMockImplementation()!;
    let oids = [first.oid];
    mockedInvoke.mockImplementation(async (command, args) => command === 'git_history_ref'
      ? { oid: first.oid, outgoing: { upstream: 'refs/remotes/origin/main', oids } } : original(command, args));
    await useHistory.getState().ensure(worktree);
    expect(state().outgoing?.oids).toEqual([first.oid]);
    const before = state().diff;
    oids = [];
    await useHistory.getState().checkForUpdates(worktree);
    expect(state().outgoing?.oids).toEqual([]);
    expect(state().updated).toBe(false);
    expect(state().diff).toBe(before);
    expect(calls('git_history')).toHaveLength(1);
  });

  it('筛选和分页保留完整待推送集合，失败时只移除标识并保留历史', async () => {
    const original = mockedInvoke.getMockImplementation()!;
    const outgoing = { upstream: 'refs/remotes/origin/main', oids: [second.oid] };
    mockedInvoke.mockImplementation(async (command, args) => command === 'git_history_ref'
      ? { oid: first.oid, outgoing } : command === 'git_history'
        ? { commits: [first], nextCursor: 'more' } : original(command, args));
    await useHistory.getState().ensure(worktree);
    expect(state().outgoing).toEqual(outgoing);
    mockedInvoke.mockResolvedValue({ commits: [second], nextCursor: null });
    await useHistory.getState().loadMore(worktree);
    expect(state().outgoing?.oids).toEqual([second.oid]);
    mockedInvoke.mockRejectedValue('读取失败');
    await useHistory.getState().checkForUpdates(worktree);
    expect(state().outgoing).toBeNull();
    expect(state().commits).toEqual([first, second]);
  });

  it('分页沿用固定快照并追加，当前阅读状态不变', async () => {
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_history_ref') return { oid: first.oid };
      if (command === 'git_history') return { commits: [first], nextCursor: 'cursor-50' };
      if (command === 'git_commit_detail') return detail;
      return textDiff;
    });
    await useHistory.getState().ensure(worktree);
    const before = state().diff;
    mockedInvoke.mockResolvedValue({ commits: [second], nextCursor: null });
    await useHistory.getState().loadMore(worktree);
    expect(state().commits.map(commit => commit.oid)).toEqual([first.oid, second.oid]);
    expect(state().diff).toBe(before);
    expect(mockedInvoke).toHaveBeenLastCalledWith('git_history', { repoPath: worktree.path, snapshot: first.oid, query: '', cursor: 'cursor-50' });
  });

  it('检测只读取目标引用；变化后保留正文并提示手动刷新', async () => {
    await useHistory.getState().ensure(worktree);
    const before = state().diff;
    await useHistory.getState().checkForUpdates(worktree);
    expect(state().updated).toBe(false);
    mockedInvoke.mockResolvedValue({ oid: 'c'.repeat(40) });
    await useHistory.getState().checkForUpdates(worktree);
    expect(state().updated).toBe(true);
    expect(state().diff).toBe(before);
    expect(calls('git_history')).toHaveLength(1);
    expect(calls('git_commit_diff')).toHaveLength(1);
  });

  it('手动刷新保留仍在首屏的提交、父提交、文件和 Diff 对象', async () => {
    await useHistory.getState().ensure(worktree);
    await useHistory.getState().selectParent(worktree, 1);
    await useHistory.getState().selectFile(worktree, otherFile.path);
    const before = state().diff;
    await useHistory.getState().refresh(worktree);
    expect(state()).toMatchObject({ selectedOid: first.oid, parentIndex: 1, selectedPath: otherFile.path });
    expect(state().diff).toBe(before);
    expect(calls('git_commit_detail')).toHaveLength(2);
  });

  it('刷新和引用删除失败保留内容，重试成功清理错误', async () => {
    await useHistory.getState().ensure(worktree);
    const before = state();
    mockedInvoke.mockRejectedValue('分支已删除');
    await useHistory.getState().checkForUpdates(worktree);
    expect(state().checkError).toBe('分支已删除');
    await useHistory.getState().refresh(worktree);
    expect(state().error).toBe('分支已删除');
    expect(state().commits).toBe(before.commits);
    expect(state().diff).toBe(before.diff);
    mockedInvoke.mockImplementation(async command => command === 'git_history_ref' ? { oid: first.oid } : { commits: [first, second], nextCursor: null });
    await useHistory.getState().refresh(worktree);
    expect(state()).toMatchObject({ error: null, checkError: null });
  });

  it('详情与文件错误可以分别重试，不清空已加载的列表', async () => {
    await useHistory.getState().ensure(worktree);
    mockedInvoke.mockRejectedValue('详情读取失败');
    await useHistory.getState().selectCommit(worktree, second.oid);
    expect(state().detailError).toBe('详情读取失败');
    expect(state().commits).toHaveLength(2);
    mockedInvoke.mockImplementation(async command => command === 'git_commit_detail' ? { ...detail, commit: second } : textDiff);
    await useHistory.getState().selectCommit(worktree, second.oid);
    expect(state().detailError).toBeNull();
    mockedInvoke.mockRejectedValue('正文读取失败');
    await useHistory.getState().selectFile(worktree, otherFile.path);
    expect(state().diff.error).toBe('正文读取失败');
    mockedInvoke.mockResolvedValue(textDiff);
    await useHistory.getState().selectFile(worktree, otherFile.path);
    expect(state().diff).toMatchObject({ error: null, file: { path: otherFile.path } });
  });

  it('分页错误保留已有记录，重试不会重复追加', async () => {
    await useHistory.getState().ensure(worktree);
    useHistory.setState({ sessions: { [worktree.id]: { ...state(), nextCursor: 'next' } } });
    mockedInvoke.mockRejectedValue('暂时无法读取');
    await useHistory.getState().loadMore(worktree);
    expect(state().commits).toHaveLength(2);
    expect(state().nextCursor).toBe('next');
    mockedInvoke.mockResolvedValue({ commits: [{ ...first, oid: 'c'.repeat(40) }], nextCursor: null });
    await useHistory.getState().loadMore(worktree);
    expect(state().commits).toHaveLength(3);
    expect(state().error).toBeNull();
  });
});


describe('浏览器演示与暂存状态隔离', () => {
  const demo: Worktree = {
    ...worktree, source: undefined, id: 'demo', path: '~/Projects/demo', branch: 'main',
    commits: Array.from({ length: 123 }, (_, index) => ({
      id: index.toString(16).padStart(8, '0'), message: `演示提交 ${index}`, description: index === 121 ? '仅正文命中的目标内容' : '',
      author: 'Demo User', date: new Date(1_700_000_000_000 - index * 1000).toISOString(),
      files: [{ id: 'src/main.ts', path: 'src/main.ts', language: 'typescript', head: 'before', index: `after ${index}`, working: 'unrelated' }],
    })),
  };

  it('三页加载使用固定快照，搜索可以命中未加载的正文', async () => {
    await useHistory.getState().ensure(demo);
    expect(state(demo).commits).toHaveLength(50);
    await useHistory.getState().loadMore(demo);
    await useHistory.getState().loadMore(demo);
    expect(state(demo).commits).toHaveLength(123);
    expect(new Set(state(demo).commits.map(commit => commit.oid)).size).toBe(123);
    await useHistory.getState().setQuery(demo, '目标内容');
    expect(state(demo).commits.map(commit => commit.subject)).toEqual(['演示提交 121']);
    expect(state(demo).diff.file?.index).toBe('after 121');
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('演示分支筛选改变历史文件而不切换活动 worktree，也不改变本地草稿和暂存状态', async () => {
    const sibling: Worktree = { ...demo, id: 'demo-other', branch: 'feature/preview', commits: [{ ...demo.commits[0], message: '预览分支', files: [{ ...demo.commits[0].files[0], index: 'preview branch' }] }] };
    useWorkbench.setState({ repositories: [{ id: 'demo-repo', name: 'demo', worktrees: [demo, sibling] }], activeWorktreeId: demo.id, drafts: { [demo.id]: { message: '未保存的提交草稿' } }, selection: { fileId: 'src/main.ts', area: 'unstaged' }, busy: false });
    const original = useWorkbench.getState();
    await useHistory.getState().ensure(demo);
    const firstOid = state(demo).selectedOid;
    await useHistory.getState().setReference(demo, 'refs/heads/feature/preview');
    expect(state(demo).commits[0].subject).toBe('预览分支');
    expect(state(demo).diff.file?.index).toBe('preview branch');
    expect(state(demo).selectedOid).not.toBe(firstOid);
    const after = useWorkbench.getState();
    expect(after.repositories).toBe(original.repositories);
    expect(after.activeWorktreeId).toBe(demo.id);
    expect(after.drafts).toBe(original.drafts);
    expect(after.selection).toBe(original.selection);
    expect(after.busy).toBe(false);
  });
});
