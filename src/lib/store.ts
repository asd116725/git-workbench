import { isTauri } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createDemoRepositories } from './demo-data';
import { commitWorktree, getChanges, stageFile, stageHunk, unstageFile } from './demo-git';
import { nativeGit, toRepository, toWorktree } from './native-git';
import type { NativeRepository } from './native-git';
import type { ChangeArea, FileSnapshot, GitBranch, GitCheckoutResult, Repository, Worktree } from './types';

/** 文件与比较区域共同标识一个差异视图。 */
export interface Selection { fileId: string; area: ChangeArea }
/** 每个工作区独立保存尚未提交的说明。 */
export interface CommitDraft { summary: string; description: string }
/** 正文和状态分开加载，切换文件时不会显示上一个文件的差异。 */
export interface DiffState { file: FileSnapshot | null; loading: boolean; notice: string | null; error: string | null }

/** 分支请求随当前工作目录切换而失效，错误只影响分支选择器。 */
export interface BranchState { items: GitBranch[]; loading: boolean; error: string | null }

const emptyBranches: BranchState = { items: [], loading: false, error: null };
const emptyDiff: DiffState = { file: null, loading: false, notice: null, error: null };
const emptyDraft: CommitDraft = { summary: '', description: '' };

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

interface WorkbenchState {
  repositories: Repository[];
  activeWorktreeId: string;
  selection: Selection | null;
  view: 'changes' | 'history';
  drafts: Record<string, CommitDraft>;
  busy: boolean;
  refreshing: boolean;
  error: string | null;
  diff: DiffState;
  branches: BranchState;
  loadBranches: () => Promise<void>;
  checkoutBranch: (fullName: string) => Promise<GitCheckoutResult>;
  openRepository: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
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
    drafts: worktree ? { [worktree.id]: { summary: 'fix(editor): 修复 Markdown 滚动同步', description: '统一预览与源码滚动位置' } } : {},
    busy: false,
    refreshing: false,
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

  function currentWorktree() {
    const state = get();
    const worktree = findWorktree(state.repositories, state.activeWorktreeId);
    if (!worktree) throw new Error('请先打开一个本地 Git 仓库。');
    return worktree;
  }

  async function loadDiff(worktree: Worktree, selection: Selection | null) {
    const version = ++diffVersion;
    const file = worktree.files.find(item => item.id === selection?.fileId);
    if (!file || !selection) { set({ diff: emptyDiff }); return; }
    if (worktree.source !== 'native') { set({ diff: { ...emptyDiff, file } }); return; }
    set({ diff: { ...emptyDiff, loading: true } });
    try {
      const result = await nativeGit.diff(worktree.path, file.path, selection.area);
      if (version !== diffVersion) return;
      const snapshot = selection.area === 'staged'
        ? { ...file, head: result.original, index: result.modified }
        : { ...file, index: result.original, working: result.modified };
      set({ diff: { file: snapshot, loading: false, notice: result.notice, error: null } });
    } catch (error) {
      if (version === diffVersion) set({ diff: { ...emptyDiff, error: errorMessage(error) } });
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
  function applyNativeRepository(result: NativeRepository, previousSelection: Selection | null) {
    const state = get();
    const repositoryId = `native-repository:${result.commonDir}`;
    const previous = state.repositories.find(repository => repository.id === repositoryId);
    const repository = toRepository(result, previous);
    const worktree = toWorktree(result);
    const selection = resolveSelection(worktree, previousSelection);
    set({
      repositories: previous
        ? state.repositories.map(item => item.id === repositoryId ? repository : item)
        : [...state.repositories, repository],
      activeWorktreeId: worktree.id,
      selection,
    });
    void loadDiff(worktree, selection);
  }

  async function loadBranches(worktree: Worktree) {
    const version = ++branchVersion;
    if (worktree.source !== 'native') { set({ branches: emptyBranches }); return; }
    set({ branches: { ...get().branches, loading: true, error: null } });
    try {
      const items = await nativeGit.branches(worktree.path);
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
  function beginMutation() {
    if (get().busy) throw new Error('Git 操作正在进行，请稍候。');
    ++statusVersion;
    ++diffVersion;
    ++branchVersion;
    set({ busy: true, refreshing: false, error: null, branches: { ...get().branches, loading: false } });
  }

  async function refreshAfterMutation(worktree: Worktree) {
    try {
      applyNativeRepository(await nativeGit.status(worktree.path), get().selection);
    } catch (error) {
      set({ error: `操作已完成，但刷新失败：${errorMessage(error)}`, diff: emptyDiff });
    }
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
    openRepository: async path => {
      if (!isTauri()) throw new Error('请在桌面应用中打开本地仓库。');
      beginMutation();
      try {
        const result = await nativeGit.open(path);
        applyNativeRepository(result, null);
        set({ view: 'changes', branches: emptyBranches });
      } catch (error) {
        const message = errorMessage(error);
        set({ error: message });
        const worktree = findWorktree(get().repositories, get().activeWorktreeId);
        if (worktree) void loadDiff(worktree, get().selection);
        throw Object.assign(new Error(message), { cause: error });
      } finally { set({ busy: false }); }
    },
    refresh: async () => {
      const worktree = findWorktree(get().repositories, get().activeWorktreeId);
      if (!worktree || get().busy) return;
      if (worktree.source !== 'native') { void loadDiff(worktree, get().selection); return; }
      const version = ++statusVersion;
      set({ refreshing: true, error: null });
      try {
        const result = await nativeGit.status(worktree.path);
        if (version === statusVersion && get().activeWorktreeId === worktree.id) applyNativeRepository(result, get().selection);
      } catch (error) {
        if (version === statusVersion) set({ error: errorMessage(error) });
      } finally {
        if (version === statusVersion) set({ refreshing: false });
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
      set({ activeWorktreeId: id, selection, view: 'changes', refreshing: false, error: null, diff: emptyDiff, branches: emptyBranches });
      if (worktree.source === 'native') void get().refresh();
      else void loadDiff(worktree, selection);
    },
    loadBranches: async () => {
      const worktree = findWorktree(get().repositories, get().activeWorktreeId);
      if (worktree) await loadBranches(worktree);
    },
    checkoutBranch: async fullName => {
      const worktree = currentWorktree();
      if (worktree.source !== 'native') throw new Error('请在真实仓库中切换分支。');
      beginMutation();
      try {
        const { branch, warning = null } = await nativeGit.checkout(worktree.path, fullName);
        /** 刷新失败时也不能继续展示已离开的分支内容。 */
        set(state => ({
          repositories: state.repositories.map(repository => ({
            ...repository,
            worktrees: repository.worktrees.map(item => item.id === worktree.id
              ? { ...item, branch, detached: false, hasHead: true, files: [] } : item),
          })),
          selection: null,
          diff: emptyDiff,
          branches: emptyBranches,
          view: 'changes',
        }));
        await refreshAfterMutation(worktree);
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
      const draft = get().drafts[worktree.id] ?? emptyDraft;
      if (!draft.summary.trim()) throw new Error('请输入提交标题。');
      if (getChanges(worktree, 'staged').length === 0) throw new Error('请先暂存需要提交的修改。');
      beginMutation();
      try {
        let commitId: string;
        if (worktree.source === 'native') {
          ({ commitId } = await nativeGit.commit(worktree.path, draft.summary, draft.description));
        } else {
          const committed = commitWorktree(worktree, draft.summary, draft.description);
          commitId = committed.commits[0].id;
          replaceWorktree(committed);
        }
        set(state => {
          const currentDraft = state.drafts[worktree.id];
          return currentDraft?.summary === draft.summary && currentDraft?.description === draft.description
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
      set(initialState());
    },
  };
});

interface Preferences {
  fontSize: number;
  fileView: 'tree' | 'list';
  diffMode: 'split' | 'inline';
  layout: Record<string, number>;
  layoutResetKey: number;
  setFontSize: (value: number) => void;
  setFileView: (value: 'tree' | 'list') => void;
  setDiffMode: (value: 'split' | 'inline') => void;
  setLayout: (value: Record<string, number>) => void;
  resetLayout: () => void;
}

/** 仅持久化界面偏好，重新启动仍可重现初始示例。 */
export const usePreferences = create<Preferences>()(persist(set => ({
  fontSize: 15,
  fileView: 'tree',
  diffMode: 'split',
  layout: {},
  layoutResetKey: 0,
  setFontSize: fontSize => set({ fontSize }),
  setFileView: fileView => set({ fileView }),
  setDiffMode: diffMode => set({ diffMode }),
  setLayout: layout => set(state => Object.entries(layout).every(([key, value]) => state.layout[key] === value) ? state : { layout: { ...state.layout, ...layout } }),
  resetLayout: () => set(state => ({ layout: {}, layoutResetKey: state.layoutResetKey + 1, fontSize: 15, diffMode: 'split' })),
}), { name: 'git-workbench.preferences' }));
