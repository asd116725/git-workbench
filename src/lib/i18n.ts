import { useCallback } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { uiMessages } from './i18n-ui-messages';
import { systemMessages } from './i18n-system-messages';

export type Language = 'zh-CN' | 'zh-TW' | 'en';
export type MessageParams = Record<string, string | number>;
export type MessageCatalog = Record<string, { en: string; 'zh-TW': string }>;

/** 语言名称始终使用自称，避免切换后找不到熟悉的语言。 */
export const languages: ReadonlyArray<{ value: Language; label: string }> = [
  { value: 'zh-CN', label: '中文简体' },
  { value: 'zh-TW', label: '中文繁體' },
  { value: 'en', label: 'English' },
];

interface LanguageState {
  language: Language;
  setLanguage: (language: Language) => void;
}

/** 独立保存语言，恢复布局、重置演示或旧版偏好迁移均不会清除语言选择。 */
const useLanguageStore = create<LanguageState>()(persist(set => ({
  language: 'zh-CN',
  setLanguage: language => set({ language }),
}), {
  name: 'git-workbench.language',
  storage: createJSONStorage(() => localStorage),
  partialize: state => ({ language: state.language }),
  merge: (saved, current) => {
    const language = (saved as Partial<LanguageState> | null)?.language;
    return { ...current, language: languages.some(item => item.value === language) ? language! : 'zh-CN' };
  },
}));

const messages: MessageCatalog = { ...uiMessages, ...systemMessages };

/** 业务层按调用时的语言生成展示文案，不改变仓库原始数据。 */
export function getLanguage(): Language { return useLanguageStore.getState().language; }

/** 设置持久化的界面语言，已打开的视图通过订阅即时更新。 */
export function setLanguage(language: Language): void { useLanguageStore.getState().setLanguage(language); }

function translate(source: string, params: MessageParams | undefined, language: Language): string {
  const message = language === 'zh-CN' ? source : messages[source]?.[language] ?? source;
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => params?.[name] === undefined ? placeholder : String(params[name]));
}

/** 仅翻译显式登记的应用文案；插值作为原文插入，不再参与翻译或占位符替换。 */
export function t(source: string, params?: MessageParams): string { return translate(source, params, getLanguage()); }

/** 组件订阅语言而非整个工作区，切换不会重新创建仓库会话或提交草稿。 */
export function useI18n() {
  const language = useLanguageStore(state => state.language);
  const translateText = useCallback((source: string, params?: MessageParams) => translate(source, params, language), [language]);
  return { language, setLanguage, t: translateText };
}

function updateDocumentLanguage() {
  if (typeof document === 'undefined') return;
  const language = getLanguage();
  document.documentElement.lang = language;
  document.title = language === 'en' ? 'Git Workbench' : `${language === 'zh-TW' ? '程式碼管理' : '代码管理'} · Git Workbench`;
}

updateDocumentLanguage();
useLanguageStore.subscribe(updateDocumentLanguage);
