import { createStore } from 'zustand/vanilla';
import { getChanges } from './demo-git';
import { aiCommitErrorCode, nativeAiCommit, type AiCommitErrorCode, type AiCommitResult } from './native-ai-commit';
import { findWorktree, useWorkbench } from './store';
import type { Worktree } from './types';

/** 普通本地提交可生成中文文案；首次提交无需已有 HEAD。 */
export function aiCommitBlockReason(worktree: Worktree): string | null {
  if (worktree.source !== 'native' || worktree.bare || worktree.available === false) return '请打开可用的本地工作区后使用 AI 生成。';
  if (worktree.operation || worktree.files.some(file => file.git?.conflicted)) return '请先完成当前 Git 操作或解决冲突，再使用 AI 生成。';
  if (!getChanges(worktree, 'staged').length) return '请先暂存需要提交的文件。';
  return null;
}

/** 临时预览不持久化，只有 apply 通过身份、快照和原草稿校验后才能回填。 */
export interface AiCommitState {
  phase: 'closed' | 'checking' | 'ready' | 'generating' | 'preview' | 'error' | 'stale';
  result: AiCommitResult | null;
  candidate: string;
  error: AiCommitErrorCode | null;
  validating: boolean;
  draftChanged: boolean;
  open(): Promise<void>;
  checkKey(): Promise<void>;
  generate(): Promise<void>;
  close(): void;
  edit(message: string): void;
  apply(): Promise<boolean>;
  /** 订阅现有状态刷新事件，关闭组件时取消请求并解除订阅。 */
  connect(): () => void;
}

/** 每个提交面板独占一个会话；异步回调始终绑定创建时的工作区和分支。 */
export function createAiCommitSession(owner: Worktree) {
  let generation = 0;
  let requestId: string | null = null;
  let baseDraft = '';
  let revision = 0;
  let validation: Promise<boolean> | null = null;

  function context() {
    const state = useWorkbench.getState();
    const worktree = findWorktree(state.repositories, state.activeWorktreeId);
    if (!worktree || worktree.id !== owner.id || worktree.path !== owner.path || worktree.branch !== owner.branch || Boolean(worktree.detached) !== Boolean(owner.detached)) return null;
    return { worktree, message: state.drafts[owner.id]?.message ?? '', busy: state.busy || state.refreshing };
  }

  function cancelRequest() {
    if (requestId) void nativeAiCommit.cancel(requestId).catch(() => {});
    requestId = null;
  }

  const store = createStore<AiCommitState>((set, get) => {
    function current(version: number) { return generation === version && get().phase !== 'closed' && context() !== null; }

    function fail(error: unknown) {
      const code = aiCommitErrorCode(error);
      set({ phase: code === 'stale_snapshot' ? 'stale' : 'error', error: code, validating: false });
    }

    /** 同一轮校验合并刷新事件；校验中若再次刷新，重读快照后才允许应用。 */
    function validate(): Promise<boolean> {
      if (validation) return validation;
      const result = get().result;
      if (!result || get().phase !== 'preview') return Promise.resolve(false);
      const version = generation;
      set({ validating: true });
      const pending = (async () => {
        try {
          let checkedRevision: number;
          do {
            checkedRevision = revision;
            const valid = await nativeAiCommit.validate(owner.path, result.snapshotId);
            if (!current(version)) return false;
            if (!valid) { fail({ code: 'stale_snapshot' }); return false; }
          } while (checkedRevision !== revision);
          return get().phase === 'preview';
        } catch (error) {
          if (current(version)) fail(error);
          return false;
        } finally {
          if (current(version)) set({ validating: false });
          if (generation === version) validation = null;
        }
      })();
      validation = pending;
      return pending;
    }

    async function checkKey(autoGenerate: boolean) {
      const target = context();
      if (!target || target.busy || aiCommitBlockReason(target.worktree)) return;
      const version = ++generation;
      cancelRequest();
      validation = null;
      set({ phase: 'checking', result: null, candidate: '', error: null, validating: false, draftChanged: false });
      try {
        const { available } = await nativeAiCommit.checkKey();
        if (!current(version)) return;
        if (!available) { fail({ code: 'missing_key' }); return; }
        set({ phase: 'ready' });
        if (autoGenerate) await get().generate();
      } catch (error) { if (current(version)) fail(error); }
    }

    function confirmDraft(message: string) {
      if (message === baseDraft) return true;
      baseDraft = message;
      set({ draftChanged: true });
      return false;
    }

    return {
      phase: 'closed', result: null, candidate: '', error: null, validating: false, draftChanged: false,
      open: () => checkKey(true),
      checkKey: () => checkKey(false),
      generate: async () => {
        const target = context();
        if (!target || target.busy || aiCommitBlockReason(target.worktree)) return;
        const version = ++generation;
        cancelRequest();
        validation = null;
        baseDraft = target.message;
        const id = crypto.randomUUID();
        requestId = id;
        set({ phase: 'generating', result: null, candidate: '', error: null, validating: false, draftChanged: false });
        try {
          const result = await nativeAiCommit.generate(owner.path, id);
          if (!current(version)) return;
          if (!result.message.trim()) { fail({ code: 'invalid_response' }); return; }
          set({ phase: 'preview', result, candidate: result.message });
          await validate();
        } catch (error) { if (current(version)) fail(error); }
        finally { if (requestId === id) requestId = null; }
      },
      close: () => {
        ++generation;
        cancelRequest();
        validation = null;
        set({ phase: 'closed', result: null, candidate: '', error: null, validating: false, draftChanged: false });
      },
      edit: candidate => { if (get().phase === 'preview' && !get().validating) set({ candidate }); },
      apply: async () => {
        const target = context();
        if (get().phase !== 'preview' || get().validating || !get().candidate.trim() || !target || target.busy || aiCommitBlockReason(target.worktree)) return false;
        if (!confirmDraft(target.message)) return false;
        const version = generation;
        if (!await validate() || !current(version)) return false;
        const latest = context();
        if (!latest || latest.busy || aiCommitBlockReason(latest.worktree) || !confirmDraft(latest.message)) return false;
        /** 同步写入明确的工作区，绝不复用按当前选中项寻址的 setDraft 回调。 */
        useWorkbench.setState(state => ({ drafts: { ...state.drafts, [owner.id]: { message: get().candidate } } }));
        get().close();
        return true;
      },
      connect: () => {
        let previous = context()?.worktree;
        const unsubscribe = useWorkbench.subscribe(() => {
          const target = context();
          if (!target) { if (get().phase !== 'closed') get().close(); return; }
          if (target.worktree === previous) return;
          previous = target.worktree;
          ++revision;
          if (get().phase === 'closed') return;
          if (aiCommitBlockReason(target.worktree)) {
            ++generation;
            cancelRequest();
            validation = null;
            fail({ code: 'stale_snapshot' });
          } else if (get().phase === 'preview') void validate();
        });
        return () => { unsubscribe(); get().close(); };
      },
    };
  });
  return store;
}
