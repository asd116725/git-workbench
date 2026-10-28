import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { GitBranch, GitDeleteBranchPreview, Worktree } from '../lib/types';
import { BranchCreateForm, BranchDeleteConfirmation } from './BranchForms';
import { BranchPickerDialog } from './BranchPickerDialog';
import { setLanguage } from '../lib/i18n';
import { branchLabel, worktreeLabel } from './branch-display';

const hooks = vi.hoisted(() => ({ workbench: vi.fn() }));
vi.mock('../lib/store', () => ({ useWorkbench: hooks.workbench }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children, className }: { children: ReactNode; className: string }) => <div className={className}>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

const worktree: Worktree = { id: 'current', name: 'demo-editor', branch: 'feature/markdown', path: '/test/current', source: 'native', hasHead: true, files: [], commits: [] };
function branch(name: string, patch: Partial<GitBranch> = {}): GitBranch {
  return { fullName: `refs/heads/${name}`, name, kind: 'local', current: false, worktreePath: null, upstream: null, localName: null, lastCommit: { author: 'Demo User', shortHash: 'abc1234', subject: '分支提交说明', committedAt: 1_700_000_000 }, ...patch };
}
const branches: GitBranch[] = [
  branch('feature/markdown', { current: true, worktreePath: worktree.path }),
  branch('feature/search'),
  branch('feature/preview', { worktreePath: '/test/preview' }),
  branch('origin/main', { fullName: 'refs/remotes/origin/main', kind: 'remote', localName: 'main' }),
];
const preview: GitDeleteBranchPreview = { targetRef: 'refs/heads/feature/search', targetName: 'feature/search', targetOid: 'a'.repeat(40), headRef: 'refs/heads/feature/markdown', headOid: 'b'.repeat(40), headName: 'feature/markdown', unmergedCommits: 2 };

function deleteButton(html: string, label: string) {
  return html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0];
}

beforeEach(() => {
  hooks.workbench.mockReturnValue({ branches: { items: branches, loading: false, error: null }, busy: false, loadBranches: vi.fn() });
});

afterEach(() => setLanguage('zh-CN'));

describe('分支管理入口和分支保护', () => {
  it('只按元数据翻译生成的工作区和分离HEAD标签', () => {
    setLanguage('en');
    expect(worktreeLabel({ ...worktree, name: '主工作区', isMain: true })).toBe('Main worktree');
    expect(worktreeLabel({ ...worktree, source: undefined, name: '主工作区', isMain: true })).toBe('Main worktree');
    expect(worktreeLabel({ ...worktree, name: '主工作区', isMain: false })).toBe('主工作区');
    expect(branchLabel({ ...worktree, branch: '分离 HEAD · abc1234', detached: true })).toBe('Detached HEAD · abc1234');
    expect(branchLabel({ ...worktree, branch: '分离 HEAD · abc1234', detached: false })).toBe('分离 HEAD · abc1234');
  });

  it.each([['en', 'Branch management', 'New branch'], ['zh-TW', '分支管理', '新增分支']] as const)('%s 翻译分支操作且保留提交和分支原文', (language, title, action) => {
    setLanguage(language);
    const html = renderToStaticMarkup(<BranchPickerDialog worktree={worktree} open onOpenChange={vi.fn()} />);
    expect(html).toContain(title);
    expect(html).toContain(action);
    expect(html).toContain('feature/markdown');
    expect(html).toContain('Demo User · abc1234 · 分支提交说明');
  });

  it('展示管理入口、提交摘要，当前和其他 worktree 使用中的分支不可删除', () => {
    const html = renderToStaticMarkup(<BranchPickerDialog worktree={worktree} open onOpenChange={vi.fn()} />);
    expect(html).toContain('分支管理');
    expect(html).toContain('新建分支');
    expect(html).toContain('Demo User · abc1234 · 分支提交说明');
    expect(deleteButton(html, '删除本地分支 feature/markdown')).toContain(' disabled=""');
    expect(deleteButton(html, '删除本地分支 feature/preview')).toContain(' disabled=""');
    expect(deleteButton(html, '删除本地分支 feature/search')).not.toContain(' disabled=""');
    expect(deleteButton(html, '删除本地分支 origin/main')).toBeUndefined();
    let buttonDepth = 0;
    for (const tag of html.matchAll(/<\/?button\b[^>]*>/g)) {
      buttonDepth += tag[0].startsWith('</') ? -1 : 1;
      expect(buttonDepth).toBeLessThanOrEqual(1);
    }
    expect(buttonDepth).toBe(0);
  });

  it('未完成操作仍可浏览分支，但展示阻止说明且禁用写操作', () => {
    const target: Worktree = { ...worktree, operation: { kind: 'merge', head: 'a', mergeHeads: ['b'], message: 'Merge branch', source: 'feature/search' } };
    const html = renderToStaticMarkup(<BranchPickerDialog worktree={target} open onOpenChange={vi.fn()} />);
    expect(html).toContain('请先完成或中止当前 Git 操作');
    expect(deleteButton(html, '删除本地分支 feature/search')).toContain(' disabled=""');
    expect(deleteButton(html, '切换到 feature/search')).toContain(' disabled=""');
  });

  it('浏览器演示明确标注，空仓库显示需要首次提交', () => {
    expect(renderToStaticMarkup(<BranchPickerDialog worktree={{ ...worktree, source: undefined }} open onOpenChange={vi.fn()} />)).toContain('演示模式 · 模拟数据');
    hooks.workbench.mockReturnValue({ branches: { items: [], loading: false, error: null }, busy: false, loadBranches: vi.fn() });
    const html = renderToStaticMarkup(<BranchPickerDialog worktree={{ ...worktree, hasHead: false }} open onOpenChange={vi.fn()} />);
    expect(html).toContain('没有可用起点，请先完成首次提交。');
  });
});

describe('创建与删除确认表单', () => {
  function creation(patch: Partial<Parameters<typeof BranchCreateForm>[0]> = {}) {
    return renderToStaticMarkup(<BranchCreateForm branches={branches} hasHead name="feature/history-filter" startRef="refs/heads/feature/markdown" checkout locked={false} blocked={null} onNameChange={vi.fn()} onStartChange={vi.fn()} onCheckoutChange={vi.fn()} onSubmit={vi.fn()} onCancel={vi.fn()} {...patch} />);
  }
  function deletion(patch: Partial<Parameters<typeof BranchDeleteConfirmation>[0]> = {}) {
    return renderToStaticMarkup(<BranchDeleteConfirmation preview={preview} confirmed={false} locked={false} blocked={null} onConfirmedChange={vi.fn()} onDelete={vi.fn()} onCancel={vi.fn()} {...patch} />);
  }

  it('创建起点含当前提交、本地和远程分支，并展示远程跟踪说明', () => {
    const html = creation();
    expect(html).toContain('value="refs/heads/feature/markdown" selected');
    expect(html).toContain('value="HEAD"');
    expect(html).toContain('value="refs/remotes/origin/main"');
    expect(html).toContain('远程起点会建立上游跟踪关系');
    expect(html).toContain('创建并切换');
    expect(creation({ checkout: false })).toContain('>创建分支</button>');
  });

  it('缺少名称、起点或操作中时不能提交创建', () => {
    for (const patch of [{ name: ' ' }, { startRef: '' }, { locked: true }, { blocked: '正在合并' }]) {
      const html = creation(patch);
      expect(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).toContain(' disabled=""');
    }
  });

  it('未合入当前 HEAD 的提交显示数量，强制删除必须勾选确认', () => {
    expect(deletion()).toContain('2 个提交尚未合入 feature/markdown');
    expect(deletion()).toContain('我了解风险，仍要强制删除此分支');
    expect(deletion()).toMatch(/<button[^>]*disabled=""[^>]*>强制删除<\/button>/);
    expect(deletion({ confirmed: true })).not.toMatch(/<button[^>]*disabled=""[^>]*>强制删除<\/button>/);
    expect(deletion({ confirmed: true, blocked: '正在合并' })).toMatch(/<button[^>]*disabled=""[^>]*>强制删除<\/button>/);
  });

  it('已合入分支仅普通确认，不要求无意义的强制删除授权', () => {
    const html = deletion({ preview: { ...preview, unmergedCommits: 0 } });
    expect(html).toContain('所有提交均已包含在 feature/markdown 中');
    expect(html).toContain('>删除分支</button>');
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('只删除本地分支，远程分支不受影响。');
  });

  it.each([['en', 'Current HEAD'], ['zh-TW', '目前 HEAD']] as const)('%s 翻译分离 HEAD 标签，保留同名真实分支', (language, label) => {
    setLanguage(language);
    const headName = '当前 HEAD · bbbbbbb';
    expect(deletion({ preview: { ...preview, headRef: null, headName } })).toContain(`${label} · bbbbbbb`);
    expect(deletion({ preview: { ...preview, headRef: `refs/heads/${headName}`, headName } })).toContain(headName);
  });
});
