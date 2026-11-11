import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let saved: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  saved = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  vi.stubGlobal('window', { localStorage });
});
afterEach(() => vi.unstubAllGlobals());

describe('仓库栏布局偏好', () => {
  it('旧版百分比布局默认迁移为左侧展开 300px，保留其他偏好', async () => {
    saved.set('git-workbench.preferences', JSON.stringify({ state: { layout: { repositories: 24, workspace: 76, changes: 30, diff: 70 }, fontSize: 17 }, version: 0 }));
    const { usePreferences } = await import('./store');
    expect(usePreferences.getState()).toMatchObject({ sidebarSide: 'left', sidebarCollapsed: false, sidebarWidth: 300, fontSize: 17, layout: { changes: 30, diff: 70 } });
  });

  it('换侧与收起持久化，刷新后保留独立的展开宽度', async () => {
    const { usePreferences } = await import('./store');
    const preferences = usePreferences.getState();
    preferences.setSidebarWidth(336);
    preferences.setSidebarSide('right');
    preferences.setSidebarCollapsed(true);
    expect(JSON.parse(saved.get('git-workbench.preferences')!).state).toMatchObject({ sidebarSide: 'right', sidebarCollapsed: true, sidebarWidth: 336 });
    vi.resetModules();
    const restored = await import('./store');
    expect(restored.usePreferences.getState()).toMatchObject({ sidebarSide: 'right', sidebarCollapsed: true, sidebarWidth: 336 });
    restored.usePreferences.getState().setSidebarCollapsed(false);
    expect(restored.usePreferences.getState().sidebarWidth).toBe(336);
  });

  it('恢复默认布局还原左侧展开与 300px，保留 AI 模式', async () => {
    const { usePreferences } = await import('./store');
    usePreferences.setState({ sidebarSide: 'right', sidebarCollapsed: true, sidebarWidth: 360, aiCommitMode: 'detailed', layout: { changes: 35, diff: 65 } });
    usePreferences.getState().resetLayout();
    expect(usePreferences.getState()).toMatchObject({ sidebarSide: 'left', sidebarCollapsed: false, sidebarWidth: 300, aiCommitMode: 'detailed', layout: {} });
  });
});
