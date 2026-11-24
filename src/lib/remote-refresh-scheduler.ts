/** 远程检查只在前台空闲时执行，同一公共 Git 目录跨分支和工作树共享冷却时间。 */
export function createRemoteRefreshScheduler(check: (signal: AbortSignal) => Promise<void>) {
  const nextChecks = new Map<string, number>();
  let repositoryId: string | null = null;
  let controller = new AbortController();
  let eligible = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    clearTimeout(timer);
    if (!repositoryId || !eligible || running || controller.signal.aborted) return;
    const delay = (nextChecks.get(repositoryId) ?? 0) - Date.now();
    if (delay > 0) timer = setTimeout(schedule, delay);
    else void run(repositoryId, controller.signal);
  }

  async function run(id: string, signal: AbortSignal) {
    running = true;
    nextChecks.set(id, Date.now() + 60_000);
    try { await check(signal); }
    finally {
      if (!signal.aborted) {
        running = false;
        nextChecks.set(id, Date.now() + 60_000);
        schedule();
      }
    }
  }

  return {
    setState(id: string | null, ready: boolean) {
      eligible = ready;
      if (repositoryId !== id) {
        repositoryId = id;
        running = false;
        const previous = controller;
        controller = new AbortController();
        previous.abort();
      }
      schedule();
    },
    dispose() { clearTimeout(timer); controller.abort(); },
  };
}
