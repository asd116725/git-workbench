import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./i18n-ui-messages', () => ({ uiMessages: {
  '消息 {value}': { en: 'Message {value}', 'zh-TW': '訊息 {value}' },
} }));
vi.mock('./i18n-system-messages', () => ({ systemMessages: {} }));

let saved: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  saved = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  vi.stubGlobal('document', { documentElement: { lang: '' }, title: '' });
});
afterEach(() => vi.unstubAllGlobals());

describe('界面语言', () => {
  it('首次使用默认简体，并同步文档语言', async () => {
    const { getLanguage, t } = await import('./i18n');
    expect(getLanguage()).toBe('zh-CN');
    expect(t('消息 {value}', { value: 0 })).toBe('消息 0');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('三种语言双向切换，插值内容不会被再次翻译或替换', async () => {
    const { setLanguage, t } = await import('./i18n');
    const value = '消息 $& {value} /中文路径.ts';
    setLanguage('en');
    expect(t('消息 {value}', { value })).toBe(`Message ${value}`);
    expect(document.title).toBe('Git Workbench');
    setLanguage('zh-TW');
    expect(t('消息 {value}', { value })).toBe(`訊息 ${value}`);
    setLanguage('zh-CN');
    expect(t('消息 {value}', { value })).toBe(`消息 ${value}`);
    expect(t('未登记的原文')).toBe('未登记的原文');
  });

  it('重新加载恢复语言，保留原有布局和仓库会话', async () => {
    saved.set('git-workbench.preferences', '{"state":{"fontSize":17}}');
    saved.set('git-workbench.session', '原有仓库会话');
    const { setLanguage } = await import('./i18n');
    setLanguage('en');
    vi.resetModules();
    expect((await import('./i18n')).getLanguage()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(saved.get('git-workbench.preferences')).toBe('{"state":{"fontSize":17}}');
    expect(saved.get('git-workbench.session')).toBe('原有仓库会话');
  });

  it.each(['fr', null, 123])('不支持的持久化语言 %s 回退简体', async language => {
    saved.set('git-workbench.language', JSON.stringify({ state: { language }, version: 0 }));
    expect((await import('./i18n')).getLanguage()).toBe('zh-CN');
  });
});
