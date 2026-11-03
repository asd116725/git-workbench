import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** 用户保存的外观模式。 */
export type ThemeMode = 'light' | 'dark' | 'system';
/** 系统模式解析后的实际配色。 */
export type ResolvedTheme = Exclude<ThemeMode, 'system'>;

/** 界面、代码编辑器与原生窗口共用具体配色，系统模式只决定如何解析。 */
export const editorThemes = { light: 'workbench-light', dark: 'workbench-dark' } as const;
/** 原生窗口与页面首次显示共用的底色。 */
export const themeBackgrounds = { light: '#ffffff', dark: '#282c34' } as const;

interface AppearanceState {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeMode) => void;
  setSystemTheme: (theme: ResolvedTheme) => void;
}

function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: ThemeMode): ResolvedTheme {
  return theme === 'system' ? systemTheme() : theme;
}

/** 主题单独保存；旧用户保持深色，重置布局不清除外观偏好。 */
export const useAppearance = create<AppearanceState>()(persist(set => ({
  theme: 'dark',
  resolvedTheme: 'dark',
  setTheme: theme => set({ theme, resolvedTheme: resolveTheme(theme) }),
  setSystemTheme: resolvedTheme => set(state => state.theme === 'system' && state.resolvedTheme !== resolvedTheme
    ? { resolvedTheme } : state),
}), {
  name: 'git-workbench.appearance',
  storage: createJSONStorage(() => localStorage),
  partialize: state => ({ theme: state.theme }),
  merge: (saved, current) => {
    const value = (saved as Partial<AppearanceState> | null)?.theme;
    const theme = value === 'light' || value === 'system' ? value : 'dark';
    return { ...current, theme, resolvedTheme: resolveTheme(theme) };
  },
}));

/** 首次渲染前应用外观；只更新颜色，不重建工作区、草稿或 Diff 模型。 */
export function initializeAppearance(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  function applyDocumentTheme() {
    const { resolvedTheme } = useAppearance.getState();
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeBackgrounds[resolvedTheme]);
  }
  const unsubscribe = useAppearance.subscribe((state, previous) => {
    if (state.resolvedTheme !== previous.resolvedTheme) applyDocumentTheme();
  });
  const updateSystemTheme = (event: MediaQueryListEvent) => useAppearance.getState().setSystemTheme(event.matches ? 'dark' : 'light');
  media.addEventListener('change', updateSystemTheme);
  applyDocumentTheme();
  return () => { unsubscribe(); media.removeEventListener('change', updateSystemTheme); };
}
