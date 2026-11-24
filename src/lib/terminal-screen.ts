import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useAppearance } from './appearance';
import { resolveTerminalPalette } from './terminal-theme';

/** 每个会话独占 xterm 和滚动缓冲。面板卸载时取回宿主节点，重新显示时直接挂回。 */
export function createTerminalScreen(input: (data: string) => void, resize: (size: { cols: number; rows: number }) => void) {
  const { terminalTheme, resolvedTheme } = useAppearance.getState();
  let theme = resolveTerminalPalette(terminalTheme, resolvedTheme);
  const terminal = new Terminal({
    fontFamily: "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
    fontSize: 13,
    lineHeight: 1.22,
    cursorBlink: true,
    scrollback: 5000,
    minimumContrastRatio: terminalTheme === 'high-contrast' ? 4.5 : 1,
    theme,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.onData(input);
  terminal.onResize(resize);
  const element = document.createElement('div');
  element.className = 'terminal-screen';
  let frame = 0;

  function fitVisible() {
    if (element.clientWidth && element.clientHeight) fit.fit();
  }
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fitVisible);
  });
  /** 改色只更新原有 xterm，隐藏的会话也保留原进程和滚动缓冲。 */
  const unsubscribeTheme = useAppearance.subscribe(state => {
    const next = resolveTerminalPalette(state.terminalTheme, state.resolvedTheme);
    if (next === theme) return;
    theme = next;
    terminal.options.minimumContrastRatio = state.terminalTheme === 'high-contrast' ? 4.5 : 1;
    terminal.options.theme = next;
  });

  function detach() {
    observer.disconnect();
    cancelAnimationFrame(frame);
    element.remove();
  }

  return {
    dimensions: () => ({ cols: terminal.cols, rows: terminal.rows }),
    write: (bytes: Uint8Array, parsed: () => void) => terminal.write(bytes, parsed),
    attach(host: HTMLElement, focus: boolean) {
      host.append(element);
      if (!terminal.element) terminal.open(element);
      fitVisible();
      observer.observe(element);
      if (focus) terminal.focus();
    },
    detach,
    focus() {
      terminal.focus();
      return terminal.textarea === document.activeElement;
    },
    dispose() {
      unsubscribeTheme();
      detach();
      terminal.dispose();
    },
  };
}
