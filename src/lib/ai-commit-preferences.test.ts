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

describe('AI 提交模式偏好', () => {
  it('旧版偏好补上简洁模式并保留已有设置', async () => {
    saved.set('git-workbench.preferences', JSON.stringify({ state: { fontSize: 17, diffMode: 'inline' }, version: 0 }));
    const { usePreferences } = await import('./store');
    expect(usePreferences.getState()).toMatchObject({ aiCommitMode: 'concise', fontSize: 17, diffMode: 'inline' });
  });

  it('模式选择在重新加载后恢复，恢复布局不会清除选择', async () => {
    const { usePreferences } = await import('./store');
    usePreferences.getState().setAiCommitMode('detailed');
    usePreferences.getState().resetLayout();
    expect(JSON.parse(saved.get('git-workbench.preferences')!).state.aiCommitMode).toBe('detailed');
    vi.resetModules();
    const restored = await import('./store');
    expect(restored.usePreferences.getState().aiCommitMode).toBe('detailed');
    restored.usePreferences.getState().setAiCommitMode('concise');
    expect(JSON.parse(saved.get('git-workbench.preferences')!).state.aiCommitMode).toBe('concise');
  });
});
