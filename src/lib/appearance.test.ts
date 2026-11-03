import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let saved: Map<string, string>;
let dark: boolean;
let listeners: Set<(event: { matches: boolean }) => void>;
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.resetModules();
  saved = new Map();
  dark = false;
  listeners = new Set();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  vi.stubGlobal('window', { matchMedia: () => ({
    get matches() { return dark; },
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
  }), localStorage });
  vi.stubGlobal('document', {
    documentElement: { dataset: {}, classList: { toggle: vi.fn() } },
    querySelector: () => ({ setAttribute: vi.fn() }),
  });
});
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); });

describe('外观选择与启动恢复', () => {
  it('旧用户保持深色，即使系统当前是浅色', async () => {
    const { useAppearance, initializeAppearance } = await import('./appearance');
    stop = initializeAppearance();
    expect(useAppearance.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('首次渲染前恢复浅色，重新加载记住选择但不保存系统解析值', async () => {
    const appearance = await import('./appearance');
    appearance.useAppearance.getState().setTheme('light');
    expect(JSON.parse(saved.get('git-workbench.appearance')!).state).toEqual({ theme: 'light' });
    vi.resetModules();
    const restored = await import('./appearance');
    stop = restored.initializeAppearance();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(restored.useAppearance.getState().resolvedTheme).toBe('light');
  });

  it.each(['unknown', null, 123])('无效偏好 %s 回退到深色', async theme => {
    saved.set('git-workbench.appearance', JSON.stringify({ state: { theme }, version: 0 }));
    expect((await import('./appearance')).useAppearance.getState().theme).toBe('dark');
  });

  it('系统模式恢复时重新读取外观，变化仅影响系统模式，结束监听后不再更新文档', async () => {
    saved.set('git-workbench.appearance', JSON.stringify({ state: { theme: 'system', resolvedTheme: 'dark' }, version: 0 }));
    const { useAppearance, initializeAppearance } = await import('./appearance');
    stop = initializeAppearance();
    expect(document.documentElement.dataset.theme).toBe('light');
    dark = true;
    listeners.forEach(listener => listener({ matches: dark }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    useAppearance.getState().setTheme('light');
    listeners.forEach(listener => listener({ matches: true }));
    expect(document.documentElement.dataset.theme).toBe('light');
    stop();
    expect(listeners.size).toBe(0);
    useAppearance.getState().setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('切换外观不修改仓库和草稿，恢复布局不修改主题', async () => {
    const { useAppearance } = await import('./appearance');
    const { usePreferences, useWorkbench } = await import('./store');
    useWorkbench.getState().setDraft({ message: '保留未完成的提交\n\n保留正文' });
    const workbench = useWorkbench.getState();
    useAppearance.getState().setTheme('light');
    usePreferences.getState().resetLayout();
    expect(useWorkbench.getState()).toBe(workbench);
    expect(useAppearance.getState().theme).toBe('light');
  });
});
