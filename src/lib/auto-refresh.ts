import { isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { nativeGit } from './native-git';
import { createRefreshScheduler, type RefreshScheduler } from './refresh-scheduler';
import { findWorktree, useWorkbench } from './store';

interface RepositoryChanged { repoPath: string; error?: string }

/** 原生只保留一个监听器，串行切换可避免 StrictMode 清理误关下一次挂载的监听。 */
let watchQueue = Promise.resolve();

function watchRepository(path: string | null): Promise<void> {
  const operation = watchQueue.then(() => nativeGit.watch(path));
  watchQueue = operation.catch(() => {});
  return operation;
}

/** 将原生文件事件和窗口焦点接入调度器；返回值负责释放订阅和异步注册的监听器。 */
export function startAutoRefresh(): () => void {
  if (!isTauri()) return () => {};

  let disposed = false;
  let ready = false;
  let focused = false;
  let focusVersion = 0;
  let path: string | null = null;
  let generation = 0;
  let scheduler: RefreshScheduler | undefined;
  const unlisteners: UnlistenFn[] = [];

  function reportError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    useWorkbench.getState().setAutoRefreshError(`自动刷新监听失败：${message}`);
  }

  function updateState() {
    const state = useWorkbench.getState();
    scheduler?.setState({ focused, idle: !state.busy && !state.restoring && !state.refreshing && !state.autoRefreshing });
  }

  function updateWatch() {
    const currentGeneration = generation;
    const currentScheduler = scheduler;
    void watchRepository(path).then(() => {
      if (disposed || currentGeneration !== generation) return;
      useWorkbench.getState().setAutoRefreshError(null);
      /** 安装监听后补读一次，覆盖首次状态读取与监听生效之间的文件变动。 */
      currentScheduler?.markDirty();
    }).catch(error => {
      if (!disposed && currentGeneration === generation) reportError(error);
    });
  }

  function sync() {
    const state = useWorkbench.getState();
    const worktree = findWorktree(state.repositories, state.activeWorktreeId);
    const nextPath = worktree?.source === 'native' && !worktree.bare && worktree.available !== false ? worktree.path : null;
    if (nextPath !== path) {
      scheduler?.dispose();
      path = nextPath;
      generation += 1;
      scheduler = path ? createRefreshScheduler(() => useWorkbench.getState().refresh({ silent: true })) : undefined;
      useWorkbench.getState().setAutoRefreshError(null);
      if (ready) updateWatch();
    }
    updateState();
  }

  async function keepListener(registration: Promise<UnlistenFn>) {
    const unlisten = await registration;
    if (disposed) unlisten();
    else unlisteners.push(unlisten);
  }

  async function initialize() {
    const appWindow = getCurrentWindow();
    await Promise.all([
      keepListener(listen<RepositoryChanged>('git:repository-changed', ({ payload }) => {
        if (disposed || payload.repoPath !== path) return;
        if (payload.error) reportError(payload.error);
        // 丢失事件或过滤失败仍可能遗漏文件变化，统一补读状态兜底。
        scheduler?.markDirty();
      })),
      keepListener(appWindow.onFocusChanged(({ payload }) => {
        if (disposed) return;
        focusVersion += 1;
        focused = payload;
        updateState();
      })),
    ]);
    if (disposed) return;
    const version = focusVersion;
    const initiallyFocused = await appWindow.isFocused();
    if (disposed) return;
    if (version === focusVersion) focused = initiallyFocused;
    ready = true;
    updateState();
    updateWatch();
  }

  const unsubscribe = useWorkbench.subscribe(sync);
  sync();
  void initialize().catch(error => { if (!disposed) reportError(error); });

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    scheduler?.dispose();
    for (const unlisten of unlisteners) unlisten();
    void watchRepository(null).catch(() => {});
  };
}
