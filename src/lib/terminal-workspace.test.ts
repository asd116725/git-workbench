import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { createTerminalWorkspace, groupTerminalSessions, type TerminalEvent } from './terminal-workspace';
import type { Repository, Worktree } from './types';
import { terminalWorktreeLabel } from '../components/branch-display';

const channels = vi.hoisted(() => [] as Array<(event: TerminalEvent) => void>);
interface ScreenProbe {
  input: (data: string) => void;
  output: number[];
  parsed: Array<() => void>;
  writeFailure?: Error;
}
const screens = vi.hoisted(() => [] as ScreenProbe[]);
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => true),
  invoke: vi.fn(),
  Channel: class { constructor(onmessage: (event: TerminalEvent) => void) { channels.push(onmessage); } },
}));
vi.mock('./terminal-screen', () => ({
  createTerminalScreen(input: (data: string) => void) {
    const probe: ScreenProbe = { input, output: [], parsed: [] };
    screens.push(probe);
    return {
      dimensions: () => ({ cols: 80, rows: 24 }),
      write: (data: Uint8Array, parsed: () => void) => {
        if (probe.writeFailure) throw probe.writeFailure;
        probe.output.push(...data);
        probe.parsed.push(parsed);
      },
      attach: vi.fn(), detach: vi.fn(), focus: vi.fn(), dispose: vi.fn(),
    };
  },
}));

const main: Worktree = { id: 'main', name: 'editor', isMain: true, path: '/work/editor', source: 'native', branch: 'main', files: [], commits: [] };
const docs: Worktree = { ...main, id: 'docs', name: 'docs', path: '/work/editor-docs', isMain: false };
const editor: Repository = { id: 'editor', name: 'editor', worktrees: [main, docs] };
const amis: Repository = { id: 'amis', name: 'amis', worktrees: [{ ...main, id: 'amis-main', path: '/work/amis' }] };

beforeEach(() => {
  channels.length = 0;
  screens.length = 0;
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('终端工作区', () => {
  it('重开应用保留标签和选中项，并只为打开的标签启动新 Shell', async () => {
    const before = createTerminalWorkspace();
    await before.getState().start(editor, docs);
    const first = before.getState().activeId!;
    await before.getState().start(amis, amis.worktrees[0]);
    const second = before.getState().activeId!;
    const previousPty = vi.mocked(invoke).mock.calls[0][1];
    before.getState().activate(first);
    before.getState().dispose();
    await Promise.resolve();
    vi.mocked(invoke).mockClear();

    const reopened = createTerminalWorkspace();
    expect(reopened.getState()).toMatchObject({
      activeId: first,
      visible: false,
      sessions: [
        { id: first, phase: 'idle', worktree: { path: '/work/editor-docs' } },
        { id: second, phase: 'idle', worktree: { path: '/work/amis' } },
      ],
    });
    expect(invoke).not.toHaveBeenCalled();
    reopened.getState().toggle();
    await vi.waitFor(() => expect(reopened.getState().sessions[0].phase).toBe('running'));
    expect(vi.mocked(invoke).mock.calls).toMatchObject([['terminal_start', { cwd: '/work/editor-docs' }]]);
    expect(vi.mocked(invoke).mock.calls[0][1]).not.toMatchObject({ id: (previousPty as { id: string }).id });

    reopened.getState().activate(second);
    await vi.waitFor(() => expect(reopened.getState().sessions[1].phase).toBe('running'));
    expect(invoke).toHaveBeenLastCalledWith('terminal_start', expect.objectContaining({ cwd: '/work/amis' }));
  });

  it('关闭尚未启动的恢复标签会删除记录，重新打开后不会恢复', async () => {
    const before = createTerminalWorkspace();
    await before.getState().start(editor, docs);
    await before.getState().start(editor, docs);
    const [first, second] = before.getState().sessions;
    const reopened = createTerminalWorkspace();
    await reopened.getState().close(first.id);
    expect(createTerminalWorkspace().getState()).toMatchObject({
      activeId: second.id,
      sessions: [{ id: second.id, ordinal: 2 }],
    });
  });

  it('从真实工作树目录名去除原始项目名前缀，保留主工作区、自定义名及空后缀', () => {
    const linked = { ...docs, name: 'demo-editor-docs' };
    const repo = { ...editor, name: 'demo-editor', worktrees: [main, linked] };
    expect(terminalWorktreeLabel(repo, linked, { [repo.id]: '我的项目' })).toBe('docs');
    expect(terminalWorktreeLabel(repo, main, {})).toBe('主工作区');
    expect(terminalWorktreeLabel(repo, linked, { [linked.id]: 'demo-editor-自定义' })).toBe('demo-editor-自定义');
    expect(terminalWorktreeLabel(repo, { ...linked, name: 'demo-editor-' }, {})).toBe('demo-editor-');
  });

  it('其他工作树的名称或别名已占用后缀时保留长名；同一工作树的重复标签仍可用短名', () => {
    const linked = { ...docs, name: 'demo-editor-docs' };
    const other = { ...docs, id: 'other', name: 'docs' };
    const repo = { name: 'demo-editor', worktrees: [linked, other] };
    expect(terminalWorktreeLabel(repo, linked, {})).toBe('demo-editor-docs');
    expect(terminalWorktreeLabel({ ...repo, worktrees: [linked, main] }, linked, { [main.id]: 'docs' })).toBe('demo-editor-docs');
    expect(terminalWorktreeLabel({ ...repo, worktrees: [linked, linked] }, linked, {})).toBe('docs');
  });

  it('同项目会话相邻，单个主会话收缩，已分配的重复工作树编号在关闭其他会话后保留', async () => {
    const store = createTerminalWorkspace();
    const { start, close } = store.getState();
    await start(editor, main);
    await start(amis, amis.worktrees[0]);
    await start(editor, docs);
    await start(editor, docs);
    const groups = groupTerminalSessions(store.getState().sessions);
    expect(groups.map(group => [group.repositoryId, group.compact, group.sessions.map(s => s.worktree.name)])).toEqual([
      ['editor', false, ['editor', 'docs', 'docs']], ['amis', true, ['editor']],
    ]);
    await close(groups[0].sessions[1].id);
    expect(store.getState().sessions.find(s => s.worktree.id === 'docs')?.ordinal).toBe(2);
    await start(editor, docs);
    expect(store.getState().sessions.filter(s => s.worktree.id === 'docs').map(s => s.ordinal)).toEqual([2, 3]);
  });

  it('关闭活动标签后按屏幕上的项目分组顺序选择相邻会话', async () => {
    const store = createTerminalWorkspace();
    const { start, activate, close } = store.getState();
    await start(editor, main);
    const mainId = store.getState().activeId!;
    await start(amis, amis.worktrees[0]);
    await start(editor, docs);
    const docsId = store.getState().activeId;
    activate(mainId);
    await close(mainId);
    expect(store.getState().activeId).toBe(docsId);
  });

  it('未显示的输出保留完整字节、标记未读，恢复原标签时清除，最后一个关闭后收起', async () => {
    const store = createTerminalWorkspace();
    const { start, toggle, hide, close } = store.getState();
    await start(editor, main);
    const id = store.getState().activeId!;
    hide();
    channels[0]({ type: 'output', data: '5Lit' });
    expect(screens[0].output).toEqual([228, 184, 173]);
    expect(store.getState().sessions[0].unread).toBe(true);
    toggle(amis, amis.worktrees[0]);
    expect(store.getState()).toMatchObject({ visible: true, activeId: id, sessions: [{ id, unread: false }] });
    await close(id);
    expect(store.getState()).toMatchObject({ visible: false, maximized: false, sessions: [] });
  });

  it('只在 xterm 解析完成后确认原始字节数，输入阻塞也不阻塞输出确认', async () => {
    const store = createTerminalWorkspace();
    await store.getState().start(editor, main);
    let written!: () => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>(done => { written = done; }));
    screens[0].input('a');
    await vi.waitFor(() => expect(written).toBeDefined());
    channels[0]({ type: 'output', data: '5Lit' });
    expect(invoke).not.toHaveBeenCalledWith('terminal_ack', expect.anything());
    screens[0].parsed[0]();
    expect(invoke).toHaveBeenCalledWith('terminal_ack', expect.objectContaining({ bytes: 3 }));
    written();
  });

  it('同步渲染错误不会中断通道序列，并关闭对应 PTY 以释放背压', async () => {
    const store = createTerminalWorkspace();
    await store.getState().start(editor, main);
    screens[0].writeFailure = new Error('render stopped');
    expect(() => channels[0]({ type: 'output', data: 'Cg==' })).not.toThrow();
    await vi.waitFor(() => expect(store.getState().sessions[0]).toMatchObject({ phase: 'exited', error: 'render stopped' }));
    expect(invoke).toHaveBeenCalledWith('terminal_close', expect.anything());
    expect(invoke).not.toHaveBeenCalledWith('terminal_ack', expect.anything());
  });

  it('启动应答迟于退出时保留退出码，重启继续使用起始目录，旧通道无法污染新进程', async () => {
    const store = createTerminalWorkspace();
    vi.mocked(invoke).mockImplementationOnce(async () => {
      channels[0]({ type: 'output', data: 'Cg==' });
      channels[0]({ type: 'exit', code: 12 });
    });
    await store.getState().start(editor, docs);
    expect(screens[0].output).toEqual([10]);
    const session = store.getState().sessions[0];
    expect(session).toMatchObject({ phase: 'exited', exitCode: 12 });
    await store.getState().restart(session.id);
    channels[0]({ type: 'exit', code: 7 });
    expect(store.getState().sessions[0]).toMatchObject({ phase: 'running', worktree: { path: '/work/editor-docs' } });
    const starts = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'terminal_start');
    expect(starts.map(([, args]) => args)).toMatchObject([{ cwd: '/work/editor-docs' }, { cwd: '/work/editor-docs' }]);
    expect((starts[0][1] as { id: string }).id).not.toBe((starts[1][1] as { id: string }).id);
  });

  it('输入按顺序等待启动成功和前一次写入，关闭启动中的标签清理其原生进程', async () => {
    const store = createTerminalWorkspace();
    let ready!: () => void;
    let written!: () => void;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'terminal_start') await new Promise<void>(done => { ready = done; });
      if (command === 'terminal_write' && (args as { data: string }).data === 'a') await new Promise<void>(done => { written = done; });
    });
    const opening = store.getState().start(editor, docs);
    await vi.waitFor(() => expect(ready).toBeDefined());
    screens[0].input('a');
    screens[0].input('b');
    expect(vi.mocked(invoke).mock.calls.map(([c]) => c)).toEqual(['terminal_start']);
    ready();
    await opening;
    await vi.waitFor(() => expect(written).toBeDefined());
    expect(vi.mocked(invoke).mock.calls.map(([c]) => c)).toEqual(['terminal_start', 'terminal_write']);
    written();
    await vi.waitFor(() => expect(vi.mocked(invoke).mock.calls[2]).toMatchObject(['terminal_write', { data: 'b' }]));
    const pending = store.getState().start(editor, main);
    await vi.waitFor(() => expect(channels).toHaveLength(2));
    const closing = store.getState().close(store.getState().activeId!);
    ready();
    await Promise.all([pending, closing]);
    expect(store.getState().sessions.map(s => s.worktree.id)).toEqual(['docs']);
    expect(vi.mocked(invoke).mock.lastCall?.[0]).toBe('terminal_close');
  });

  it('启动失败保留路径，可原位重试，浏览器、裸仓库和不可用目录不发起启动', async () => {
    const store = createTerminalWorkspace();
    const { start, restart } = store.getState();
    vi.mocked(isTauri).mockReturnValue(false);
    await start(editor, main);
    vi.mocked(isTauri).mockReturnValue(true);
    for (const target of [{ ...main, bare: true }, { ...main, available: false }, { ...main, source: undefined }]) await start(editor, target);
    expect(store.getState().sessions).toEqual([]);
    vi.mocked(invoke).mockRejectedValueOnce('directory missing');
    await start(editor, main);
    expect(store.getState().sessions[0]).toMatchObject({ phase: 'failed', error: 'directory missing', worktree: { path: '/work/editor' } });
    await restart(store.getState().activeId!);
    expect(store.getState().sessions).toHaveLength(1);
    expect(store.getState().sessions[0].phase).toBe('running');
  });
});
