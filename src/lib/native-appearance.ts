import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { themeBackgrounds, useAppearance } from './appearance';

/** 原生窗口先同步外观再显示；串行处理切换，避免较早的 IPC 覆盖新选择。 */
export function startNativeAppearance(): () => void {
  if (!isTauri()) return () => {};
  const window = getCurrentWindow();
  let disposed = false;
  let unlisten: (() => void) | undefined;
  let pending = Promise.resolve();
  const report = (error: unknown) => console.error('同步窗口外观失败：', error);

  /** 执行时读取最新偏好，系统仅变色时不再设置固定窗口主题。 */
  function synchronize(changeTheme: boolean) {
    pending = pending.then(async () => {
      if (disposed) return;
      const { theme } = useAppearance.getState();
      if (changeTheme) await window.setTheme(theme === 'system' ? null : theme);
      if (disposed || useAppearance.getState().theme !== theme) return;
      if (changeTheme && theme === 'system') {
        // macOS 的媒体查询可能仍反映之前的窗口覆盖值，先读取恢复跟随后的实际主题。
        const effectiveTheme = await window.theme();
        if (disposed || useAppearance.getState().theme !== theme) return;
        if (effectiveTheme) useAppearance.getState().setSystemTheme(effectiveTheme);
      }
      await window.setBackgroundColor(themeBackgrounds[useAppearance.getState().resolvedTheme]);
    }).catch(report);
    return pending;
  }

  const unsubscribe = useAppearance.subscribe((state, previous) => {
    if (state.theme !== previous.theme || state.resolvedTheme !== previous.resolvedTheme) {
      void synchronize(state.theme !== previous.theme);
    }
  });
  void window.onThemeChanged(event => useAppearance.getState().setSystemTheme(event.payload))
    .then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(report);
  // 外观同步失败也显示窗口，避免非关键的外观错误让整个应用不可见。
  void synchronize(true).then(() => { if (!disposed) void window.show().catch(report); });
  return () => { disposed = true; unsubscribe(); unlisten?.(); };
}
