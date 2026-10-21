import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRefreshScheduler } from './refresh-scheduler';

describe('文件事件自动刷新调度', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it('没有文件事件时，首次显示和反复切回窗口都不刷新', async () => {
    const refresh = vi.fn(async () => {});
    const scheduler = createRefreshScheduler(refresh);
    scheduler.setState({ focused: true, idle: true });
    await vi.advanceTimersByTimeAsync(60_000);
    scheduler.setState({ focused: false, idle: true });
    scheduler.setState({ focused: true, idle: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('连续事件从最后一次开始防抖 1 秒，只刷新一次', async () => {
    const refresh = vi.fn(async () => {});
    const scheduler = createRefreshScheduler(refresh);
    scheduler.setState({ focused: true, idle: true });
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(600);
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(999);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('初始、后台或仓库忙时保留事件，前台且空闲后才刷新', async () => {
    const refresh = vi.fn(async () => {});
    const scheduler = createRefreshScheduler(refresh);
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(2_000);
    scheduler.setState({ focused: true, idle: false });
    await vi.advanceTimersByTimeAsync(2_000);
    scheduler.setState({ focused: false, idle: true });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    scheduler.setState({ focused: true, idle: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('防抖期间切到后台取消计时，恢复时仍等待剩余防抖时间', async () => {
    const refresh = vi.fn(async () => {});
    const scheduler = createRefreshScheduler(refresh);
    scheduler.setState({ focused: true, idle: true });
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(300);
    scheduler.setState({ focused: false, idle: true });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    scheduler.setState({ focused: true, idle: true });
    await vi.advanceTimersByTimeAsync(499);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('刷新中的事件合并保留，完成后冷却 5 秒再执行', async () => {
    let finish!: () => void;
    const refresh = vi.fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue(undefined);
    const scheduler = createRefreshScheduler(refresh);
    scheduler.setState({ focused: true, idle: true });
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('冷却结束附近的新事件仍完整等待 1 秒防抖', async () => {
    const refresh = vi.fn(async () => {});
    const scheduler = createRefreshScheduler(refresh);
    scheduler.setState({ focused: true, idle: true });
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(4_500);
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('拒绝刷新不会产生未处理异常或无限重试，新事件可再次刷新', async () => {
    const refresh = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('仓库暂时不可用'))
      .mockResolvedValue(undefined);
    const scheduler = createRefreshScheduler(refresh);
    scheduler.setState({ focused: true, idle: true });
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('销毁取消计时，后续事件和状态变化不再刷新', async () => {
    const refresh = vi.fn(async () => {});
    const scheduler = createRefreshScheduler(refresh);
    scheduler.setState({ focused: true, idle: true });
    scheduler.markDirty();
    scheduler.dispose();
    scheduler.markDirty();
    scheduler.setState({ focused: true, idle: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('运行中销毁后，刷新完成也不会重新创建计时器', async () => {
    let finish!: () => void;
    const refresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const scheduler = createRefreshScheduler(refresh);
    scheduler.setState({ focused: true, idle: true });
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.markDirty();
    scheduler.dispose();
    finish();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
