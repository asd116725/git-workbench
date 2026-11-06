import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { aiCommitBlockReason, createAiCommitSession } from './ai-commit-session';
import { aiCommitErrorCode, type AiCommitResult } from './native-ai-commit';
import { setLanguage } from './i18n';
import { findWorktree, useWorkbench } from './store';
import type { Worktree } from './types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));

const owner: Worktree = {
  id: 'native:/repo', path: '/repo', name: 'repo', branch: 'main', source: 'native', hasHead: true, commits: [],
  files: [{ id: 'a.ts', path: 'a.ts', language: 'typescript', head: null, index: null, working: null, git: { statusIndex: 'M', statusWorktree: 'M', originalPath: null, conflicted: false } }],
};
const other: Worktree = { ...owner, id: 'native:/other', path: '/other', branch: 'feature/other' };
const result: AiCommitResult = { message: 'fix(core): 修复暂存内容\n\n保留未暂存修改', snapshotId: 'snapshot-1', files: ['a.ts'] };
const mockedInvoke = vi.mocked(invoke);
let session: ReturnType<typeof createAiCommitSession>;
let disconnect: () => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function reply(command: string) {
  if (command === 'ai_commit_check_key') return { available: true };
  if (command === 'ai_commit_generate') return result;
  if (command === 'ai_commit_validate') return true;
  if (command === 'ai_commit_cancel') return;
  throw new Error(`Unexpected command: ${command}`);
}

function replaceWorktree(patch: Partial<Worktree> = {}) {
  const state = useWorkbench.getState();
  const worktree = findWorktree(state.repositories, owner.id)!;
  useWorkbench.setState({ repositories: [{ id: 'repo', name: 'repo', worktrees: [{ ...worktree, ...patch }, other] }] });
}

function draft() { return useWorkbench.getState().drafts[owner.id].message; }

beforeEach(() => {
  setLanguage('zh-CN');
  mockedInvoke.mockReset().mockImplementation(reply);
  useWorkbench.setState({ repositories: [{ id: 'repo', name: 'repo', worktrees: [owner, other] }], activeWorktreeId: owner.id, busy: false, refreshing: false, drafts: { [owner.id]: { message: '手写草稿' }, [other.id]: { message: '其他工作区草稿' } } });
  session = createAiCommitSession(owner);
  disconnect = session.getState().connect();
});

afterEach(() => { disconnect(); setLanguage('zh-CN'); });

describe('AI 提交会话', () => {
  it('生成及编辑只修改候选，应用前再次核验，并保留其他工作区草稿', async () => {
    await session.getState().open();
    expect(session.getState()).toMatchObject({ phase: 'preview', candidate: result.message, validating: false });
    expect(draft()).toBe('手写草稿');
    expect(useWorkbench.getState().busy).toBe(false);
    session.getState().edit('fix(core): 人工修正文案');
    expect(draft()).toBe('手写草稿');
    expect(await session.getState().apply()).toBe(true);
    expect(draft()).toBe('fix(core): 人工修正文案');
    expect(useWorkbench.getState().drafts[other.id].message).toBe('其他工作区草稿');
    expect(session.getState().phase).toBe('closed');
    expect(mockedInvoke.mock.calls.filter(([command]) => command === 'ai_commit_validate')).toHaveLength(2);
    expect(mockedInvoke.mock.calls.every(([command]) => command.startsWith('ai_commit_'))).toBe(true);
    expect(mockedInvoke).toHaveBeenCalledWith('ai_commit_generate', { repoPath: owner.path, requestId: expect.any(String), language: 'zh-CN' });
  });

  it.each(['zh-CN', 'zh-TW', 'en'] as const)('%s 按当前界面语言发起生成', async language => {
    setLanguage(language);
    await session.getState().generate();
    expect(mockedInvoke).toHaveBeenCalledWith('ai_commit_generate', { repoPath: owner.path, requestId: expect.any(String), language });
    expect(session.getState().phase).toBe('preview');
    expect(draft()).toBe('手写草稿');
  });

  it('重新生成读取新语言，切换语言本身保留候选和手写草稿', async () => {
    await session.getState().generate();
    setLanguage('en');
    expect(session.getState().candidate).toBe(result.message);
    expect(draft()).toBe('手写草稿');
    await session.getState().generate();
    const requests = mockedInvoke.mock.calls.filter(([command]) => command === 'ai_commit_generate').map(([, args]) => args);
    expect(requests).toEqual([
      { repoPath: owner.path, requestId: expect.any(String), language: 'zh-CN' },
      { repoPath: owner.path, requestId: expect.any(String), language: 'en' },
    ]);
  });

  it('密钥检测结束后按实际开始生成时的界面语言请求', async () => {
    const pending = deferred<{ available: boolean }>();
    mockedInvoke.mockImplementation(command => command === 'ai_commit_check_key' ? pending.promise : reply(command));
    const opening = session.getState().open();
    setLanguage('zh-TW');
    pending.resolve({ available: true });
    await opening;
    expect(mockedInvoke).toHaveBeenCalledWith('ai_commit_generate', { repoPath: owner.path, requestId: expect.any(String), language: 'zh-TW' });
  });

  it('取消实际通知原生端，迟到结果不能恢复预览或覆盖草稿', async () => {
    const pending = deferred<AiCommitResult>();
    mockedInvoke.mockImplementation(command => command === 'ai_commit_generate' ? pending.promise : reply(command));
    const generating = session.getState().generate();
    const id = (mockedInvoke.mock.calls[0][1] as { requestId: string }).requestId;
    session.getState().close();
    expect(mockedInvoke).toHaveBeenCalledWith('ai_commit_cancel', { requestId: id });
    pending.resolve(result);
    await generating;
    expect(session.getState()).toMatchObject({ phase: 'closed', result: null, candidate: '' });
    expect(draft()).toBe('手写草稿');
    expect(mockedInvoke.mock.calls.some(([command]) => command === 'ai_commit_validate')).toBe(false);
  });

  it('每次生成使用新请求 ID，旧请求乱序成功或失败均不覆盖新结果', async () => {
    const first = deferred<AiCommitResult>();
    const second = deferred<AiCommitResult>();
    let calls = 0;
    mockedInvoke.mockImplementation(command => command === 'ai_commit_generate' ? (++calls === 1 ? first.promise : second.promise) : reply(command));
    const old = session.getState().generate();
    const latest = session.getState().generate();
    second.resolve({ ...result, message: 'feat: 新结果' });
    await latest;
    first.reject({ code: 'network', message: '不可显示的服务正文' });
    await old;
    expect(session.getState()).toMatchObject({ phase: 'preview', candidate: 'feat: 新结果', error: null });
    const ids = mockedInvoke.mock.calls.filter(([command]) => command === 'ai_commit_generate').map(([, args]) => (args as { requestId: string }).requestId);
    expect(new Set(ids).size).toBe(2);
    expect(mockedInvoke).toHaveBeenCalledWith('ai_commit_cancel', { requestId: ids[0] });
  });

  it.each(['worktree', 'branch', 'detached', 'unmount'] as const)('%s 切换取消在途请求，不能污染新上下文', async kind => {
    const pending = deferred<AiCommitResult>();
    mockedInvoke.mockImplementation(command => command === 'ai_commit_generate' ? pending.promise : reply(command));
    const generating = session.getState().generate();
    if (kind === 'worktree') useWorkbench.setState({ activeWorktreeId: other.id });
    else if (kind === 'unmount') disconnect();
    else replaceWorktree(kind === 'branch' ? { branch: 'feature/new' } : { detached: true });
    pending.resolve(result);
    await generating;
    expect(session.getState().phase).toBe('closed');
    expect(await session.getState().apply()).toBe(false);
    expect(draft()).toBe('手写草稿');
    expect(useWorkbench.getState().drafts[other.id].message).toBe('其他工作区草稿');
    expect(mockedInvoke.mock.calls.some(([command]) => command === 'ai_commit_cancel')).toBe(true);
  });

  it('同文件同数量的刷新也核验索引，失效候选禁止编辑及应用', async () => {
    await session.getState().generate();
    mockedInvoke.mockImplementation(command => command === 'ai_commit_validate' ? Promise.resolve(false) : reply(command));
    replaceWorktree();
    await vi.waitFor(() => expect(session.getState().phase).toBe('stale'));
    session.getState().edit('不允许编辑');
    expect(session.getState().candidate).toBe(result.message);
    expect(await session.getState().apply()).toBe(false);
    expect(draft()).toBe('手写草稿');
  });

  it('仅未暂存内容刷新且后端快照一致时保留可应用结果', async () => {
    await session.getState().generate();
    replaceWorktree();
    await vi.waitFor(() => expect(session.getState().validating).toBe(false));
    expect(session.getState().phase).toBe('preview');
    expect(await session.getState().apply()).toBe(true);
  });

  it('校验期间收到新刷新会再次核验，不按较早检查放行', async () => {
    await session.getState().generate();
    const pending = deferred<boolean>();
    let checks = 0;
    mockedInvoke.mockImplementation(command => command === 'ai_commit_validate' ? (++checks === 1 ? pending.promise : Promise.resolve(false)) : reply(command));
    const applying = session.getState().apply();
    replaceWorktree();
    pending.resolve(true);
    expect(await applying).toBe(false);
    expect(checks).toBe(2);
    expect(session.getState().phase).toBe('stale');
    expect(draft()).toBe('手写草稿');
  });

  it('无刷新事件时应用仍调用快照核验，捕获外部暂存变化', async () => {
    await session.getState().generate();
    mockedInvoke.mockImplementation(command => command === 'ai_commit_validate' ? Promise.resolve(false) : reply(command));
    expect(await session.getState().apply()).toBe(false);
    expect(session.getState().error).toBe('stale_snapshot');
    expect(draft()).toBe('手写草稿');
  });

  it('生成期间手写草稿变化，第一次应用只提示重新确认', async () => {
    await session.getState().generate();
    useWorkbench.getState().setDraft({ message: '刚写的新草稿' });
    expect(await session.getState().apply()).toBe(false);
    expect(draft()).toBe('刚写的新草稿');
    expect(session.getState().draftChanged).toBe(true);
    expect(await session.getState().apply()).toBe(true);
    expect(draft()).toBe(result.message);
  });

  it('应用校验期间新草稿或工作区切换都不会被旧回调覆盖', async () => {
    await session.getState().generate();
    const pending = deferred<boolean>();
    mockedInvoke.mockImplementation(command => command === 'ai_commit_validate' ? pending.promise : reply(command));
    const applying = session.getState().apply();
    useWorkbench.getState().setDraft({ message: '校验期间的新草稿' });
    pending.resolve(true);
    expect(await applying).toBe(false);
    expect(draft()).toBe('校验期间的新草稿');
    const next = deferred<boolean>();
    mockedInvoke.mockImplementation(command => command === 'ai_commit_validate' ? next.promise : reply(command));
    const applyingAgain = session.getState().apply();
    useWorkbench.setState({ activeWorktreeId: other.id });
    next.resolve(true);
    expect(await applyingAgain).toBe(false);
    expect(useWorkbench.getState().drafts[other.id].message).toBe('其他工作区草稿');
  });

  it('缺密钥重新检测成功只进入可生成状态，不自动发送付费请求', async () => {
    mockedInvoke.mockImplementation(command => command === 'ai_commit_check_key' ? Promise.resolve({ available: false }) : reply(command));
    await session.getState().open();
    expect(session.getState()).toMatchObject({ phase: 'error', error: 'missing_key' });
    expect(mockedInvoke).not.toHaveBeenCalledWith('ai_commit_generate', expect.anything());
    mockedInvoke.mockImplementation(reply);
    await session.getState().checkKey();
    expect(session.getState()).toMatchObject({ phase: 'ready', error: null });
    expect(mockedInvoke).not.toHaveBeenCalledWith('ai_commit_generate', expect.anything());
    await session.getState().generate();
    expect(session.getState().phase).toBe('preview');
  });

  it('关闭后迟到的密钥检测结果不能触发生成', async () => {
    const pending = deferred<{ available: boolean }>();
    mockedInvoke.mockImplementation(command => command === 'ai_commit_check_key' ? pending.promise : reply(command));
    const opening = session.getState().open();
    session.getState().close();
    pending.resolve({ available: true });
    await opening;
    expect(session.getState().phase).toBe('closed');
    expect(mockedInvoke).not.toHaveBeenCalledWith('ai_commit_generate', expect.anything());
  });

  it.each(['invalid_key', 'insufficient_balance', 'rate_limited', 'timeout', 'network', 'invalid_response', 'input_too_large', 'skill', 'commit_rules_violation', 'commit_rules_unsupported'])('%s 失败可显式重试，草稿始终保留', async code => {
    mockedInvoke.mockImplementation(command => command === 'ai_commit_generate' ? Promise.reject({ code, message: '不可显示的上游正文' }) : reply(command));
    await session.getState().generate();
    expect(session.getState()).toMatchObject({ phase: 'error', error: code });
    expect(JSON.stringify(session.getState())).not.toContain('不可显示');
    expect(draft()).toBe('手写草稿');
    mockedInvoke.mockImplementation(reply);
    await session.getState().generate();
    expect(session.getState().phase).toBe('preview');
  });

  it('空响应视为失败，用户清空有效候选后也禁止应用', async () => {
    mockedInvoke.mockImplementation(command => command === 'ai_commit_generate' ? Promise.resolve({ ...result, message: ' \n ' }) : reply(command));
    await session.getState().generate();
    expect(session.getState()).toMatchObject({ phase: 'error', error: 'invalid_response' });
    mockedInvoke.mockImplementation(reply);
    await session.getState().generate();
    session.getState().edit(' \n ');
    expect(await session.getState().apply()).toBe(false);
    expect(draft()).toBe('手写草稿');
  });

  it('首次提交允许生成，演示、空暂存、特殊操作和冲突禁止生成', async () => {
    expect(aiCommitBlockReason({ ...owner, hasHead: false })).toBeNull();
    for (const patch of [
      { source: undefined }, { files: [] }, { available: false }, { bare: true },
      { operation: { kind: 'merge' as const, head: 'head', mergeHeads: ['merge'], message: 'merge', source: null } },
      { files: [{ ...owner.files[0], git: { ...owner.files[0].git!, conflicted: true } }] },
    ]) {
      expect(aiCommitBlockReason({ ...owner, ...patch })).not.toBeNull();
      replaceWorktree(patch);
      await session.getState().generate();
    }
    expect(mockedInvoke).not.toHaveBeenCalledWith('ai_commit_generate', expect.anything());
  });

  it('未知错误不会显示原始正文或原型属性', () => {
    expect(aiCommitErrorCode(new Error('secret'))).toBe('internal');
    expect(aiCommitErrorCode({ code: 'toString', message: 'secret' })).toBe('internal');
  });
});
