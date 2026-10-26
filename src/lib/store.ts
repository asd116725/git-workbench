import { isTauri } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createDemoRepositories } from './demo-data';
import { commitWorktree, getChanges, stageFile, stageHunk, unstageFile } from './demo-git';
import { createDemoBranch, createDemoBranchState, deleteDemoBranch, listDemoBranches, previewDemoBranchDeletion, recordDemoBranchCommit, switchDemoBranch, type DemoBranchState } from './demo-branches';
import { nativeGit, toRepository, toWorktree } from './native-git';
import { commitBlockReason } from './merge-view';
import type { NativeRepository } from './native-git';
import type { ChangeArea, FileSnapshot, GitBranch, GitCheckoutResult, GitCreateBranchResult, GitDeleteBranchPreview, GitDeleteBranchResult, GitMergePreview, GitMergeResult, GitOperation, Repository, Worktree } from './types';

/** 文件与比较区域共同标识一个差异视图。 */
export interface Selection { fileId: string; area: ChangeArea }
/** 每个工作区独立保存完整草稿，输入期间保留空行和首尾空白。 */
export interface CommitDraft { message: string }
/** 合并草稿绑定双方提交，避免新一轮合并误用上一轮编辑的信息。 */
export interface MergeDraft { key: string; message: string }
/** 正文和状态分开加载，切换文件时不会显示上一个文件的差异。 */
export interface DiffState { file: FileSnapshot | null; loading: boolean; notice: string | null; error: string | null }

/** 分支请求随当前工作目录切换而失效，错误只影响分支选择器。 */
export interface BranchState { items: GitBranch[]; loading: boolean; error: string | null }

const emptyBranches: BranchState = { items: [], loading: false, error: null };
const emptyDiff: DiffState = { file: null, loading: false, notice: null, error: null };
const emptyDraft: CommitDraft = { message: '' };

/** 只保存仓库入口与当前工作区，不缓存文件正文、Git 状态或提交草稿。 */
interface RepositorySession {
  repositories: Array<{ id: string; path: string }>;
  activeWorktreeId: string;
}

const repositorySession = create<RepositorySession>()(persist((): RepositorySession => ({
  repositories: [],
  activeWorktreeId: '',
}), { name: 'git-workbench.repositories', storage: createJSONStorage(() => localStorage) }));

/** 优先保留当前比较对象；变更消失后选择下一项，避免悬空的文件标签。 */
function resolveSelection(worktree: Worktree, previous: Selection | null = null): Selection | null {
  if (previous && getChanges(worktree, previous.area).some(file => file.id === previous.fileId)) return previous;
  for (const area of ['unstaged', 'staged'] as const) {
    const files = getChanges(worktree, area);
    const file = files.find(item => item.id === previous?.fileId) ?? files[0];
    if (file) return { fileId: file.id, area };
  }
  return null;
}

/** 未打开仓库时返回 undefined，由界面展示欢迎页。 */
export function findWorktree(repositories: Repository[], id: string): Worktree | undefined {
  return repositories.flatMap(repository => repository.worktrees).find(worktree => worktree.id === id);
}

function mergeKey(operation: GitOperation): string {
  return JSON.stringify([operation.head, ...operation.mergeHeads]);
}

/** 同一轮合并优先使用手写草稿，首次读取或新一轮操作使用 Git 默认信息。 */
export function getMergeMessage(worktree: Worktree, drafts: Record<string, MergeDraft>): string {
  const operation = worktree.operation;
  if (operation?.kind !== 'merge') return '';
  const draft = drafts[worktree.id];
  return draft?.key === mergeKey(operation) ? draft.message : operation.message;
}

/** 只在操作身份变化时替换草稿；磁盘确认合并已结束时清除对应草稿。 */
function initializeMergeDraft(worktree: Worktree, drafts: Record<string, MergeDraft>): Record<string, MergeDraft> {
  const operation = worktree.operation;
  if (operation?.kind !== 'merge') {
    if (operation === undefined || !drafts[worktree.id]) return drafts;
    const next = { ...drafts };
    delete next[worktree.id];
    return next;
  }
  const key = mergeKey(operation);
  if (drafts[worktree.id]?.key === key) return drafts;
  return { ...drafts, [worktree.id]: { key, message: operation.message } };
}

interface WorkbenchState {
  repositories: Repository[];
  activeWorktreeId: string;
  selection: Selection | null;
  view: 'changes' | 'history';
  drafts: Record<string, CommitDraft>;
  mergeDrafts: Record<string, MergeDraft>;
  busy: boolean;
  restoring: boolean;
  refreshing: boolean;
  /** 静默读取不锁定界面；调度器仍需等待本次读取完成。 */
  autoRefreshing: boolean;
  autoRefreshError: string | null;
  error: string | null;
  diff: DiffState;
  branches: BranchState;
  loadBranches: () => Promise<void>;
  checkoutBranch: (fullName: string) => Promise<GitCheckoutResult>;
  createBranch: (name: string, startRef: string, checkout: boolean) => Promise<GitCreateBranchResult>;
  previewDeleteBranch: (fullName: string) => Promise<GitDeleteBranchPreview>;
  deleteBranch: (preview: GitDeleteBranchPreview, force: boolean) => Promise<GitDeleteBranchResult>;
  previewMerge: (sourceRef: string) => Promise<GitMergePreview>;
  mergeBranch: (preview: GitMergePreview, noFf: boolean) => Promise<GitMergeResult>;
  continueMerge: () => Promise<GitMergeResult>;
  abortMerge: () => Promise<GitMergeResult>;
  setMergeMessage: (message: string) => void;
  openRepository: (path: string) => Promise<void>;
  /** 启动时恢复本地路径，同一进程内的重复调用共用一次恢复。 */
  restoreSession: () => Promise<void>;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  setAutoRefreshError: (message: string | null) => void;
  selectWorktree: (id: string) => void;
  selectFile: (fileId: string, area: ChangeArea) => void;
  closeFile: () => void;
  setView: (view: 'changes' | 'history') => void;
  setDraft: (draft: CommitDraft) => void;
  /** 接收单个文件或目录下的一组文件，沿用精确文件路径操作。 */
  stage: (fileIds: string | string[]) => Promise<void>;
  unstage: (fileIds: string | string[]) => Promise<void>;
  stageChunk: (fileId: string, index: number) => void;
  commit: () => Promise<string>;
  reset: () => void;
}

function initialState() {
  const repositories = isTauri() ? [] : createDemoRepositories();
  const worktree = repositories[0]?.worktrees[0];
  const selection = worktree ? resolveSelection(worktree) : null;
  return {
    repositories,
    activeWorktreeId: worktree?.id ?? '',
    selection,
    view: 'changes' as const,
    drafts: worktree ? { [worktree.id]: { message: 'fix(editor): 修复 Markdown 滚动同步\n\n统一预览与源码滚动位置' } } : {},
    mergeDrafts: {} as Record<string, MergeDraft>,
    busy: false,
    restoring: false,
    refreshing: false,
    autoRefreshing: false,
    autoRefreshError: null,
    error: null,
    branches: emptyBranches,
    diff: { ...emptyDiff, file: worktree?.files.find(file => file.id === selection?.fileId) ?? null },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : 'Git 操作失败，请重试。';
}

/** 原生模式操作真实仓库；浏览器预览保持独立的示例快照。 */
export const useWorkbench = create<WorkbenchState>((set, get) => {
  /** 每次切换或刷新都淘汰先前响应，避免快速点选显示错位的正文。 */
  let diffVersion = 0;
  let statusVersion = 0;
  let branchVersion = 0;
  let autoRefreshVersion = 0;
  let restorePromise: Promise<void> | undefined;
  const mergePreviewWorktrees = new WeakMap<GitMergePreview, string>();
  const deletePreviewWorktrees = new WeakMap<GitDeleteBranchPreview, string>();
  const demoBranchStates = new Map<string, DemoBranchState>();

  /** 演示分支按共享仓库保存于内存，切换工作区仍能看到刚创建的分支。 */
  function demoBranches(worktree: Worktree) {
    const repository = get().repositories.find(item => item.worktrees.some(item => item.id === worktree.id))!;
    let state = demoBranchStates.get(repository.id);
    if (!state) {
      state = createDemoBranchState(repository);
      demoBranchStates.set(repository.id, state);
    }
    return { id: repository.id, state };
  }

  /** 以主工作区作为稳定入口；不可用路径保留在记录中，避免一次恢复失败就丢失。 */
  function rememberSession() {
    const state = get();
    const worktree = findWorktree(state.repositories, state.activeWorktreeId);
    if (worktree?.source !== 'native') return;
    const repository = state.repositories.find(item => item.worktrees.some(item => item.id === worktree.id))!;
    const path = repository.worktrees.find(item => item.isMain && !item.bare && item.available !== false)?.path ?? worktree.path;
    const session = repositorySession.getState();
    const previous = session.repositories.find(item => item.id === repository.id);
    if (previous?.path === path && session.activeWorktreeId === worktree.id) return;
    const entry = { id: repository.id, path };
    try {
      repositorySession.setState({
        repositories: previous ? session.repositories.map(item => item.id === entry.id ? entry : item) : [...session.repositories, entry],
        activeWorktreeId: worktree.id,
      });
    } catch (error) {
      set({ error: `仓库已打开，但无法保存到本地：${errorMessage(error)}` });
    }
  }

  function currentWorktree() {
    const state = get();
    const worktree = findWorktree(state.repositories, state.activeWorktreeId);
    if (!worktree) throw new Error('请先打开一个本地 Git 仓库。');
    return worktree;
  }

  async function loadDiff(worktree: Worktree, selection: Selection | null, preserve = false) {
    const version = ++diffVersion;
    const file = worktree.files.find(item => item.id === selection?.fileId);
    if (!file || !selection) { set({ diff: emptyDiff }); return; }
    if (worktree.source !== 'native') { set({ diff: { ...emptyDiff, file } }); return; }
    const previous = get().diff;
    const keepVisible = preserve && previous.file?.id === file.id;
    if (!keepVisible) set({ diff: { ...emptyDiff, loading: true } });
    try {
      const result = await nativeGit.diff(worktree.path, file.path, selection.area);
      if (version !== diffVersion) return;
      const snapshot = selection.area === 'staged'
        ? { ...file, head: result.original, index: result.modified }
        : { ...file, index: result.original, working: result.modified };
      const before = previous.file;
      const unchanged = keepVisible && before && !previous.error && previous.notice === result.notice
        && before.head === snapshot.head && before.index === snapshot.index && before.working === snapshot.working
        && before.git?.statusIndex === snapshot.git?.statusIndex && before.git?.statusWorktree === snapshot.git?.statusWorktree
        && before.git?.originalPath === snapshot.git?.originalPath && before.git?.conflicted === snapshot.git?.conflicted;
      if (!unchanged) set({ diff: { file: snapshot, loading: false, notice: result.notice, error: null } });
    } catch (error) {
      if (version !== diffVersion) return;
      if (keepVisible) set({ autoRefreshError: `文件差异更新失败，当前显示上次结果：${errorMessage(error)}` });
      else set({ diff: { ...emptyDiff, error: errorMessage(error) } });
    }
  }

  function replaceWorktree(worktree: Worktree) {
    const state = get();
    const selection = resolveSelection(worktree, state.selection);
    set({
      repositories: state.repositories.map(repository => ({
        ...repository,
        worktrees: repository.worktrees.map(item => item.id === worktree.id ? worktree : item),
      })),
      selection,
    });
    void loadDiff(worktree, selection);
  }

  /** Git 公共目录决定仓库身份，打开兄弟目录时仍复用同一分组和草稿。 */
  function applyNativeRepository(result: NativeRepository, previousSelection: Selection | null, silent = false) {
    const state = get();
    const repositoryId = `native-repository:${result.commonDir}`;
    const previous = state.repositories.find(repository => repository.id === repositoryId);
    const repository = toRepository(result, previous);
    const worktree = toWorktree(result);
    /** 静默刷新尊重用户关闭标签的操作，不自动重新打开首个文件。 */
    const selection = silent && !previousSelection ? null : resolveSelection(worktree, previousSelection);
    const preserveDiff = silent && state.activeWorktreeId === worktree.id
      && previousSelection?.fileId === selection?.fileId && previousSelection?.area === selection?.area;
    set({
      repositories: previous
        ? state.repositories.map(item => item.id === repositoryId ? repository : item)
        : [...state.repositories, repository],
      activeWorktreeId: worktree.id,
      selection,
      mergeDrafts: initializeMergeDraft(worktree, state.mergeDrafts),
    });
    rememberSession();
    return loadDiff(worktree, selection, preserveDiff);
  }

  async function loadBranches(worktree: Worktree) {
    const version = ++branchVersion;
    set({ branches: { ...get().branches, loading: true, error: null } });
    try {
      const items = worktree.source === 'native'
        ? await nativeGit.branches(worktree.path)
        : listDemoBranches(demoBranches(worktree).state, worktree);
      if (version === branchVersion && get().activeWorktreeId === worktree.id) {
        set({ branches: { items, loading: false, error: null } });
      }
    } catch (error) {
      if (version === branchVersion && get().activeWorktreeId === worktree.id) {
        set({ branches: { items: [], loading: false, error: errorMessage(error) } });
      }
    }
  }

  /** 写操作期间锁定工作区；原生 Git 锁之外再防止界面重复提交。 */
  function beginMutation({ preserveDiff = false } = {}) {
    if (get().busy) throw new Error('Git 操作正在进行，请稍候。');
    ++statusVersion;
    if (!preserveDiff) ++diffVersion;
    ++branchVersion;
    set({ busy: true, refreshing: false, error: null, branches: { ...get().branches, loading: false } });
  }

  /** 各仓库独立恢复，选中的 linked worktree 按需读取状态，只加载当前文件的 Diff。 */
  async function restoreNativeSession() {
    const session = repositorySession.getState();
    if (!session.repositories.length) return;
    beginMutation();
    set({ restoring: true });
    try {
      const results = await Promise.allSettled(session.repositories.map(item => nativeGit.open(item.path)));
      let repositories: Repository[] = [];
      const loaded: Worktree[] = [];
      const errors: string[] = [];
      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') {
          errors.push(`${session.repositories[index].path}：${errorMessage(result.reason)}`);
          continue;
        }
        const repository = toRepository(result.value, repositories.find(item => item.id === `native-repository:${result.value.commonDir}`));
        repositories = [...repositories.filter(item => item.id !== repository.id), repository];
        loaded.push(toWorktree(result.value));
      }
      let worktree = findWorktree(repositories, session.activeWorktreeId);
      if (!worktree || worktree.available === false || worktree.bare) worktree = loaded[0];
      const targetId = worktree?.id;
      if (worktree && !loaded.some(item => item.id === targetId)) {
        try {
          const result = await nativeGit.status(worktree.path);
          repositories = repositories.map(item => item.id === `native-repository:${result.commonDir}` ? toRepository(result, item) : item);
          worktree = toWorktree(result);
        } catch (error) {
          errors.push(`${worktree.path}：${errorMessage(error)}`);
          worktree = loaded[0];
        }
      }
      const selection = worktree ? resolveSelection(worktree) : null;
      const mergeDrafts = repositories.flatMap(repository => repository.worktrees).reduce((drafts, item) => initializeMergeDraft(item, drafts), get().mergeDrafts);
      set({ repositories, activeWorktreeId: worktree?.id ?? '', selection, mergeDrafts, error: errors.length ? `部分仓库恢复失败：\n${errors.join('\n')}` : null });
      if (worktree) void loadDiff(worktree, selection);
    } finally { set({ busy: false, restoring: false }); }
  }

  async function refreshAfterMutation(worktree: Worktree, failurePrefix = '操作已完成，但刷新失败') {
    try {
      void applyNativeRepository(await nativeGit.status(worktree.path), get().selection);
    } catch (error) {
      set({ error: `${failurePrefix}：${errorMessage(error)}`, diff: emptyDiff });
    }
  }

  /** 切换已成功时先更新身份；刷新失败也不能继续展示原分支文件。 */
  async function applyBranchSwitch(worktree: Worktree, branch: string) {
    ++diffVersion;
    const real = worktree.source === 'native';
    const updated = { ...worktree, branch, detached: false, hasHead: true, files: real ? [] : worktree.files };
    set(state => ({
      repositories: state.repositories.map(repository => ({
        ...repository,
        worktrees: repository.worktrees.map(item => item.id === worktree.id ? updated : item),
      })),
      selection: real ? null : state.selection,
      diff: real ? emptyDiff : state.diff,
      branches: emptyBranches,
      view: 'changes',
    }));
    if (real) await refreshAfterMutation(worktree);
  }

  /** 仅修改引用时保留阅读状态；已完成的写入不因随后刷新失败而变成操作失败。 */
  async function runBranchMutation<T extends GitDeleteBranchResult & { switched?: boolean }>(worktree: Worktree, action: () => Promise<T>): Promise<T> {
    if (worktree.operation) throw new Error('请先完成或中止当前 Git 操作，再管理分支。');
    beginMutation({ preserveDiff: true });
    try {
      const result = await action();
      if (result.switched) await applyBranchSwitch(worktree, result.branch);
      await loadBranches(currentWorktree());
      const warning = [result.warning, get().error, get().branches.error && `操作已完成，但分支列表刷新失败：${get().branches.error}`].filter(Boolean).join('\n') || null;
      return { ...result, warning };
    } catch (error) {
      throw Object.assign(new Error(errorMessage(error)), { cause: error });
    } finally { set({ busy: false }); }
  }

  /** 合并失败也重读磁盘，Git 可能已经写入冲突索引或留下待完成的合并。 */
  async function runMergeMutation(worktree: Worktree, action: () => Promise<GitMergeResult>) {
    beginMutation();
    try {
      const result = await action();
      const completed = result.outcome !== 'conflicts' && result.outcome !== 'pending';
      if (completed) {
        set(state => {
          const mergeDrafts = { ...state.mergeDrafts };
          delete mergeDrafts[worktree.id];
          return {
            mergeDrafts,
            repositories: state.repositories.map(repository => ({
              ...repository,
              worktrees: repository.worktrees.map(item => item.id === worktree.id ? { ...item, operation: null } : item),
            })),
          };
        });
      }
      await refreshAfterMutation(worktree, completed ? undefined : '合并尚未完成，且无法刷新仓库状态');
      await loadBranches(currentWorktree());
      if (result.warning) set(state => ({ error: [result.warning, state.error].filter(Boolean).join('\n') }));
      return result;
    } catch (error) {
      const message = errorMessage(error);
      await refreshAfterMutation(worktree, '操作失败，且无法刷新仓库状态');
      set(state => ({ error: [message, state.error].filter(Boolean).join('\n') }));
      throw Object.assign(new Error(message), { cause: error });
    } finally { set({ busy: false }); }
  }

  function nativeWorktree() {
    const worktree = currentWorktree();
    if (worktree.source !== 'native') throw new Error('请在真实仓库中合并分支。');
    return worktree;
  }

  function unfinishedMerge(worktree: Worktree) {
    if (worktree.operation?.kind !== 'merge') throw new Error('当前没有待完成的合并，请刷新后重试。');
    return worktree.operation;
  }

  /** 整组选中文件一次交给后端处理，避免逐文件通信和重复扫描仓库。 */
  async function changeStage(fileIds: string | string[], stage: boolean) {
    const worktree = currentWorktree();
    const files = (Array.isArray(fileIds) ? fileIds : [fileIds]).map(id => {
      const file = worktree.files.find(item => item.id === id);
      if (!file) throw new Error('该文件状态已变化，请刷新后重试。');
      return file;
    });
    beginMutation();
    try {
      if (worktree.source === 'native') {
        await (stage ? nativeGit.stage : nativeGit.unstage)(worktree.path, files.map(file => file.path));
        await refreshAfterMutation(worktree);
      } else {
        replaceWorktree(files.reduce((current, file) => (stage ? stageFile : unstageFile)(current, file.id), worktree));
      }
    } catch (error) {
      const message = errorMessage(error);
      if (worktree.source === 'native') await refreshAfterMutation(worktree);
      set({ error: message });
      throw Object.assign(new Error(message), { cause: error });
    } finally { set({ busy: false }); }
  }

  return {
    ...initialState(),
    restoreSession: () => {
      if (restorePromise) return restorePromise;
      if (!isTauri() || get().repositories.length || get().busy) return Promise.resolve();
      return restorePromise = restoreNativeSession();
    },
    openRepository: async path => {
      if (!isTauri()) throw new Error('请在桌面应用中打开本地仓库。');
      beginMutation();
      try {
        const result = await nativeGit.open(path);
        void applyNativeRepository(result, null);
        set({ view: 'changes', branches: emptyBranches });
      } catch (error) {
        const message = errorMessage(error);
        set({ error: message });
        const worktree = findWorktree(get().repositories, get().activeWorktreeId);
        if (worktree) void loadDiff(worktree, get().selection);
        throw Object.assign(new Error(message), { cause: error });
      } finally { set({ busy: false }); }
    },
    setAutoRefreshError: autoRefreshError => set({ autoRefreshError }),
    refresh: async ({ silent = false } = {}) => {
      const worktree = findWorktree(get().repositories, get().activeWorktreeId);
      if (!worktree || get().busy) return;
      if (silent && (get().refreshing || get().autoRefreshing)) return;
      if (worktree.source !== 'native') { void loadDiff(worktree, get().selection); return; }
      const version = ++statusVersion;
      const autoVersion = silent ? ++autoRefreshVersion : autoRefreshVersion;
      set(silent ? { autoRefreshing: true, autoRefreshError: null } : { refreshing: true, error: null, autoRefreshError: null });
      try {
        const result = await nativeGit.status(worktree.path);
        if (version === statusVersion && get().activeWorktreeId === worktree.id) {
          await applyNativeRepository(result, get().selection, silent);
        }
      } catch (error) {
        if (version === statusVersion) set(silent
          ? { autoRefreshError: `自动刷新失败，可点击「刷新」重试：${errorMessage(error)}` }
          : { error: errorMessage(error) });
      } finally {
        if (silent && autoVersion === autoRefreshVersion) set({ autoRefreshing: false });
        if (!silent && version === statusVersion) set({ refreshing: false });
      }
    },
    selectWorktree: id => {
      if (get().busy) return;
      const worktree = findWorktree(get().repositories, id);
      if (!worktree) return;
      if (worktree.bare || worktree.available === false) {
        set({ error: worktree.bare ? '裸仓库没有可查看的工作目录。' : '工作目录不可用，请检查路径后刷新仓库。' });
        return;
      }
      ++statusVersion;
      ++diffVersion;
      ++branchVersion;
      const selection = worktree.source === 'native' ? null : resolveSelection(worktree);
      set({ activeWorktreeId: id, selection, refreshing: false, error: null, autoRefreshError: null, diff: emptyDiff, branches: emptyBranches });
      rememberSession();
      if (worktree.source === 'native') void get().refresh();
      else void loadDiff(worktree, selection);
    },
    loadBranches: async () => {
      const worktree = findWorktree(get().repositories, get().activeWorktreeId);
      if (worktree) await loadBranches(worktree);
    },
    checkoutBranch: async fullName => {
      const worktree = currentWorktree();
      if (worktree.source !== 'native') {
        const result = await runBranchMutation(worktree, async () => {
          const demo = demoBranches(worktree);
          const next = switchDemoBranch(demo.state, worktree, fullName);
          demoBranchStates.set(demo.id, next.state);
          return { ...next.result, switched: true };
        });
        return { branch: result.branch, warning: result.warning };
      }
      if (worktree.operation) throw new Error('请先完成或中止当前 Git 操作，再切换分支。');
      beginMutation();
      try {
        const { branch, warning = null } = await nativeGit.checkout(worktree.path, fullName);
        await applyBranchSwitch(worktree, branch);
        await loadBranches(currentWorktree());
        if (warning) {
          set(state => ({ error: [`已切换到 ${branch}，但 ${warning}`, state.error].filter(Boolean).join('\n') }));
        }
        return { branch, warning };
      } catch (error) {
        const message = errorMessage(error);
        set({ error: message });
        void loadDiff(worktree, get().selection);
        throw Object.assign(new Error(message), { cause: error });
      } finally { set({ busy: false }); }
    },
    createBranch: async (name, startRef, checkout) => {
      const worktree = currentWorktree();
      return runBranchMutation(worktree, async () => {
        if (worktree.source === 'native') return nativeGit.createBranch(worktree.path, name, startRef, checkout);
        const demo = demoBranches(worktree);
        const next = createDemoBranch(demo.state, worktree, name, startRef, checkout);
        demoBranchStates.set(demo.id, next.state);
        return next.result;
      });
    },
    previewDeleteBranch: async fullName => {
      const worktree = currentWorktree();
      if (get().busy) throw new Error('Git 操作正在进行，请稍候。');
      if (worktree.operation) throw new Error('请先完成或中止当前 Git 操作，再管理分支。');
      const version = statusVersion;
      const preview = worktree.source === 'native'
        ? await nativeGit.previewDeleteBranch(worktree.path, fullName)
        : previewDemoBranchDeletion(demoBranches(worktree).state, worktree, fullName);
      if (get().activeWorktreeId !== worktree.id || version !== statusVersion) throw new Error('工作区状态已变化，请重新选择分支。');
      deletePreviewWorktrees.set(preview, worktree.id);
      return preview;
    },
    deleteBranch: async (preview, force) => {
      const worktree = currentWorktree();
      if (deletePreviewWorktrees.get(preview) !== worktree.id) throw new Error('工作区状态已变化，请重新预览并确认删除。');
      return runBranchMutation(worktree, async () => {
        /** 每次执行都消费确认，失败后必须重新读取目标，不能重复使用强制删除授权。 */
        deletePreviewWorktrees.delete(preview);
        if (worktree.source === 'native') return nativeGit.deleteBranch(worktree.path, preview, force);
        const demo = demoBranches(worktree);
        const next = deleteDemoBranch(demo.state, worktree, preview, force);
        demoBranchStates.set(demo.id, next.state);
        return next.result;
      });
    },
    previewMerge: async sourceRef => {
      const worktree = nativeWorktree();
      if (get().busy) throw new Error('Git 操作正在进行，请稍候。');
      if (worktree.operation) throw new Error('请先完成或中止当前 Git 操作，再合并分支。');
      const version = statusVersion;
      const preview = await nativeGit.mergePreview(worktree.path, sourceRef);
      if (get().activeWorktreeId !== worktree.id || version !== statusVersion) throw new Error('工作区状态已变化，请重新选择分支。');
      mergePreviewWorktrees.set(preview, worktree.id);
      return preview;
    },
    mergeBranch: async (preview, noFf) => {
      const worktree = nativeWorktree();
      if (worktree.operation) throw new Error('请先完成或中止当前 Git 操作，再合并分支。');
      if (mergePreviewWorktrees.get(preview) !== worktree.id) throw new Error('工作区状态已变化，请重新选择分支。');
      return runMergeMutation(worktree, () => nativeGit.merge(worktree.path, preview, noFf));
    },
    continueMerge: async () => {
      const worktree = nativeWorktree();
      const operation = unfinishedMerge(worktree);
      const message = getMergeMessage(worktree, get().mergeDrafts).trim();
      const blocked = commitBlockReason(worktree, message);
      if (blocked) throw new Error(blocked);
      return runMergeMutation(worktree, () => nativeGit.continueMerge(worktree.path, operation.head, operation.mergeHeads, message));
    },
    abortMerge: async () => {
      const worktree = nativeWorktree();
      const operation = unfinishedMerge(worktree);
      return runMergeMutation(worktree, () => nativeGit.abortMerge(worktree.path, operation.head, operation.mergeHeads));
    },
    setMergeMessage: message => {
      const worktree = currentWorktree();
      const operation = unfinishedMerge(worktree);
      set(state => ({ mergeDrafts: { ...state.mergeDrafts, [worktree.id]: { key: mergeKey(operation), message } } }));
    },
    selectFile: (fileId, area) => {
      if (get().busy) return;
      const worktree = currentWorktree();
      const selection = { fileId, area };
      set({ selection, view: 'changes' });
      void loadDiff(worktree, selection);
    },
    closeFile: () => { ++diffVersion; set({ selection: null, diff: emptyDiff }); },
    setView: view => set({ view }),
    setDraft: draft => set(state => ({ drafts: { ...state.drafts, [state.activeWorktreeId]: draft } })),
    stage: fileId => changeStage(fileId, true),
    unstage: fileId => changeStage(fileId, false),
    stageChunk: (fileId, index) => {
      const worktree = currentWorktree();
      if (worktree.source === 'native') throw new Error('真实仓库目前支持整文件暂存。');
      if (get().busy) return;
      replaceWorktree(stageHunk(worktree, fileId, index));
    },
    commit: async () => {
      const worktree = currentWorktree();
      if (worktree.operation) throw new Error('请先完成或中止当前 Git 操作，合并请使用「完成合并」。');
      const draft = get().drafts[worktree.id] ?? emptyDraft;
      /** 仅在提交时去除首尾空白，再按首行标题与其余正文交给 Git。 */
      const [summary, ...lines] = draft.message.trim().split('\n');
      const description = lines.join('\n').trim();
      if (!summary) throw new Error('请输入提交标题。');
      if (getChanges(worktree, 'staged').length === 0) throw new Error('请先暂存需要提交的修改。');
      beginMutation();
      try {
        let commitId: string;
        if (worktree.source === 'native') {
          ({ commitId } = await nativeGit.commit(worktree.path, summary, description));
        } else {
          const committed = commitWorktree(worktree, summary, description);
          commitId = committed.commits[0].id;
          const demo = demoBranches(worktree);
          demoBranchStates.set(demo.id, recordDemoBranchCommit(demo.state, committed));
          replaceWorktree(committed);
        }
        set(state => {
          const currentDraft = state.drafts[worktree.id];
          return currentDraft?.message === draft.message
            ? { drafts: { ...state.drafts, [worktree.id]: emptyDraft } } : {};
        });
        if (worktree.source === 'native') await refreshAfterMutation(worktree);
        return commitId;
      } catch (error) {
        const message = errorMessage(error);
        set({ error: message });
        void loadDiff(worktree, get().selection);
        throw Object.assign(new Error(message), { cause: error });
      } finally { set({ busy: false }); }
    },
    reset: () => {
      if (get().busy) return;
      ++statusVersion;
      ++diffVersion;
      ++branchVersion;
      ++autoRefreshVersion;
      restorePromise = undefined;
      demoBranchStates.clear();
      set(initialState());
    },
  };
});

interface Preferences {
  fontSize: number;
  fileView: 'tree' | 'list';
  diffMode: 'split' | 'inline';
  historyDiffMode: 'split' | 'inline';
  layout: Record<string, number>;
  layoutResetKey: number;
  setFontSize: (value: number) => void;
  setFileView: (value: 'tree' | 'list') => void;
  setDiffMode: (value: 'split' | 'inline') => void;
  setHistoryDiffMode: (value: 'split' | 'inline') => void;
  setLayout: (value: Record<string, number>) => void;
  resetLayout: () => void;
}

/** 界面偏好与真实仓库会话分别保存，浏览器演示始终从初始示例开始。 */
export const usePreferences = create<Preferences>()(persist(set => ({
  fontSize: 15,
  fileView: 'tree',
  diffMode: 'split',
  historyDiffMode: 'inline',
  layout: {},
  layoutResetKey: 0,
  setFontSize: fontSize => set({ fontSize }),
  setFileView: fileView => set({ fileView }),
  setDiffMode: diffMode => set({ diffMode }),
  setHistoryDiffMode: historyDiffMode => set({ historyDiffMode }),
  setLayout: layout => set(state => Object.entries(layout).every(([key, value]) => state.layout[key] === value) ? state : { layout: { ...state.layout, ...layout } }),
  resetLayout: () => set(state => ({ layout: {}, layoutResetKey: state.layoutResetKey + 1, fontSize: 15, diffMode: 'split', historyDiffMode: 'inline' })),
}), { name: 'git-workbench.preferences' }));
