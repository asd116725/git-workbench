import { useEffect, useState } from 'react';
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Repository, Worktree } from './types';
import type { createTerminalScreen } from './terminal-screen';

/** 同一通道按原生读取顺序传输字节和退出状态，保留跨数据块的多字节字符。 */
export type TerminalEvent =
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number | null }
  | { type: 'error'; message: string };

/** 标签的持久化内容只描述位置和名称，不含 PTY、进程或终端输出。 */
interface TerminalTab {
  id: string;
  repositoryId: string;
  repositoryName: string;
  worktree: Pick<Worktree, 'id' | 'name' | 'path' | 'isMain'>;
  ordinal: number;
}

/** 标签身份与启动目录固定；重新启动只更换对应的 PTY。 */
export interface TerminalSession extends TerminalTab {
  phase: 'idle' | 'starting' | 'running' | 'failed' | 'exited';
  closing: boolean;
  unread: boolean;
  exitCode: number | null;
  error: string | null;
}

interface TerminalGroup {
  repositoryId: string;
  compact: boolean;
  sessions: TerminalSession[];
}

/** 按项目第一次出现的位置分组。只有一个主工作区时，标签只需显示项目名。 */
export function groupTerminalSessions(sessions: TerminalSession[]): TerminalGroup[] {
  const groups = new Map<string, TerminalSession[]>();
  for (const session of sessions) {
    const group = groups.get(session.repositoryId);
    if (group) group.push(session);
    else groups.set(session.repositoryId, [session]);
  }
  return Array.from(groups, ([repositoryId, sessions]) => ({
    repositoryId, sessions, compact: sessions.length === 1 && Boolean(sessions[0].worktree.isMain),
  }));
}

/** 终端只接受有实际目录的本地工作树，演示仓库没有原生路径。 */
export function isTerminalWorktree(worktree: Worktree): boolean {
  return worktree.source === 'native' && !worktree.bare && worktree.available !== false;
}

interface TerminalState {
  sessions: TerminalSession[];
  activeId: string | null;
  visible: boolean;
  maximized: boolean;
  start(repository: Repository, worktree: Worktree): Promise<void>;
  restart(id: string): Promise<void>;
  close(id: string): Promise<void>;
  activate(id: string): void;
  toggle(repository?: Repository, worktree?: Worktree): void;
  toggleMaximized(): void;
  hide(): void;
  attach(id: string, host: HTMLElement, focus: boolean): () => void;
  /** 未初始化或无法聚焦时，调用者可把焦点还给工具栏按钮。 */
  focus(): boolean;
  dispose(): void;
}

interface Connection {
  ptyId: string;
  screen?: ReturnType<typeof createTerminalScreen>;
  host?: HTMLElement;
  focusOnAttach: boolean;
  started: boolean;
  closing: boolean;
  ready: Promise<void>;
  queue: Promise<void>;
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

const tabStorageKey = 'git-workbench.terminal-tabs';

function restoreTabs(): Pick<TerminalState, 'sessions' | 'activeId'> {
  const sessions: TerminalSession[] = [];
  let activeId: string | null = null;
  if (isTauri()) {
    try {
      const saved = JSON.parse(localStorage.getItem(tabStorageKey) ?? 'null');
      if (Array.isArray(saved?.tabs)) {
        const seen = new Set<string>();
        for (const tab of saved.tabs) {
          const { id, repositoryId, repositoryName, worktree, ordinal } = tab ?? {};
          if (typeof id !== 'string' || !id || seen.has(id) ||
            typeof repositoryId !== 'string' || typeof repositoryName !== 'string' ||
            typeof worktree?.id !== 'string' || typeof worktree.name !== 'string' ||
            typeof worktree.path !== 'string' || !worktree.path.startsWith('/') ||
            !Number.isSafeInteger(ordinal) || ordinal < 1) continue;
          seen.add(id);
          sessions.push({
            id, repositoryId, repositoryName, ordinal,
            worktree: { id: worktree.id, name: worktree.name, path: worktree.path, isMain: worktree.isMain === true },
            phase: 'idle', closing: false, unread: false, exitCode: null, error: null,
          });
        }
        activeId = seen.has(saved.activeId) ? saved.activeId : sessions[0]?.id ?? null;
      }
    } catch {
      // 不可用的本地存储不影响创建新终端。
    }
  }
  return { sessions, activeId };
}

/** 每个窗口持有自己的会话，后台输出直接写入 xterm，只有标签状态变化才通知 React。 */
export function createTerminalWorkspace() {
  const connections = new Map<string, Connection>();
  return createStore<TerminalState>((set, get) => {
    /** 完成标签或选择变更时立即保存，退出时不依赖 WebView 继续处理 IPC。 */
    function saveTabs() {
      const { sessions, activeId } = get();
      const tabs: TerminalTab[] = sessions.map(({ id, repositoryId, repositoryName, worktree, ordinal }) =>
        ({ id, repositoryId, repositoryName, worktree, ordinal }));
      try { localStorage.setItem(tabStorageKey, JSON.stringify({ tabs, activeId })); } catch {
        // 保存失败时仍保留本次运行中的标签。
      }
    }

    function patch(id: string, changes: Partial<TerminalSession>) {
      set(state => ({ sessions: state.sessions.map(session => session.id === id ? { ...session, ...changes } : session) }));
    }

    function launch(session: TerminalSession, previous?: Connection) {
      const { id } = session;
      const connection: Connection = {
        ptyId: crypto.randomUUID(), host: previous?.host, focusOnAttach: previous?.focusOnAttach ?? true,
        started: false, closing: false, ready: Promise.resolve(), queue: Promise.resolve(),
      };
      connections.set(id, connection);

      function enqueue(command: string, args: Record<string, unknown>) {
        connection.queue = connection.queue.then(async () => {
          await connection.ready;
          if (connection.started && !connection.closing) await invoke(command, { id: connection.ptyId, ...args });
        }).catch(cause => {
          if (connection.started && !connection.closing) patch(id, { error: message(cause) });
        });
      }

      const current = () => connections.get(id) === connection;
      let outputFailed = false;

      /** 无法消费输出时关闭本次 PTY，释放正在等待字节确认的读端。 */
      function stopOutput(cause: unknown) {
        if (!current() || outputFailed) return;
        outputFailed = true;
        patch(id, { error: message(cause) });
        void connection.ready.then(async () => {
          if (!connection.started || !current()) return;
          await invoke('terminal_close', { id: connection.ptyId });
          connection.started = false;
          if (current()) patch(id, { phase: 'exited' });
        }).catch(closeError => { if (current()) patch(id, { error: message(closeError) }); });
      }

      connection.ready = (async () => {
        try {
          const { createTerminalScreen } = await import('./terminal-screen');
          if (!current() || connection.closing) return;
          const screen = createTerminalScreen(
            data => enqueue('terminal_write', { data }),
            size => { if (connection.started) enqueue('terminal_resize', size); },
          );
          connection.screen = screen;
          if (connection.host) screen.attach(connection.host, connection.focusOnAttach);
          const size = screen.dimensions();
          const channel = new Channel<TerminalEvent>(event => {
            if (!current()) return;
            if (event.type === 'output') {
              if (outputFailed) return;
              try {
                const bytes = Uint8Array.from(atob(event.data), byte => byte.charCodeAt(0));
                screen.write(bytes, () => {
                  if (current() && !outputFailed) void invoke('terminal_ack', { id: connection.ptyId, bytes: bytes.length }).catch(stopOutput);
                });
              } catch (cause) { stopOutput(cause); return; }
              const state = get();
              if ((!state.visible || state.activeId !== id) && !state.sessions.find(s => s.id === id)?.unread) patch(id, { unread: true });
            } else if (event.type === 'exit') {
              connection.started = false;
              patch(id, { phase: 'exited', exitCode: event.code });
            } else {
              patch(id, { error: event.message });
            }
          });
          await invoke('terminal_start', { id: connection.ptyId, cwd: session.worktree.path, ...size, channel });
          if (!current() || get().sessions.find(s => s.id === id)?.phase === 'exited') return;
          connection.started = true;
          patch(id, { phase: 'running' });
          const latest = screen.dimensions();
          if (latest.cols !== size.cols || latest.rows !== size.rows) enqueue('terminal_resize', latest);
        } catch (cause) {
          if (current()) patch(id, { phase: 'failed', error: message(cause) });
        }
      })();
      return connection.ready;
    }

    return {
      ...restoreTabs(), visible: false, maximized: false,
      async start(repository, worktree) {
        if (!isTauri() || !isTerminalWorktree(worktree)) return;
        const siblings = get().sessions.filter(s => s.repositoryId === repository.id && s.worktree.id === worktree.id);
        const session: TerminalSession = {
          id: crypto.randomUUID(), repositoryId: repository.id, repositoryName: repository.name,
          worktree: { id: worktree.id, name: worktree.name, path: worktree.path, isMain: worktree.isMain },
          ordinal: Math.max(0, ...siblings.map(s => s.ordinal)) + 1,
          phase: 'starting', closing: false, unread: false, exitCode: null, error: null,
        };
        const ready = launch(session);
        set(state => ({ sessions: [...state.sessions, session], activeId: session.id, visible: true }));
        saveTabs();
        await ready;
      },
      async restart(id) {
        const session = get().sessions.find(s => s.id === id);
        if (!session || session.closing || session.phase === 'starting' || session.phase === 'running') return;
        const old = connections.get(id);
        old?.screen?.dispose();
        patch(id, { phase: 'starting', error: null, exitCode: null, unread: false });
        await launch(session, old);
      },
      async close(id) {
        const connection = connections.get(id);
        if (connection?.closing || !get().sessions.some(session => session.id === id)) return;
        if (connection) {
          connection.closing = true;
          patch(id, { closing: true });
          try {
            await connection.ready;
            if (connection.started) await invoke('terminal_close', { id: connection.ptyId });
          } catch (cause) {
            connection.closing = false;
            patch(id, { closing: false, error: message(cause) });
            return;
          }
          connections.delete(id);
          connection.screen?.dispose();
        }
        const state = get();
        const ordered = groupTerminalSessions(state.sessions).flatMap(group => group.sessions);
        const index = ordered.findIndex(s => s.id === id);
        const sessions = ordered.filter(s => s.id !== id);
        const activeId = state.activeId === id ? sessions[Math.min(index, sessions.length - 1)]?.id ?? null : state.activeId;
        set({ sessions, activeId, visible: state.visible && Boolean(activeId), maximized: state.maximized && Boolean(activeId) });
        saveTabs();
        if (activeId && state.visible) get().activate(activeId);
      },
      activate(id) {
        const state = get();
        const session = state.sessions.find(session => session.id === id);
        if (!session || session.closing) return;
        set(state => ({
          activeId: id, visible: true, sessions: state.sessions.map(s => s.id === id && s.unread ? { ...s, unread: false } : s),
        }));
        if (state.activeId !== id) saveTabs();
        if (session.phase === 'idle') void get().restart(id);
      },
      toggle(repository, worktree) {
        const state = get();
        if (state.visible) state.hide();
        else if (state.activeId) state.activate(state.activeId);
        else if (repository && worktree) void state.start(repository, worktree);
      },
      toggleMaximized: () => set(state => ({ maximized: !state.maximized })),
      hide: () => set({ visible: false, maximized: false }),
      attach(id, host, focus) {
        const connection = connections.get(id);
        if (connection) {
          connection.host = host;
          connection.focusOnAttach = focus;
          connection.screen?.attach(host, focus);
        }
        return () => {
          const latest = connections.get(id);
          if (latest?.host !== host) return;
          latest.screen?.detach();
          latest.host = undefined;
        };
      },
      focus() { return connections.get(get().activeId ?? '')?.screen?.focus() ?? false; },
      dispose() {
        for (const connection of connections.values()) {
          connection.closing = true;
          connection.screen?.dispose();
          // 就绪应答前也可能已打开 PTY，以会话 ID 请求关闭，保留标签存档。
          void connection.ready.then(() => invoke('terminal_close', { id: connection.ptyId })).catch(() => {});
        }
        connections.clear();
      },
    };
  });
}

/** 从窗口根组件调用，布局或面板的卸载不会释放仍在后台运行的 Shell。 */
export function useTerminalWorkspace() {
  const [store] = useState(createTerminalWorkspace);
  useEffect(() => () => store.getState().dispose(), [store]);
  const state = useStore(store);
  return { ...state, hasSessions: state.sessions.length > 0 };
}
