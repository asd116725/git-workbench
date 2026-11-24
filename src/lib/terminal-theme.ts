import type { ITheme } from '@xterm/xterm';
import type { ResolvedTheme } from './appearance';

/** 主题菜单和持久化校验使用同一组选项。 */
export const terminalThemeOptions = [
  { id: 'classic', label: '经典深色' },
  { id: 'light', label: '浅色' },
  { id: 'warm', label: '暖色' },
  { id: 'high-contrast', label: '高对比' },
  { id: 'workbench', label: '跟随工作台' },
] as const;

/** 终端配色偏好独立于工作台，跟随模式使用工作台已经解析的深浅外观。 */
export type TerminalTheme = typeof terminalThemeOptions[number]['id'];

type TerminalPalette = ITheme & Required<Pick<ITheme, 'background' | 'foreground' | 'red' | 'green' | 'blue'>>;

const palettes = {
  classic: {
    background: '#171b24', foreground: '#e0e3eb', cursor: '#f0f2f7', selectionBackground: '#3d4b66',
    black: '#303644', red: '#ec8591', green: '#97cf86', yellow: '#e6c17e', blue: '#87afff',
    magenta: '#cd9be5', cyan: '#71cbd8', white: '#dde2ed', brightBlack: '#8390a3',
  },
  light: {
    background: '#fafbfe', foreground: '#253249', cursor: '#1d4fa1', cursorAccent: '#fafbfe', selectionBackground: '#d5e4fb',
    black: '#243047', red: '#ab3044', green: '#267342', yellow: '#805600', blue: '#245bb1',
    magenta: '#7b4899', cyan: '#126c77', white: '#52627a', brightBlack: '#607088',
    brightRed: '#b12e3f', brightGreen: '#1c7132', brightYellow: '#865b00', brightBlue: '#2058b5',
    brightMagenta: '#884697', brightCyan: '#076c78', brightWhite: '#334259',
    scrollbarSliderBackground: '#596c8d38', scrollbarSliderHoverBackground: '#596c8d66', scrollbarSliderActiveBackground: '#596c8d80',
  },
  warm: {
    background: '#251e19', foreground: '#f2e4d5', cursor: '#f5cb92', cursorAccent: '#251e19', selectionBackground: '#594434',
    black: '#44382e', red: '#f09a8c', green: '#b3cb8d', yellow: '#ebbf78', blue: '#a8bedf',
    magenta: '#ddb0cf', cyan: '#a8d2bf', white: '#e7d7c2', brightBlack: '#aa9685',
    brightRed: '#ffb4a4', brightGreen: '#c7dfa0', brightYellow: '#ffd592', brightBlue: '#bfcef0',
    brightMagenta: '#eec2dd', brightCyan: '#bbe4d1', brightWhite: '#fff2e1',
  },
  'high-contrast': {
    background: '#08090b', foreground: '#f7f8fa', cursor: '#ffffff', cursorAccent: '#08090b', selectionBackground: '#2a507e',
    black: '#08090b', red: '#ff929c', green: '#a6ef97', yellow: '#ffe27a', blue: '#9bc1ff',
    magenta: '#e8b2ff', cyan: '#89e9ef', white: '#e6eaf2', brightBlack: '#b4bdcb',
    brightRed: '#ffb2ba', brightGreen: '#c1ffa9', brightYellow: '#fff399', brightBlue: '#b4d2ff',
    brightMagenta: '#f5ceff', brightCyan: '#a5f6fc', brightWhite: '#ffffff',
  },
} satisfies Record<Exclude<TerminalTheme, 'workbench'>, TerminalPalette>;

/** 从旧版或无效的存储数据恢复时沿用安装后的默认配色。 */
export function restoreTerminalTheme(value: unknown): TerminalTheme {
  return terminalThemeOptions.find(option => option.id === value)?.id ?? 'classic';
}

/** 返回同一份配色对象，供画布、菜单预览和仍在运行的所有会话共用。 */
export function resolveTerminalPalette(theme: TerminalTheme, workbenchTheme: ResolvedTheme): TerminalPalette {
  return palettes[theme === 'workbench' ? workbenchTheme === 'light' ? 'light' : 'classic' : theme];
}
