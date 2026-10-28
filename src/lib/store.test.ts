import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getChanges, getFileStatus } from './demo-git';
import { toWorktree } from './native-git';
import type { GitBranch } from './types';
import type { NativeRepository } from './native-git';
import { findWorktree, useWorkbench } from './store';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));

const mockedInvoke = vi.mocked(invoke);
const mainMetadata = {
  path: '/test/repository', name: 'repository', branch: 'main', detached: false,
  bare: false, isMain: true, locked: null, prunable: null, available: true,
};
const linkedMetadata = { ...mainMetadata, path: '/test/linked', name: 'linked', branch: 'feature', isMain: false };
const baseRepository: NativeRepository = {
  commonDir: '/test/repository/.git', repositoryName: 'repository', worktrees: [mainMetadata],
  path: '/test/repository', name: 'repository', branch: 'main', hasHead: true, operation: null,
  remote: { remotes: [], upstream: null, upstreamRemote: null, upstreamBranch: null, defaultRemote: null, ahead: null, behind: null },
  files: [
    { path: 'first.ts', originalPath: null, statusIndex: ' ', statusWorktree: 'M', conflicted: false },
    { path: 'second.ts', originalPath: null, statusIndex: 'M', statusWorktree: 'M', conflicted: false },
  ],
};
const mainBranch: GitBranch = {
  fullName: 'refs/heads/main', name: 'main', kind: 'local', current: true,
  worktreePath: '/test/repository', upstream: null, localName: null, ahead: null, behind: null,
  lastCommit: { shortHash: '1234567', author: '测试作者', subject: '初始提交', committedAt: 1_700_000_000 },
};
const featureBranch: GitBranch = {
  ...mainBranch, fullName: 'refs/heads/feature', name: 'feature', current: false, worktreePath: null,
};
const textDiff = { original: 'before\n', modified: 'after\n', notice: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function currentWorktree() {
  const state = useWorkbench.getState();
  return findWorktree(state.repositories, state.activeWorktreeId)!;
}

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true);
  mockedInvoke.mockReset();
  useWorkbench.getState().reset();
  mockedInvoke.mockImplementation(async command => {
    if (command === 'git_open' || command === 'git_status') return baseRepository;
    if (command === 'git_diff') return textDiff;
    if (command === 'git_commit') return { commitId: 'abc123' };
    if (command === 'git_branches') return [mainBranch, featureBranch];
    return undefined;
  });
});

describe('真实仓库状态与正文', () => {
  it('桌面端从空状态开始；打开路径后只加载当前文件的差异', async () => {
    expect(useWorkbench.getState().repositories).toEqual([]);
    expect(findWorktree([], '')).toBeUndefined();
    await useWorkbench.getState().openRepository('/test/repository/subfolder');
    expect(mockedInvoke).toHaveBeenCalledWith('git_open', { path: '/test/repository/subfolder' });
    expect(currentWorktree().source).toBe('native');
    expect(currentWorktree().files.every(file => file.working === null)).toBe(true);
    expect(getChanges(currentWorktree(), 'unstaged')).toHaveLength(2);
    expect(getChanges(currentWorktree(), 'staged')).toHaveLength(1);
    expect(useWorkbench.getState().drafts).toEqual({});
    await vi.waitFor(() => expect(useWorkbench.getState().diff.file?.working).toBe('after\n'));
    expect(mockedInvoke.mock.calls.filter(([command]) => command === 'git_diff')).toHaveLength(1);
  });

  it('按 Git 元数据列出权限、重命名、冲突和空文件变化', () => {
    const worktree = toWorktree({
      ...baseRepository,
      files: [
        { path: 'renamed.ts', originalPath: 'old.ts', statusIndex: 'R', statusWorktree: ' ', conflicted: false },
        { path: 'empty.txt', originalPath: null, statusIndex: '?', statusWorktree: '?', conflicted: false },
        { path: 'executable.sh', originalPath: null, statusIndex: ' ', statusWorktree: 'M', conflicted: false },
        { path: 'conflict.ts', originalPath: null, statusIndex: 'U', statusWorktree: 'U', conflicted: true },
      ],
    });
    expect(getChanges(worktree, 'staged').map(file => file.path)).toEqual(['renamed.ts']);
    expect(getChanges(worktree, 'unstaged').map(file => file.path)).toEqual(['empty.txt', 'executable.sh', 'conflict.ts']);
    expect(worktree.files.map(file => getFileStatus(file, file.path === 'renamed.ts' ? 'staged' : 'unstaged'))).toEqual(['R', 'A', 'M', 'U']);
  });

  it('快速切换文件时忽略旧差异响应，关闭标签也不会被晚到响应重新打开', async () => {
    const first = deferred<typeof textDiff>();
    const second = deferred<typeof textDiff>();
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === 'git_open') return baseRepository;
      if (command === 'git_diff') return (args as { path: string }).path === 'first.ts' ? first.promise : second.promise;
      return undefined;
    });
    await useWorkbench.getState().openRepository('/test/repository');
    useWorkbench.getState().selectFile('second.ts', 'staged');
    second.resolve({ ...textDiff, modified: 'second\n' });
    await vi.waitFor(() => expect(useWorkbench.getState().diff.file?.index).toBe('second\n'));
    first.resolve({ ...textDiff, modified: 'first\n' });
    await first.promise;
    expect(useWorkbench.getState().diff.file?.id).toBe('second.ts');
    const closing = deferred<typeof textDiff>();
    mockedInvoke.mockReturnValue(closing.promise);
    useWorkbench.getState().selectFile('first.ts', 'unstaged');
    useWorkbench.getState().closeFile();
    closing.resolve(textDiff);
    await closing.promise;
    expect(useWorkbench.getState().selection).toBeNull();
    expect(useWorkbench.getState().diff.file).toBeNull();
  });

  it('保留无法显示文本的原因及读取失败信息', async () => {
    await useWorkbench.getState().openRepository('/test/repository');
    mockedInvoke.mockResolvedValue({ original: null, modified: null, notice: '二进制文件无法进行文本比较。' });
    useWorkbench.getState().selectFile('second.ts', 'staged');
    await vi.waitFor(() => expect(useWorkbench.getState().diff.notice).toContain('二进制'));
    mockedInvoke.mockRejectedValue('文件已被外部删除');
    useWorkbench.getState().selectFile('first.ts', 'unstaged');
    await vi.waitFor(() => expect(useWorkbench.getState().diff.error).toBe('文件已被外部删除'));
    expect(useWorkbench.getState().diff.file).toBeNull();
  });
});

describe('真实仓库写入', () => {
  it.each([
    ['修复刷新\n', '修复刷新', ''],
    ['修复刷新\n补充说明', '修复刷新', '补充说明'],
    ['\n  修复刷新\n\n说明第一段\n\n说明第二段\n\n', '修复刷新', '说明第一段\n\n说明第二段'],
  ])('完整草稿保留换行，提交时拆分标题与正文：%j', async (message, summary, description) => {
    await useWorkbench.getState().openRepository('/test/repository');
    useWorkbench.getState().setDraft({ message });
    expect(useWorkbench.getState().drafts[currentWorktree().id].message).toBe(message);
    await useWorkbench.getState().commit();
    expect(mockedInvoke).toHaveBeenCalledWith('git_commit', { repoPath: '/test/repository', summary, description });
    expect(useWorkbench.getState().drafts[currentWorktree().id]).toEqual({ message: '' });
  });

  it('只包含空白与换行的提交信息不能提交，且保留草稿', async () => {
    await useWorkbench.getState().openRepository('/test/repository');
    const message = '\n  \n';
    useWorkbench.getState().setDraft({ message });
    await expect(useWorkbench.getState().commit()).rejects.toThrow('请输入提交标题');
    expect(mockedInvoke.mock.calls.some(([command]) => command === 'git_commit')).toBe(false);
    expect(useWorkbench.getState().drafts[currentWorktree().id].message).toBe(message);
  });

  it('批量暂存通过一次原生请求提交全部精确路径，完成后统一刷新一次', async () => {
    await useWorkbench.getState().openRepository('/test/repository');
    mockedInvoke.mockClear();
    await useWorkbench.getState().stage(['first.ts', 'second.ts']);
    expect(mockedInvoke.mock.calls.filter(([command]) => command === 'git_stage')).toEqual([
      ['git_stage', { repoPath: '/test/repository', paths: ['first.ts', 'second.ts'] }],
    ]);
    expect(mockedInvoke.mock.calls.filter(([command]) => command === 'git_status')).toHaveLength(1);
    expect(useWorkbench.getState().busy).toBe(false);
  });

  it('批量请求失败后刷新实际索引状态并保留草稿', async () => {
    const repository = { ...baseRepository, files: [...baseRepository.files, { ...baseRepository.files[0], path: 'third.ts' }] };
    mockedInvoke.mockImplementation(async command => command === 'git_open' ? repository : textDiff);
    await useWorkbench.getState().openRepository('/test/repository');
    const draft = { message: '保留批量操作前的草稿' };
    useWorkbench.getState().setDraft(draft);
    mockedInvoke.mockClear();
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_stage') throw 'index.lock 已存在';
      if (command === 'git_status') return { ...repository, files: repository.files.map(file => file.path === 'first.ts' ? { ...file, statusIndex: 'M', statusWorktree: ' ' } : file) };
      return textDiff;
    });
    await expect(useWorkbench.getState().stage(['first.ts', 'second.ts', 'third.ts'])).rejects.toThrow('index.lock 已存在');
    expect(mockedInvoke.mock.calls.filter(([command]) => command === 'git_stage')).toHaveLength(1);
    expect(getChanges(currentWorktree(), 'unstaged').map(file => file.path)).toEqual(['second.ts', 'third.ts']);
    expect(useWorkbench.getState().drafts[currentWorktree().id]).toEqual(draft);
    expect(useWorkbench.getState().error).toContain('index.lock 已存在');
    expect(useWorkbench.getState().busy).toBe(false);
  });

  it.each(['stage', 'unstage'] as const)('批量 %s 一次传递文件及同名目录路径，由后端统一处理索引', async action => {
    const removed = { path: 'config', originalPath: null, statusIndex: action === 'stage' ? ' ' : 'D', statusWorktree: action === 'stage' ? 'D' : ' ', conflicted: false };
    const added = { ...removed, path: 'config/index.ts', statusIndex: action === 'stage' ? '?' : 'A', statusWorktree: action === 'stage' ? '?' : ' ' };
    const repository = { ...baseRepository, files: [added, removed] };
    mockedInvoke.mockImplementation(async command => command === 'git_open' || command === 'git_status' ? repository : textDiff);
    await useWorkbench.getState().openRepository('/test/repository');
    mockedInvoke.mockClear();
    await useWorkbench.getState()[action]([added.path, removed.path]);
    expect(mockedInvoke.mock.calls.filter(([command]) => command === `git_${action}`))
      .toEqual([[`git_${action}`, { repoPath: '/test/repository', paths: [added.path, removed.path] }]]);
  });

  it('演示模式批量暂存与取消暂存保留未选中的文件和工作区正文', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    useWorkbench.getState().reset();
    const original = currentWorktree();
    const selected = getChanges(original, 'unstaged').slice(0, 2);
    const ids = selected.map(file => file.id);
    await useWorkbench.getState().stage(ids);
    expect(getChanges(currentWorktree(), 'unstaged').some(file => ids.includes(file.id))).toBe(false);
    await useWorkbench.getState().unstage(ids);
    for (const file of currentWorktree().files) {
      const before = original.files.find(item => item.id === file.id)!;
      expect(file.working).toBe(before.working);
      if (!ids.includes(file.id)) expect(file).toEqual(before);
    }
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('提交失败保留草稿和文件状态，错误可用于提示身份或 hook 问题', async () => {
    await useWorkbench.getState().openRepository('/test/repository');
    const draft = { message: '修复文件\n\n保留未暂存内容' };
    useWorkbench.getState().setDraft(draft);
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_commit') throw 'Author identity unknown';
      return textDiff;
    });
    await expect(useWorkbench.getState().commit()).rejects.toThrow('Author identity unknown');
    expect(useWorkbench.getState().drafts[currentWorktree().id]).toEqual(draft);
    expect(getChanges(currentWorktree(), 'staged')).toHaveLength(1);
    expect(useWorkbench.getState().busy).toBe(false);
  });

  it('提交成功清空本仓库草稿，后续刷新失败仍返回成功 hash', async () => {
    await useWorkbench.getState().openRepository('/test/repository');
    useWorkbench.getState().setDraft({ message: '修复文件' });
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_commit') return { commitId: 'abc123' };
      if (command === 'git_status') throw '仓库暂时不可用';
      return textDiff;
    });
    await expect(useWorkbench.getState().commit()).resolves.toBe('abc123');
    expect(useWorkbench.getState().drafts[currentWorktree().id]).toEqual({ message: '' });
    expect(useWorkbench.getState().error).toBe('操作已完成，但刷新失败：仓库暂时不可用');
    expect(useWorkbench.getState().busy).toBe(false);
  });

  it('写操作串行并锁定工作区；旧刷新不能覆盖暂存后的状态', async () => {
    await useWorkbench.getState().openRepository('/test/repository');
    const oldStatus = deferred<NativeRepository>();
    const staging = deferred<void>();
    const staged = { ...baseRepository, files: baseRepository.files.map(file => ({ ...file, statusIndex: 'M', statusWorktree: ' ' })) };
    let statusCalls = 0;
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_status') return ++statusCalls === 1 ? oldStatus.promise : staged;
      if (command === 'git_stage') return staging.promise;
      return textDiff;
    });
    const refreshing = useWorkbench.getState().refresh();
    const stage = useWorkbench.getState().stage('first.ts');
    expect(useWorkbench.getState().busy).toBe(true);
    await expect(useWorkbench.getState().unstage('second.ts')).rejects.toThrow('正在进行');
    useWorkbench.getState().selectWorktree('other');
    expect(useWorkbench.getState().activeWorktreeId).toBe('native:/test/repository');
    staging.resolve();
    await stage;
    oldStatus.resolve(baseRepository);
    await refreshing;
    expect(getChanges(currentWorktree(), 'unstaged')).toHaveLength(0);
    expect(getChanges(currentWorktree(), 'staged')).toHaveLength(2);
    expect(useWorkbench.getState().busy).toBe(false);
    expect(useWorkbench.getState().refreshing).toBe(false);
  });

  it('提交期间新输入的草稿不会被成功回调清除', async () => {
    await useWorkbench.getState().openRepository('/test/repository');
    useWorkbench.getState().setDraft({ message: '本次提交' });
    const committing = deferred<{ commitId: string }>();
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_commit') return committing.promise;
      if (command === 'git_status') return baseRepository;
      return textDiff;
    });
    const commit = useWorkbench.getState().commit();
    const nextDraft = { message: '下次提交' };
    useWorkbench.getState().setDraft(nextDraft);
    committing.resolve({ commitId: 'abc123' });
    await commit;
    expect(useWorkbench.getState().drafts[currentWorktree().id]).toEqual(nextDraft);
  });

  it('浏览器预览继续使用演示数据，不调用真实 Git', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    useWorkbench.getState().reset();
    const worktree = currentWorktree();
    expect(worktree.source).toBeUndefined();
    await useWorkbench.getState().stage(worktree.files[0].id);
    expect(getChanges(currentWorktree(), 'staged')).toHaveLength(4);
    await expect(useWorkbench.getState().commit()).resolves.toHaveLength(8);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});


describe('worktree 发现与归组', () => {
  it('从 linked worktree 打开时列出全部目录，重复打开同仓库不重复分组或丢失草稿', async () => {
    const main = { ...baseRepository, worktrees: [mainMetadata, linkedMetadata] };
    const linked = { ...main, path: linkedMetadata.path, name: linkedMetadata.name, branch: 'feature', files: [] };
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === 'git_open' || command === 'git_status') {
        return (args as { path?: string; repoPath?: string }).path === linked.path ? linked : main;
      }
      return textDiff;
    });
    await useWorkbench.getState().openRepository(linked.path);
    expect(useWorkbench.getState().repositories).toHaveLength(1);
    expect(useWorkbench.getState().repositories[0].worktrees.map(item => item.path)).toEqual([main.path, linked.path]);
    expect(currentWorktree().branch).toBe('feature');
    const linkedDraft = { message: '分支草稿\n\n保留' };
    useWorkbench.getState().setDraft(linkedDraft);
    await useWorkbench.getState().openRepository(main.path);
    const mainDraft = { message: '主目录草稿' };
    useWorkbench.getState().setDraft(mainDraft);
    await useWorkbench.getState().openRepository(linked.path);
    expect(useWorkbench.getState().repositories).toHaveLength(1);
    expect(useWorkbench.getState().repositories[0].id).toBe('native-repository:/test/repository/.git');
    expect(findWorktree(useWorkbench.getState().repositories, `native:${main.path}`)?.files).toHaveLength(2);
    expect(useWorkbench.getState().drafts).toEqual({ [`native:${main.path}`]: mainDraft, [`native:${linked.path}`]: linkedDraft });
  });

  it('切换目录立即清空旧差异；新状态到达前不显示上一目录内容', async () => {
    const main = { ...baseRepository, worktrees: [mainMetadata, linkedMetadata] };
    const pending = deferred<NativeRepository>();
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_open') return main;
      if (command === 'git_status') return pending.promise;
      return textDiff;
    });
    await useWorkbench.getState().openRepository(main.path);
    await vi.waitFor(() => expect(useWorkbench.getState().diff.file?.path).toBe('first.ts'));
    useWorkbench.getState().selectWorktree(`native:${linkedMetadata.path}`);
    expect(useWorkbench.getState().selection).toBeNull();
    expect(useWorkbench.getState().diff.file).toBeNull();
    expect(useWorkbench.getState().refreshing).toBe(true);
    pending.resolve({ ...main, path: linkedMetadata.path, name: 'linked', branch: 'feature', files: [] });
    await vi.waitFor(() => expect(useWorkbench.getState().refreshing).toBe(false));
    expect(currentWorktree().path).toBe(linkedMetadata.path);
    expect(currentWorktree().files).toEqual([]);
  });

  it('刷新同步新增和删除的 worktree，同时保留已有目录缓存', async () => {
    const main = { ...baseRepository, worktrees: [mainMetadata, linkedMetadata] };
    mockedInvoke.mockImplementation(async command => command === 'git_open' || command === 'git_status' ? main : textDiff);
    await useWorkbench.getState().openRepository(main.path);
    const another = { ...linkedMetadata, path: '/test/another', name: 'another', branch: 'next' };
    mockedInvoke.mockImplementation(async command => command === 'git_status'
      ? { ...main, worktrees: [mainMetadata, another] } : textDiff);
    await useWorkbench.getState().refresh();
    expect(useWorkbench.getState().repositories[0].worktrees.map(item => item.path)).toEqual([main.path, another.path]);
    expect(currentWorktree().files).toHaveLength(2);
  });

  it('不可用目录和裸仓库保持可见，但不能切换为当前工作目录', async () => {
    const missing = { ...linkedMetadata, available: false, prunable: 'gitdir file points to non-existent location' };
    mockedInvoke.mockImplementation(async command => command === 'git_open'
      ? { ...baseRepository, worktrees: [mainMetadata, missing] } : textDiff);
    await useWorkbench.getState().openRepository(baseRepository.path);
    useWorkbench.getState().selectWorktree(`native:${missing.path}`);
    expect(currentWorktree().path).toBe(baseRepository.path);
    expect(useWorkbench.getState().error).toContain('不可用');
  });
});

describe('真实分支列表与切换', () => {
  it('加载全部引用；切换工作目录后晚到的列表不能覆盖新目录', async () => {
    const main = { ...baseRepository, worktrees: [mainMetadata, linkedMetadata] };
    const oldBranches = deferred<GitBranch[]>();
    let calls = 0;
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === 'git_open') return main;
      if (command === 'git_status') return { ...main, path: (args as { repoPath: string }).repoPath, branch: 'feature', files: [] };
      if (command === 'git_branches') return ++calls === 1 ? oldBranches.promise : [{ ...featureBranch, current: true }];
      return textDiff;
    });
    await useWorkbench.getState().openRepository(main.path);
    const loading = useWorkbench.getState().loadBranches();
    useWorkbench.getState().selectWorktree(`native:${linkedMetadata.path}`);
    await vi.waitFor(() => expect(useWorkbench.getState().refreshing).toBe(false));
    await useWorkbench.getState().loadBranches();
    oldBranches.resolve([mainBranch]);
    await loading;
    expect(useWorkbench.getState().branches.items).toEqual([{ ...featureBranch, current: true }]);
  });

  it('分支列表读取失败单独显示错误，不改变工作目录内容', async () => {
    await useWorkbench.getState().openRepository(baseRepository.path);
    mockedInvoke.mockRejectedValue('无法读取引用');
    await useWorkbench.getState().loadBranches();
    expect(useWorkbench.getState().branches).toEqual({ items: [], loading: false, error: '无法读取引用' });
    expect(currentWorktree().files).toHaveLength(2);
    expect(useWorkbench.getState().error).toBeNull();
  });

  it('切换失败保留原分支、选中文件和草稿', async () => {
    await useWorkbench.getState().openRepository(baseRepository.path);
    const draft = { message: '继续编辑\n\n未提交' };
    useWorkbench.getState().setDraft(draft);
    const previousSelection = useWorkbench.getState().selection;
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_checkout') throw '本地修改将被覆盖';
      return textDiff;
    });
    await expect(useWorkbench.getState().checkoutBranch('refs/heads/feature')).rejects.toThrow('本地修改将被覆盖');
    expect(currentWorktree().branch).toBe('main');
    expect(currentWorktree().files).toHaveLength(2);
    expect(useWorkbench.getState().selection).toEqual(previousSelection);
    expect(useWorkbench.getState().drafts[currentWorktree().id]).toEqual(draft);
    expect(useWorkbench.getState().busy).toBe(false);
  });

  it('切换成功刷新工作目录及分支列表，保留草稿并展示新分支状态', async () => {
    await useWorkbench.getState().openRepository(baseRepository.path);
    const draft = { message: '下一次提交' };
    useWorkbench.getState().setDraft(draft);
    const switched = { ...baseRepository, branch: 'feature', worktrees: [{ ...mainMetadata, branch: 'feature' }, linkedMetadata], files: [] };
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_checkout') return { branch: 'feature' };
      if (command === 'git_status') return switched;
      if (command === 'git_branches') return [{ ...mainBranch, current: false }, { ...featureBranch, current: true }];
      return textDiff;
    });
    await expect(useWorkbench.getState().checkoutBranch('refs/heads/feature')).resolves.toEqual({ branch: 'feature', warning: null });
    expect(mockedInvoke).toHaveBeenCalledWith('git_checkout', { repoPath: baseRepository.path, fullName: 'refs/heads/feature' });
    expect(currentWorktree().branch).toBe('feature');
    expect(useWorkbench.getState().repositories[0].worktrees).toHaveLength(2);
    expect(useWorkbench.getState().selection).toBeNull();
    expect(useWorkbench.getState().diff.file).toBeNull();
    expect(useWorkbench.getState().drafts[currentWorktree().id]).toEqual(draft);
    expect(useWorkbench.getState().branches.items.find(branch => branch.current)?.name).toBe('feature');
  });

  it('切换完成但刷新失败仍返回成功分支名，并清掉旧文件避免误操作', async () => {
    await useWorkbench.getState().openRepository(baseRepository.path);
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_checkout') return { branch: 'feature' };
      if (command === 'git_status') throw '目录暂时不可用';
      if (command === 'git_branches') return [{ ...featureBranch, current: true }];
      return textDiff;
    });
    await expect(useWorkbench.getState().checkoutBranch('refs/heads/feature')).resolves.toEqual({ branch: 'feature', warning: null });
    expect(currentWorktree().branch).toBe('feature');
    expect(currentWorktree().files).toEqual([]);
    expect(useWorkbench.getState().diff.file).toBeNull();
    expect(useWorkbench.getState().error).toBe('操作已完成，但刷新失败：目录暂时不可用');
  });

  it('post-checkout hook 警告仍按切换成功刷新，提示保留到界面', async () => {
    await useWorkbench.getState().openRepository(baseRepository.path);
    const warning = 'post-checkout hook 执行失败，请检查 hook 日志。';
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_checkout') return { branch: 'feature', warning };
      if (command === 'git_status') return { ...baseRepository, branch: 'feature', files: [] };
      if (command === 'git_branches') return [{ ...featureBranch, current: true }];
      return textDiff;
    });
    await expect(useWorkbench.getState().checkoutBranch('refs/heads/feature')).resolves.toEqual({ branch: 'feature', warning });
    expect(currentWorktree().branch).toBe('feature');
    expect(currentWorktree().files).toEqual([]);
    expect(useWorkbench.getState().error).toBe(`已切换到 feature，但 ${warning}`);
    expect(useWorkbench.getState().busy).toBe(false);
  });

  it('切换分支期间禁止重复写操作及更换目录', async () => {
    await useWorkbench.getState().openRepository(baseRepository.path);
    const pending = deferred<{ branch: string }>();
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_checkout') return pending.promise;
      if (command === 'git_status') return baseRepository;
      if (command === 'git_branches') return [mainBranch];
      return textDiff;
    });
    const switching = useWorkbench.getState().checkoutBranch('refs/heads/feature');
    await expect(useWorkbench.getState().stage('first.ts')).rejects.toThrow('正在进行');
    await expect(useWorkbench.getState().checkoutBranch('refs/heads/main')).rejects.toThrow('正在进行');
    useWorkbench.getState().selectWorktree('another');
    expect(currentWorktree().path).toBe(baseRepository.path);
    pending.resolve({ branch: 'feature' });
    await switching;
    expect(useWorkbench.getState().busy).toBe(false);
  });
});

describe('自动刷新保留阅读与编辑状态', () => {
  it('状态相同仍读取正文，读取期间保留 Diff 和草稿且不锁定界面', async () => {
    await useWorkbench.getState().openRepository('/test/repository');
    const previous = useWorkbench.getState().diff;
    const draft = { message: '尚未提交\n\n保留说明' };
    useWorkbench.getState().setDraft(draft);
    useWorkbench.setState({ error: '之前的提交错误' });
    const response = deferred<typeof textDiff>();
    mockedInvoke.mockImplementation(async command => command === 'git_status' ? baseRepository : response.promise);
    const refresh = useWorkbench.getState().refresh({ silent: true });
    await vi.waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith('git_diff', { repoPath: '/test/repository', path: 'first.ts', area: 'unstaged' }));
    expect(useWorkbench.getState()).toMatchObject({ refreshing: false, busy: false, autoRefreshing: true, diff: previous });
    response.resolve({ ...textDiff, modified: '外部编辑后的内容\n' });
    await refresh;
    expect(useWorkbench.getState().diff.file?.working).toBe('外部编辑后的内容\n');
    expect(useWorkbench.getState().drafts[currentWorktree().id]).toEqual(draft);
    expect(useWorkbench.getState().error).toBe('之前的提交错误');
    expect(useWorkbench.getState().autoRefreshing).toBe(false);
  });

  it('正文与状态没有变化时复用当前 Diff 对象', async () => {
    await useWorkbench.getState().openRepository('/test/repository');
    const diff = useWorkbench.getState().diff;
    await useWorkbench.getState().refresh({ silent: true });
    expect(useWorkbench.getState().diff).toBe(diff);
  });

  it('静默读取失败保留上次正文，后续成功消除更新错误', async () => {
    await useWorkbench.getState().openRepository('/test/repository');
    const diff = useWorkbench.getState().diff;
    mockedInvoke.mockImplementation(async command => {
      if (command === 'git_status') return baseRepository;
      throw new Error('文件正在被替换');
    });
    await useWorkbench.getState().refresh({ silent: true });
    expect(useWorkbench.getState().diff).toBe(diff);
    expect(useWorkbench.getState().autoRefreshError).toContain('当前显示上次结果');
    mockedInvoke.mockImplementation(async command => command === 'git_status' ? baseRepository : textDiff);
    await useWorkbench.getState().refresh({ silent: true });
    expect(useWorkbench.getState().autoRefreshError).toBeNull();
  });

  it('静默状态读取失败不清空列表或正文', async () => {
    await useWorkbench.getState().openRepository('/test/repository');
    const previous = useWorkbench.getState();
    mockedInvoke.mockRejectedValue('仓库不可访问');
    await useWorkbench.getState().refresh({ silent: true });
    expect(useWorkbench.getState().repositories).toBe(previous.repositories);
    expect(useWorkbench.getState().diff).toBe(previous.diff);
    expect(useWorkbench.getState().autoRefreshError).toContain('仓库不可访问');
    expect(useWorkbench.getState().autoRefreshing).toBe(false);
  });

  it('静默状态请求期间关闭文件，响应不会重新打开标签', async () => {
    await useWorkbench.getState().openRepository('/test/repository');
    const status = deferred<NativeRepository>();
    mockedInvoke.mockClear();
    mockedInvoke.mockImplementation(async command => command === 'git_status' ? status.promise : textDiff);
    const refresh = useWorkbench.getState().refresh({ silent: true });
    useWorkbench.getState().closeFile();
    status.resolve(baseRepository);
    await refresh;
    expect(useWorkbench.getState().selection).toBeNull();
    expect(useWorkbench.getState().diff.file).toBeNull();
    expect(mockedInvoke.mock.calls.filter(([command]) => command === 'git_diff')).toHaveLength(0);
  });

  it('静默正文请求期间切换文件，旧正文不能覆盖当前选择', async () => {
    await useWorkbench.getState().openRepository('/test/repository');
    const response = deferred<typeof textDiff>();
    mockedInvoke.mockClear();
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === 'git_status') return baseRepository;
      return (args as { path: string }).path === 'first.ts' ? response.promise : { ...textDiff, modified: 'second\n' };
    });
    const refresh = useWorkbench.getState().refresh({ silent: true });
    await vi.waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith('git_diff', { repoPath: '/test/repository', path: 'first.ts', area: 'unstaged' }));
    useWorkbench.getState().selectFile('second.ts', 'staged');
    await vi.waitFor(() => expect(useWorkbench.getState().diff.file?.index).toBe('second\n'));
    response.resolve({ ...textDiff, modified: '过期正文' });
    await refresh;
    expect(useWorkbench.getState().selection).toEqual({ fileId: 'second.ts', area: 'staged' });
    expect(useWorkbench.getState().diff.file?.index).toBe('second\n');
  });
});
