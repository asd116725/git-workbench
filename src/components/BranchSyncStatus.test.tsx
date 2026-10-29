import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { BranchSyncCounts, BranchSyncStatus } from './BranchSyncStatus';
import { worktreeSyncDescription } from './branch-display';
import { setLanguage } from '../lib/i18n';
import type { GitBranch, Worktree } from '../lib/types';

const worktree: Worktree = { id: 'demo', name: 'demo', branch: '功能/{branch}', path: '/工作区', files: [], commits: [], branchSync: { upstream: 'refs/remotes/origin/功能/{branch}', ahead: 3, behind: 0 } };
afterEach(() => setLanguage('zh-CN'));

describe('侧栏共享分支计数', () => {
  it.each([
    ['zh-CN', '待拉取 0 个提交，待推送 3 个提交'],
    ['zh-TW', '待拉取 0 個提交，待推送 3 個提交'],
    ['en', 'commits to pull: 0; commits to push: 3'],
  ] as const)('%s 说明保留原始上游且与分支选择器方向一致', (language, expected) => {
    setLanguage(language);
    expect(worktreeSyncDescription(worktree)).toContain(expected);
    expect(worktreeSyncDescription({ ...worktree, hasHead: false })).toContain(expected);
    expect(worktreeSyncDescription(worktree)).toContain(worktree.branchSync!.upstream);
    const html = renderToStaticMarkup(<BranchSyncCounts sync={worktree.branchSync} />);
    expect(html).toContain('codicon-arrow-down"></i>0');
    expect(html).toContain('codicon-arrow-up"></i>3');
  });

  it('同步、无上游和未知均隐藏计数，但说明区分状态', () => {
    const synced = { ...worktree.branchSync!, ahead: 0, behind: 0 };
    const missing = { ...synced, upstream: null };
    for (const sync of [null, undefined, synced, missing, { ...synced, ahead: null }]) {
      expect(renderToStaticMarkup(<BranchSyncCounts sync={sync} />)).toBe('');
    }
    expect(worktreeSyncDescription({ ...worktree, branchSync: synced })).toContain('已与上游');
    expect(worktreeSyncDescription({ ...worktree, branchSync: missing })).toBe('未设置上游分支。');
    expect(worktreeSyncDescription({ ...worktree, branchSync: null })).toContain('尚未获得');
    for (const patch of [{ detached: true }, { bare: true }, { available: false }]) {
      expect(worktreeSyncDescription({ ...worktree, ...patch })).toBeNull();
    }
  });

  it('侧栏与选择器同时展示同名分支不会生成重复说明ID', () => {
    const branch: GitBranch = { ...worktree.branchSync!, fullName: 'refs/heads/main', name: 'main', kind: 'local', current: true, worktreePath: '/工作区', localName: null, lastCommit: { author: 'A', shortHash: '1234567', subject: 'demo', committedAt: 1 } };
    const html = renderToStaticMarkup(<><BranchSyncCounts sync={branch} /><BranchSyncStatus branch={branch} /></>);
    expect(html.match(/id="branch-sync-refs\/heads\/main"/g)).toHaveLength(1);
  });
});
