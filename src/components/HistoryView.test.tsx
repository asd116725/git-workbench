import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeDiffProps } from './CodeDiff';
import { HistoryView } from './HistoryView';
import type { HistoryCommitDetail, HistoryCommitSummary, HistorySession } from '../lib/history-types';
import type { FileSnapshot, Worktree } from '../lib/types';

const hooks = vi.hoisted(() => ({ history: vi.fn(), preferences: vi.fn(), workbench: vi.fn() }));
vi.mock('../lib/history-store', () => ({ useHistory: Object.assign(hooks.history, { getState: () => hooks.history() }) }));
vi.mock('../lib/store', () => ({ usePreferences: hooks.preferences, useWorkbench: hooks.workbench }));
vi.mock('./CodeDiff', () => ({
  CodeDiff: ({ file, mode, fontSize, originalLabel, modifiedLabel, onStageHunk }: CodeDiffProps) => <section data-testid="history-code-diff" data-mode={mode} data-font-size={fontSize} data-stage-action={Boolean(onStageHunk)}><span>{originalLabel}</span><span>{modifiedLabel}</span><pre>{file?.index}</pre></section>,
}));

const worktree: Worktree = { id: 'native:/history-test', name: 'history-test', branch: 'main', path: '/history-test', source: 'native', commits: [], files: [] };
const commit: HistoryCommitSummary = { oid: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 'feat: 添加预览', authorName: 'Lin', authorEmail: 'lin@example.com', committedAt: 1_700_000_000, parents: ['b'.repeat(40)] };
const file: FileSnapshot = { id: 'src/preview.ts', path: 'src/preview.ts', language: 'typescript', head: 'before', index: 'after', working: null, git: { statusIndex: 'M', statusWorktree: ' ', originalPath: null, conflicted: false } };
const detail: HistoryCommitDetail = { commit, message: `${commit.subject}\n\n支持完整预览说明`, parentOid: commit.parents[0], parentIndex: 0, files: [{ path: file.path, oldPath: null, status: 'M', oldMode: '100644', newMode: '100644' }] };

function session(patch: Partial<HistorySession> = {}): HistorySession {
  return {
    initialized: true, reference: null, query: '', searchInput: '', snapshot: commit.oid, commits: [commit], nextCursor: null,
    selectedOid: commit.oid, parentIndex: 0, selectedPath: file.path, detail,
    diff: { file, notice: null, error: null, loading: false }, loading: false, loadingMore: false,
    detailLoading: false, error: null, detailError: null, updated: false, checkError: null, ...patch,
  };
}

function renderHistory(current: HistorySession, target = worktree) {
  const state = { sessions: { [target.id]: current }, ensure: vi.fn(), setQuery: vi.fn(), setSearchInput: vi.fn() };
  hooks.history.mockImplementation(selector => selector ? selector(state) : state);
  return renderToStaticMarkup(<HistoryView worktree={target} />);
}

beforeEach(() => {
  hooks.preferences.mockReturnValue({ fontSize: 17, diffMode: 'split', historyDiffMode: 'inline', layout: {}, setLayout: vi.fn(), setHistoryDiffMode: vi.fn() });
  hooks.workbench.mockImplementation(selector => selector({ repositories: [] }));
});

describe('提交历史三栏展示', () => {
  it('展示提交、文件树与只读 Diff，沿用全局字号及独立历史模式', () => {
    const html = renderHistory(session());
    expect(html).toContain('aria-label="提交列表"');
    expect(html).toContain('aria-label="历史变更文件"');
    expect(html).toContain('aria-label="历史差异"');
    expect(html).toContain('aria-label="历史文件：src/preview.ts"');
    expect(html).toContain('支持完整预览说明');
    expect(html).toContain(`aria-label="复制完整 Hash ${commit.oid}"`);
    expect(html).toContain('历史只读');
    expect(html).toContain('data-mode="inline" data-font-size="17" data-stage-action="false"');
    expect(html).not.toContain('暂存');
    expect(html).not.toContain('commit-composer');
  });

  it('仅合并提交显示父提交选择，比较标签与选中的父提交一致', () => {
    const parents = ['b'.repeat(40), 'c'.repeat(40)];
    const merged = { ...commit, parents };
    const html = renderHistory(session({ commits: [merged], parentIndex: 1, detail: { ...detail, commit: merged, parentIndex: 1, parentOid: parents[1] } }));
    expect(html).toContain('aria-label="比较父提交"');
    expect(html).toContain('父提交 1 · bbbbbbb');
    expect(html).toContain('<option value="1" selected="">父提交 2 · ccccccc</option>');
    expect(html).toContain('<span>父提交 2 · ccccccc</span>');
    expect(renderHistory(session())).not.toContain('aria-label="比较父提交"');
  });

  it('首次提交标注空版本；分离 HEAD 的筛选器保留当前 HEAD', () => {
    const root = { ...commit, parents: [] };
    const html = renderHistory(session({ commits: [root], detail: { ...detail, commit: root, parentOid: null } }), { ...worktree, detached: true });
    expect(html).toContain('空版本（首次提交）');
    expect(html).toContain('当前 HEAD');
    expect(html).toContain('只筛选提交历史，不切换工作区分支');
  });

  it('重命名和文件模式变化显示原路径及权限信息', () => {
    const html = renderHistory(session({ detail: { ...detail, files: [{ ...detail.files[0], oldPath: 'old/preview.ts', status: 'R', oldMode: '100644', newMode: '100755' }] } }));
    expect(html).toContain('old/preview.ts → src/preview.ts');
    expect(html).toContain('文件模式 100644 → 100755');
  });
});

describe('提交历史加载、空态与错误', () => {
  it('无匹配记录与尚无提交分别提供明确空态', () => {
    const empty = session({ commits: [], selectedOid: null, selectedPath: null, detail: null, diff: { file: null, notice: null, error: null, loading: false } });
    expect(renderHistory(empty)).toContain('此分支还没有提交记录');
    expect(renderHistory({ ...empty, query: '尚未匹配' })).toContain('没有匹配的提交');
  });

  it('空提交明确说明没有文件变化，避免使用本地更改提示', () => {
    const html = renderHistory(session({ detail: { ...detail, files: [] }, selectedPath: null, diff: { file: null, notice: null, error: null, loading: false } }));
    expect(html).toContain('此提交相对此父提交没有文件变更');
    expect(html).toContain('此提交没有文件变更');
    expect(html).not.toContain('未暂存');
  });

  it('刷新更新和检查失败保留已显示 Diff，并分别提供入口', () => {
    const html = renderHistory(session({ updated: true, checkError: '该分支已删除' }));
    expect(html).toContain('历史已更新，刷新查看');
    expect(html).toContain('刷新历史');
    expect(html).toContain('该分支已删除');
    expect(html).toContain('重试检查');
    expect(html).toContain('data-testid="history-code-diff"');
  });

  it('列表读取失败保留已有记录和 Diff，提供重试而不清空列表', () => {
    const html = renderHistory(session({ error: '历史读取失败' }));
    expect(html).toContain('历史读取失败');
    expect(html).toContain('重试历史');
    expect(html).toContain(`aria-label="查看提交：${commit.subject}"`);
    expect(html).toContain('data-testid="history-code-diff"');
  });

  it('详情或正文读取失败分别提供重试操作', () => {
    expect(renderHistory(session({ detailError: '提交对象不可用' }))).toContain('重试提交');
    const html = renderHistory(session({ diff: { file: null, loading: false, notice: null, error: '正文读取失败' } }));
    expect(html).toContain('正文读取失败');
    expect(html).toContain('重试差异');
    expect(html).not.toContain('data-testid="history-code-diff"');
  });

  it('二进制等不可展示文件只显示原因，不伪造空文本 Diff', () => {
    const html = renderHistory(session({ diff: { file: null, loading: false, error: null, notice: '二进制文件无法显示文本差异' } }));
    expect(html).toContain('二进制文件无法显示文本差异');
    expect(html).not.toContain('data-testid="history-code-diff"');
  });

  it('有下一页时显示加载更多，加载期间禁用防止重复请求', () => {
    const idle = renderHistory(session({ nextCursor: 'next-page' }));
    expect(idle).toContain('加载更多提交');
    const pending = renderHistory(session({ nextCursor: 'next-page', loadingMore: true }));
    expect(pending).toMatch(/class="[^"]*history-load-more[^"]*"[^>]*disabled=""/);
    expect(pending).toContain('正在加载…');
  });
});
