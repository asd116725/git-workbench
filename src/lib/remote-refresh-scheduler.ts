/** 远程检查独立于文件监听，按活动工作区的前台时间和空闲状态调度。 */
export function createRemoteRefreshScheduler(check: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  let eligible = false;
  let running = false;
  let nextCheck = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    clearTimeout(timer);
    if (!eligible || running || controller.signal.aborted) return;
    const delay = nextCheck - Date.now();
    if (delay > 0) timer = setTimeout(schedule, delay);
    else void run();
  }

  async function run() {
    running = true;
    try { await check(controller.signal); }
    finally {
      running = false;
      nextCheck = Date.now() + 60_000;
      schedule();
    }
  }

  return {
    setEligible(value: boolean) { eligible = value; schedule(); },
    dispose() { clearTimeout(timer); controller.abort(); },
  };
}
