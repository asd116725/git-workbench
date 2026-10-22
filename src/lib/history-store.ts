import { create } from 'zustand';
import { historyFileSnapshot, historyGit } from './history-git';
import type { HistorySession } from './history-types';
import type { Worktree } from './types';

const emptyDiff: HistorySession['diff'] = { file: null, loading: false, notice: null, error: null };
/** 未打开历史页时使用稳定空值，避免订阅 selector 创建新对象。 */
export const emptyHistorySession: HistorySession = {
  initialized: false, reference: null, searchInput: '', query: '', snapshot: null, commits: [], nextCursor: null,
  selectedOid: null, parentIndex: 0, selectedPath: null, detail: null, diff: emptyDiff,
  loading: false, loadingMore: false, detailLoading: false, error: null, detailError: null,
  updated: false, checkError: null,
};

type RequestKind = 'list' | 'detail' | 'diff' | 'probe';
const requests = new Map<string, number>();
let sequence = 0;
function begin(worktree: Worktree, kind: RequestKind) {
  const key = `${worktree.id}:${kind}`;
  const id = ++sequence;
  requests.set(key, id);
  return () => requests.get(key) === id;
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }

interface HistoryState {
  sessions: Record<string, HistorySession>;
  ensure: (worktree: Worktree) => Promise<void>;
  setReference: (worktree: Worktree, reference: string | null) => Promise<void>;
  setSearchInput: (worktree: Worktree, value: string) => void;
  setQuery: (worktree: Worktree, query: string) => Promise<void>;
  selectCommit: (worktree: Worktree, oid: string) => Promise<void>;
  selectParent: (worktree: Worktree, parentIndex: number) => Promise<void>;
  selectFile: (worktree: Worktree, path: string) => Promise<void>;
  closeFile: (worktree: Worktree) => void;
  loadMore: (worktree: Worktree) => Promise<void>;
  refresh: (worktree: Worktree) => Promise<void>;
  checkForUpdates: (worktree: Worktree) => Promise<void>;
  reset: () => void;
}

/** 历史只读请求按工作区与层级独立作废，不修改暂存状态、草稿或全局 busy。 */
export const useHistory = create<HistoryState>((set, get) => {
  function session(worktree: Worktree) { return get().sessions[worktree.id] ?? emptyHistorySession; }
  function update(worktree: Worktree, patch: Partial<HistorySession>) {
    set(state => ({ sessions: { ...state.sessions, [worktree.id]: { ...session(worktree), ...patch } } }));
  }

  async function readDetail(worktree: Worktree, oid: string, parentIndex: number) {
    const current = begin(worktree, 'detail');
    begin(worktree, 'diff');
    const previous = session(worktree);
    const same = previous.detail?.commit.oid === oid && previous.detail.parentIndex === parentIndex;
    update(worktree, {
      selectedOid: oid, parentIndex, detailLoading: true, detailError: null,
      detail: same ? previous.detail : null, diff: same ? previous.diff : emptyDiff,
    });
    try {
      const detail = await historyGit.detail(worktree, oid, parentIndex);
      if (!current()) return;
      const selectedPath = detail.files.find(file => file.path === session(worktree).selectedPath)?.path ?? detail.files[0]?.path ?? null;
      update(worktree, { detail, parentIndex: detail.parentIndex, selectedPath, detailLoading: false });
      if (selectedPath) await get().selectFile(worktree, selectedPath);
      else update(worktree, { diff: emptyDiff });
    } catch (error) {
      if (current()) update(worktree, { detailLoading: false, detailError: errorMessage(error) });
    }
  }

  return {
    sessions: {},
    async ensure(worktree) {
      const current = session(worktree);
      if (!current.initialized && !current.loading) await get().refresh(worktree);
    },
    async setReference(worktree, reference) {
      if (session(worktree).reference === reference) return;
      update(worktree, { reference, nextCursor: null });
      await get().refresh(worktree);
    },
    setSearchInput(worktree, searchInput) {
      update(worktree, { searchInput });
    },
    async setQuery(worktree, query) {
      if (session(worktree).query === query) return;
      update(worktree, { query, nextCursor: null });
      await get().refresh(worktree);
    },
    async selectCommit(worktree, oid) {
      const current = session(worktree);
      if (current.selectedOid === oid && current.detail && !current.detailError) return;
      await readDetail(worktree, oid, current.selectedOid === oid ? current.parentIndex : 0);
    },
    async selectParent(worktree, parentIndex) {
      const current = session(worktree);
      if (!current.selectedOid || (current.parentIndex === parentIndex && !current.detailError)) return;
      await readDetail(worktree, current.selectedOid, parentIndex);
    },
    async selectFile(worktree, path) {
      const previous = session(worktree);
      const detail = previous.detail;
      const file = detail?.files.find(item => item.path === path);
      if (!detail || !file) return;
      /** 提交对象不可变，同一比较对象的正文可直接复用。 */
      if (previous.selectedPath === path && previous.diff.file?.path === path && !previous.diff.error) return;
      const current = begin(worktree, 'diff');
      const same = previous.selectedPath === path && previous.diff.file?.path === path;
      update(worktree, { selectedPath: path, diff: { ...(same ? previous.diff : emptyDiff), loading: true, error: null } });
      try {
        const content = await historyGit.diff(worktree, detail.commit.oid, detail.parentIndex, path);
        if (current()) update(worktree, { diff: { file: historyFileSnapshot(file, content), notice: content.notice, loading: false, error: null } });
      } catch (error) {
        if (current()) update(worktree, { diff: { ...session(worktree).diff, loading: false, error: errorMessage(error) } });
      }
    },
    closeFile(worktree) {
      begin(worktree, 'diff');
      update(worktree, { selectedPath: null, diff: emptyDiff });
    },
    async loadMore(worktree) {
      const previous = session(worktree);
      if (!previous.snapshot || !previous.nextCursor || previous.loading || previous.loadingMore) return;
      const current = begin(worktree, 'list');
      update(worktree, { loadingMore: true, error: null });
      try {
        const page = await historyGit.page(worktree, previous.snapshot, previous.query, previous.nextCursor);
        if (!current()) return;
        update(worktree, { commits: [...previous.commits, ...page.commits], nextCursor: page.nextCursor, loadingMore: false });
      } catch (error) {
        if (current()) update(worktree, { loadingMore: false, error: errorMessage(error) });
      }
    },
    async refresh(worktree) {
      const current = begin(worktree, 'list');
      begin(worktree, 'probe');
      const previous = session(worktree);
      update(worktree, { loading: true, loadingMore: false, error: null, checkError: null });
      try {
        const { oid: snapshot } = await historyGit.ref(worktree, previous.reference);
        if (!current()) return;
        const page = snapshot ? await historyGit.page(worktree, snapshot, previous.query, null) : { commits: [], nextCursor: null };
        if (!current()) return;
        update(worktree, { snapshot, commits: page.commits, nextCursor: page.nextCursor, loading: false, initialized: true, updated: false });
        const selectedOid = page.commits.find(commit => commit.oid === session(worktree).selectedOid)?.oid ?? page.commits[0]?.oid ?? null;
        if (selectedOid) await get().selectCommit(worktree, selectedOid);
        else {
          begin(worktree, 'detail');
          begin(worktree, 'diff');
          update(worktree, { selectedOid: null, selectedPath: null, parentIndex: 0, detail: null, detailLoading: false, detailError: null, diff: emptyDiff });
        }
      } catch (error) {
        if (current()) update(worktree, { loading: false, error: errorMessage(error) });
      }
    },
    async checkForUpdates(worktree) {
      const previous = session(worktree);
      if (!previous.initialized || previous.loading) return;
      const current = begin(worktree, 'probe');
      try {
        const { oid } = await historyGit.ref(worktree, previous.reference);
        if (current()) update(worktree, { updated: oid !== previous.snapshot, checkError: null });
      } catch (error) {
        if (current()) update(worktree, { checkError: errorMessage(error) });
      }
    },
    reset() {
      requests.clear();
      set({ sessions: {} });
    },
  };
});
