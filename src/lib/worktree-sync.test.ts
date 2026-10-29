import { describe, expect, it } from 'vitest';
import { toRepository, type NativeRepository, type NativeWorktree } from './native-git';

const main: NativeWorktree = { path: '/repo', name: '主工作区', branch: 'main', isMain: true, detached: false, bare: false, locked: null, prunable: null, available: true, branchSync: { upstream: 'refs/remotes/origin/main', ahead: 0, behind: 3 } };
const linked: NativeWorktree = { ...main, path: '/linked', name: 'linked', branch: 'feature', isMain: false, branchSync: { upstream: 'refs/remotes/team/review', ahead: 4, behind: 0 } };
const source: NativeRepository = { path: '/repo', name: 'repo', commonDir: '/repo/.git', repositoryName: 'repo', worktrees: [main, linked], branch: 'main', hasHead: true, operation: null, files: [], remote: { remotes: ['origin'], upstream: 'refs/remotes/origin/main', upstreamRemote: 'origin', upstreamBranch: 'main', defaultRemote: 'origin', ahead: 0, behind: 3 } };

describe('原生工作区同步快照', () => {
  it('兄弟目录使用各自上游，不复制当前分支数字', () => {
    expect(toRepository(source).worktrees.map(item => item.branchSync)).toEqual([main.branchSync, linked.branchSync]);
  });
  it.each([null, undefined])('新元数据缺少同步信息时清除兄弟旧快照，保留已加载文件', branchSync => {
    const previous = toRepository(source);
    previous.worktrees[1].files = [{ id: 'draft.ts', path: 'draft.ts', language: 'typescript', head: '', index: '', working: 'draft' }];
    const next = toRepository({ ...source, worktrees: [main, { ...linked, branch: 'other', branchSync }] }, previous);
    expect(next.worktrees[1]).toMatchObject({ branch: 'other', branchSync: null });
    expect(next.worktrees[1].files).toBe(previous.worktrees[1].files);
  });
  it('当前工作区分支读取期间变化时不使用另一分支的计数', () => {
    expect(toRepository({ ...source, branch: 'new-branch' }).worktrees[0].branchSync).toBeNull();
  });
  it('兄弟目录旧的无提交缓存不遮蔽新的权威同步快照', () => {
    const previous = toRepository(source);
    previous.worktrees[1].hasHead = false;
    previous.worktrees[1].branchSync = null;
    expect(toRepository(source, previous).worktrees[1].branchSync).toEqual(linked.branchSync);
  });
});
