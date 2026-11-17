import { invoke, isTauri } from '@tauri-apps/api/core';

/** 仅桌面端能调用系统文件管理器；浏览器预览不模拟打开成功。 */
export async function openFolder(path: string): Promise<void> {
  if (!isTauri()) throw new Error('请在桌面应用中打开文件夹。');
  await invoke('open_folder', { path });
}
