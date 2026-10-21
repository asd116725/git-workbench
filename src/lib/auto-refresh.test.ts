import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { startAutoRefresh } from './auto-refresh';
import { useWorkbench } from './store';
import type { Worktree } from './types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));

interface ChangeEvent { repoPath: string; error?: string }
const changes = new Set<EventCallback<ChangeEvent>>();
const focusChanges = new Set<EventCallback<boolean>>();
const onFocusChanged = vi.fn<(handler: EventCallback<boolean>) => Promise<UnlistenFn>>();
const isFocused = vi.fn<() => Promise<boolean>>();
const refresh = vi.fn(async () => {});
const setError = vi.fn();
const cleanups: Array<() => void> = [];
const main: Worktree = { id: 'main', path: '/test/main', source: 'native', name: 'main', branch: 'main', files: [], commits: [] };
const linked: Worktree = { ...main, id: 'linked', path: '/test/linked' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function start() {
  const stop = startAutoRefresh();
  cleanups.push(stop);
  return stop;
}

function change(repoPath = main.path, error?: string) {
  for (const handler of changes) handler({ event: 'git:repository-changed', id: 0, payload: { repoPath, error } });
}

function focus(value: boolean) {
  for (const handler of focusChanges) handler({ event: 'tauri://focus', id: 0, payload: value });
}

function watchedPaths() {
  return vi.mocked(invoke).mock.calls.filter(([command]) => command === 'git_watch').map(([, args]) => (args as { repoPath: string | null }).repoPath);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  vi.mocked(listen).mockReset().mockImplementation(async (_event, handler) => {
    const callback = handler as EventCallback<ChangeEvent>;
    changes.add(callback);
    return () => { changes.delete(callback); };
  });
  onFocusChanged.mockReset().mockImplementation(async handler => {
    focusChanges.add(handler);
    return () => { focusChanges.delete(handler); };
  });
  isFocused.mockReset().mockResolvedValue(true);
  vi.mocked(getCurrentWindow).mockReturnValue({ onFocusChanged, isFocused } as unknown as ReturnType<typeof getCurrentWindow>);
  refresh.mockReset().mockResolvedValue(undefined);
  setError.mockReset();
  useWorkbench.getState().reset();
  useWorkbench.setState({
    repositories: [{ id: 'repo', name: 'test', worktrees: [main, linked] }], activeWorktreeId: main.id,
    busy: false, restoring: false, refreshing: false, autoRefreshing: false,
    refresh, setAutoRefreshError: setError,
  });
});

afterEach(async () => {
  for (const stop of cleanups.splice(0)) stop();
  await vi.advanceTimersByTimeAsync(0);
  changes.clear();
  focusChanges.clear();
  vi.useRealTimers();
});

describe('原生自动刷新生命周期', () => {
  it('浏览器演示模式不接触任何原生 API', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listen).not.toHaveBeenCalled();
    expect(getCurrentWindow).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('先注册事件监听，再开启仓库监听并静默补读一次', async () => {
    const registration = deferred<UnlistenFn>();
    vi.mocked(listen).mockReturnValueOnce(registration.promise);
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).not.toHaveBeenCalled();
    registration.resolve(() => {});
    await vi.advanceTimersByTimeAsync(999);
    expect(watchedPaths()).toEqual([main.path]);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledExactlyOnceWith({ silent: true });
  });

  it('无变更的焦点切换不刷新，后台事件在回到前台后合并处理', async () => {
    start();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    focus(false);
    focus(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    focus(false);
    change();
    change();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    focus(true);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it.each(['busy', 'restoring', 'refreshing', 'autoRefreshing'] as const)('%s 期间保留变更，恢复空闲后再执行', async field => {
    start();
    await vi.advanceTimersByTimeAsync(6_000);
    useWorkbench.setState({ [field]: true });
    change();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    useWorkbench.setState({ [field]: false });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('切换工作区废弃旧计时和旧仓库事件，仅刷新新工作区', async () => {
    start();
    await vi.advanceTimersByTimeAsync(500);
    useWorkbench.setState({ activeWorktreeId: linked.id });
    await vi.advanceTimersByTimeAsync(999);
    expect(watchedPaths()).toEqual([main.path, linked.path]);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    change(main.path);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    change(linked.path);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('较晚返回的初始焦点查询不会覆盖已收到的焦点事件', async () => {
    const initialFocus = deferred<boolean>();
    isFocused.mockReturnValueOnce(initialFocus.promise);
    start();
    await vi.advanceTimersByTimeAsync(0);
    focus(false);
    initialFocus.resolve(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(refresh).not.toHaveBeenCalled();
    focus(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('清理会注销监听、取消刷新并关闭原生 watcher', async () => {
    const stop = start();
    await vi.advanceTimersByTimeAsync(500);
    stop();
    change();
    focus(true);
    useWorkbench.setState({ activeWorktreeId: linked.id });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(changes.size).toBe(0);
    expect(focusChanges.size).toBe(0);
    expect(watchedPaths()).toEqual([main.path, null]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('异步注册尚未结束就清理时，晚到监听器立即释放且不会开启 watcher', async () => {
    const registration = deferred<UnlistenFn>();
    const unlisten = vi.fn();
    vi.mocked(listen).mockReturnValueOnce(registration.promise);
    const stop = start();
    stop();
    registration.resolve(unlisten);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(unlisten).toHaveBeenCalledOnce();
    expect(focusChanges.size).toBe(0);
    expect(watchedPaths()).toEqual([null]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('StrictMode 的关闭和重新开启按原生调用顺序串行执行', async () => {
    const firstWatch = deferred<void>();
    vi.mocked(invoke).mockImplementationOnce(() => firstWatch.promise);
    const stop = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(watchedPaths()).toEqual([main.path]);
    stop();
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(watchedPaths()).toEqual([main.path]);
    firstWatch.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(watchedPaths()).toEqual([main.path, null, main.path]);
    expect(changes.size).toBe(1);
    expect(focusChanges.size).toBe(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('监听开启失败不循环重试；当前仓库的事件错误会提示并补读，旧路径错误被忽略', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('没有监听权限'));
    start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(setError).toHaveBeenLastCalledWith('自动刷新监听失败：没有监听权限');
    expect(watchedPaths()).toEqual([main.path]);
    expect(refresh).not.toHaveBeenCalled();
    useWorkbench.setState({ activeWorktreeId: linked.id });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    setError.mockClear();
    change(main.path, '旧仓库错误');
    expect(setError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    change(linked.path, '监听已中断');
    expect(setError).toHaveBeenLastCalledWith('自动刷新监听失败：监听已中断');
    await vi.advanceTimersByTimeAsync(999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(watchedPaths()).toEqual([main.path, linked.path]);
  });

  it('事件订阅失败会提示错误，避免开启无法接收通知的 watcher', async () => {
    vi.mocked(listen).mockRejectedValueOnce(new Error('事件订阅不可用'));
    start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(setError).toHaveBeenLastCalledWith('自动刷新监听失败：事件订阅不可用');
    expect(watchedPaths()).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledOnce();
  });
});
