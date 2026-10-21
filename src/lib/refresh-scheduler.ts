/** 自动刷新只消费已收到的变更事件，窗口切回前台不会凭空产生刷新。 */
export interface RefreshScheduler {
  markDirty(): void;
  setState(state: { focused: boolean; idle: boolean }): void;
  dispose(): void;
}

/** 合并文件事件，并在前台且仓库空闲时执行；刷新结束后留出 5 秒冷却期。 */
export function createRefreshScheduler(refresh: () => Promise<void>): RefreshScheduler {
  let focused = false;
  let idle = false;
  let dirty = false;
  let running = false;
  let disposed = false;
  let debounceUntil = 0;
  let cooldownUntil = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    clearTimeout(timer);
    timer = undefined;
    if (disposed || !dirty || running || !focused || !idle) return;

    const delay = Math.max(debounceUntil, cooldownUntil) - Date.now();
    if (delay > 0) timer = setTimeout(schedule, delay);
    else void run();
  }

  async function run() {
    dirty = false;
    running = true;
    try {
      await refresh();
    } catch {
      /** 失败由调用方展示；仅在收到新事件后重试，避免循环报错。 */
    } finally {
      running = false;
      cooldownUntil = Date.now() + 5_000;
      schedule();
    }
  }

  return {
    markDirty() {
      dirty = true;
      debounceUntil = Date.now() + 1_000;
      schedule();
    },
    setState(state) {
      focused = state.focused;
      idle = state.idle;
      schedule();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
