import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  setTheme: vi.fn(), theme: vi.fn(), setBackgroundColor: vi.fn(), show: vi.fn(),
  onThemeChanged: vi.fn(), unlisten: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: native.isTauri }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => native }));
let stop: (() => void) | undefined;
let saved: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  saved = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
  native.isTauri.mockReturnValue(true);
  native.setTheme.mockResolvedValue(undefined);
  native.setBackgroundColor.mockResolvedValue(undefined);
  native.show.mockResolvedValue(undefined);
  native.theme.mockResolvedValue('light');
  native.onThemeChanged.mockResolvedValue(native.unlisten);
});
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('原生窗口外观', () => {
  it('先完成主题和背景同步，再显示主窗口', async () => {
    saved.set('git-workbench.appearance', JSON.stringify({ state: { theme: 'light' }, version: 0 }));
    const { startNativeAppearance } = await import('./native-appearance');
    stop = startNativeAppearance();
    await vi.waitFor(() => expect(native.show).toHaveBeenCalledOnce());
    expect(native.setTheme).toHaveBeenCalledWith('light');
    expect(native.setBackgroundColor).toHaveBeenCalledWith('#ffffff');
    expect(native.setBackgroundColor.mock.invocationCallOrder[0]).toBeLessThan(native.show.mock.invocationCallOrder[0]);
  });

  it('跟随系统时使用恢复后的原生主题，后续系统变化不再设置固定主题', async () => {
    saved.set('git-workbench.appearance', JSON.stringify({ state: { theme: 'system' }, version: 0 }));
    const { useAppearance } = await import('./appearance');
    const { startNativeAppearance } = await import('./native-appearance');
    expect(useAppearance.getState().resolvedTheme).toBe('dark');
    stop = startNativeAppearance();
    await vi.waitFor(() => expect(native.show).toHaveBeenCalledOnce());
    expect(native.setTheme).toHaveBeenCalledWith(null);
    expect(useAppearance.getState().resolvedTheme).toBe('light');
    native.onThemeChanged.mock.calls[0][0]({ payload: 'dark' });
    await vi.waitFor(() => expect(native.setBackgroundColor).toHaveBeenLastCalledWith('#282c34'));
    expect(native.setTheme).toHaveBeenCalledOnce();
    useAppearance.getState().setTheme('light');
    native.onThemeChanged.mock.calls[0][0]({ payload: 'dark' });
    await vi.waitFor(() => expect(native.setTheme).toHaveBeenLastCalledWith('light'));
    expect(useAppearance.getState().resolvedTheme).toBe('light');
  });

  it('快速切换时丢弃较早的背景更新，最终采用最新选择', async () => {
    let release!: () => void;
    native.setTheme.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const { startNativeAppearance } = await import('./native-appearance');
    const { useAppearance } = await import('./appearance');
    stop = startNativeAppearance();
    await vi.waitFor(() => expect(native.setTheme).toHaveBeenCalledWith('dark'));
    useAppearance.getState().setTheme('system');
    useAppearance.getState().setTheme('light');
    release();
    await vi.waitFor(() => expect(native.setBackgroundColor).toHaveBeenLastCalledWith('#ffffff'));
    expect(native.setTheme).toHaveBeenLastCalledWith('light');
  });

  it('外观同步失败仍显示窗口，不阻止后续切换', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    native.setTheme.mockRejectedValueOnce(new Error('appearance unavailable'));
    const { startNativeAppearance } = await import('./native-appearance');
    const { useAppearance } = await import('./appearance');
    stop = startNativeAppearance();
    await vi.waitFor(() => expect(native.show).toHaveBeenCalledOnce());
    useAppearance.getState().setTheme('light');
    await vi.waitFor(() => expect(native.setBackgroundColor).toHaveBeenLastCalledWith('#ffffff'));
  });

  it('卸载时清除迟到的监听，不显示已退出的初始化窗口', async () => {
    const { startNativeAppearance } = await import('./native-appearance');
    stop = startNativeAppearance();
    stop();
    await vi.waitFor(() => expect(native.unlisten).toHaveBeenCalledOnce());
    expect(native.show).not.toHaveBeenCalled();
  });

  it('浏览器预览不调用原生窗口', async () => {
    native.isTauri.mockReturnValue(false);
    const { startNativeAppearance } = await import('./native-appearance');
    stop = startNativeAppearance();
    expect(native.onThemeChanged).not.toHaveBeenCalled();
    expect(native.show).not.toHaveBeenCalled();
  });
});
