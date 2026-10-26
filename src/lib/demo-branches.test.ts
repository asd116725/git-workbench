import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoRepositories } from './demo-data';
import { createDemoBranch, createDemoBranchState, deleteDemoBranch, listDemoBranches, previewDemoBranchDeletion, recordDemoBranchCommit, switchDemoBranch } from './demo-branches';
import type { DemoBranchState } from './demo-branches';
import type { Repository, Worktree } from './types';

let repository: Repository;
let worktree: Worktree;
let state: DemoBranchState;

beforeEach(() => {
  repository = createDemoRepositories()[0];
  worktree = repository.worktrees[0];
  state = createDemoBranchState(repository);
});

describe('浏览器演示分支列表', () => {
  it('展示最近提交顺序、当前分支和所有工作区占用', () => {
    const branches = listDemoBranches(state, worktree);
    expect(branches[0].name).toBe('feature/search');
    expect(branches.find(branch => branch.name === 'feature/markdown')).toMatchObject({ current: true, worktreePath: worktree.path });
    expect(branches.find(branch => branch.name === 'feature/preview')).toMatchObject({ current: false, worktreePath: repository.worktrees[1].path });
    expect(branches.find(branch => branch.name === 'origin/main')).toMatchObject({ kind: 'remote', localName: 'main' });
  });

  it('独立初始化，不继承此前演示的删除', () => {
    const removed = deleteDemoBranch(state, worktree, previewDemoBranchDeletion(state, worktree, 'refs/heads/main'), false);
    expect(removed.state.branches['refs/heads/main']).toBeUndefined();
    expect(state.branches['refs/heads/main']).toBeDefined();
    expect(createDemoBranchState(repository).branches['refs/heads/main']).toBeDefined();
  });
});

describe('浏览器演示创建分支', () => {
  it('从当前提交创建并切换，保留工作文件', () => {
    const files = worktree.files;
    const created = createDemoBranch(state, worktree, 'feature/history-filter', 'HEAD', true);
    expect(created.result).toEqual({ branch: 'feature/history-filter', switched: true, warning: null });
    expect(created.state.worktrees[0].branch).toBe('feature/history-filter');
    expect(created.state.branches['refs/heads/feature/history-filter'].commits).toEqual(state.branches['refs/heads/feature/markdown'].commits);
    expect(worktree.files).toBe(files);
    expect(state.branches['refs/heads/feature/history-filter']).toBeUndefined();
  });

  it('仅创建远程起点的本地分支，建立跟踪并保持当前工作区', () => {
    const created = createDemoBranch(state, worktree, 'feature/remote', 'refs/remotes/origin/main', false);
    expect(created.result.switched).toBe(false);
    expect(created.state.worktrees[0].branch).toBe(worktree.branch);
    expect(created.state.branches['refs/heads/feature/remote'].upstream).toBe('refs/remotes/origin/main');
    const local = createDemoBranch(created.state, worktree, 'feature/local', 'refs/heads/feature/remote', false);
    expect(local.state.branches['refs/heads/feature/local'].upstream).toBeNull();
  });

  it('支持分离 HEAD，拒绝没有可用起点的创建', () => {
    const detached = { ...worktree, detached: true, branch: '分离 HEAD' };
    expect(createDemoBranch(state, detached, 'feature/detached', 'HEAD', true).result.switched).toBe(true);
    expect(() => createDemoBranch(state, { ...worktree, hasHead: false }, 'feature/unborn', 'HEAD', false)).toThrow('首次提交');
    expect(() => createDemoBranch(state, worktree, 'feature/missing', 'refs/heads/missing', false)).toThrow('起点分支已不存在');
  });

  it.each(['', 'HEAD', '-branch', 'feature bad', 'bad..branch', 'a@{1}', '.hidden', 'feature/.hidden', 'name.lock', 'a//b', 'a/', 'a.', 'a\\b'])('拒绝非法名称 %s', name => {
    expect(() => createDemoBranch(state, worktree, name, 'HEAD', false)).toThrow('名称不合法');
  });

  it('拒绝重名及前缀路径冲突', () => {
    expect(() => createDemoBranch(state, worktree, 'main', 'HEAD', false)).toThrow('已存在');
    expect(() => createDemoBranch(state, worktree, 'feature', 'HEAD', false)).toThrow('目录层级冲突');
    expect(() => createDemoBranch(state, worktree, 'main/child', 'HEAD', false)).toThrow('目录层级冲突');
  });
});

describe('浏览器演示删除保护', () => {
  it('普通删除已合入分支，未合入两条提交必须明确强制删除', () => {
    const merged = previewDemoBranchDeletion(state, worktree, 'refs/heads/main');
    expect(merged.unmergedCommits).toBe(0);
    expect(deleteDemoBranch(state, worktree, merged, false).state.branches['refs/heads/main']).toBeUndefined();
    const unmerged = previewDemoBranchDeletion(state, worktree, 'refs/heads/feature/search');
    expect(unmerged.unmergedCommits).toBe(2);
    expect(() => deleteDemoBranch(state, worktree, unmerged, false)).toThrow('确认风险');
    expect(deleteDemoBranch(state, worktree, unmerged, true).state.branches['refs/heads/feature/search']).toBeUndefined();
  });

  it('禁止当前分支、其他工作区占用和远程分支删除', () => {
    expect(() => previewDemoBranchDeletion(state, worktree, 'refs/heads/feature/markdown')).toThrow('当前分支');
    expect(() => previewDemoBranchDeletion(state, worktree, 'refs/heads/feature/preview')).toThrow('其他工作区');
    expect(() => previewDemoBranchDeletion(state, worktree, 'refs/remotes/origin/main')).toThrow('本地分支');
  });

  it('目标移动或当前 HEAD 切换后要求重新确认', () => {
    const preview = previewDemoBranchDeletion(state, worktree, 'refs/heads/feature/search');
    const moved = { ...state, branches: { ...state.branches, [preview.targetRef]: { ...state.branches[preview.targetRef], commits: ['changed', ...state.branches[preview.targetRef].commits] } } };
    expect(() => deleteDemoBranch(moved, worktree, preview, true)).toThrow('重新预览');
    const switched = switchDemoBranch(state, worktree, 'refs/heads/main');
    expect(() => deleteDemoBranch(switched.state, { ...worktree, branch: 'main' }, preview, true)).toThrow('重新预览');
  });

  it('重新核验未合入数量，不接受修改后的授权数据', () => {
    const preview = previewDemoBranchDeletion(state, worktree, 'refs/heads/feature/search');
    expect(() => deleteDemoBranch(state, worktree, { ...preview, unmergedCommits: 0 }, false)).toThrow('重新预览');
  });
});

describe('浏览器演示切换', () => {
  it('切换释放旧分支占用，并更新其他工作区看到的状态', () => {
    const switched = switchDemoBranch(state, worktree, 'refs/heads/main');
    expect(switched.result.branch).toBe('main');
    const sibling = repository.worktrees[1];
    expect(listDemoBranches(switched.state, sibling).find(branch => branch.name === 'main')?.worktreePath).toBe(worktree.path);
    expect(listDemoBranches(switched.state, sibling).find(branch => branch.name === 'feature/markdown')?.worktreePath).toBeNull();
  });

  it('远程切换在没有同名本地分支时创建跟踪分支', () => {
    const removed = deleteDemoBranch(state, worktree, previewDemoBranchDeletion(state, worktree, 'refs/heads/main'), false);
    const switched = switchDemoBranch(removed.state, worktree, 'refs/remotes/origin/main');
    expect(switched.result.branch).toBe('main');
    expect(switched.state.branches['refs/heads/main'].upstream).toBe('refs/remotes/origin/main');
  });

  it('未完成 Git 操作阻止所有分支写入', () => {
    const merging: Worktree = { ...worktree, operation: { kind: 'merge', head: 'head', mergeHeads: ['incoming'], message: 'merge', source: 'feature' } };
    expect(() => createDemoBranch(state, merging, 'feature/new', 'HEAD', false)).toThrow('完成或中止');
    expect(() => previewDemoBranchDeletion(state, merging, 'refs/heads/main')).toThrow('完成或中止');
    expect(() => switchDemoBranch(state, merging, 'refs/heads/main')).toThrow('完成或中止');
  });
});

describe('演示提交推进分支引用', () => {
  it('新提交更新列表和后续创建的起点，旧删除预览失效', () => {
    const preview = previewDemoBranchDeletion(state, worktree, 'refs/heads/feature/search');
    const commit = { ...worktree.commits[0], id: 'abc12345', message: 'feat: 演示新提交', date: '2026-10-26T10:00:00+08:00' };
    const committed = { ...worktree, commits: [commit, ...worktree.commits] };
    const updated = recordDemoBranchCommit(state, committed);
    expect(listDemoBranches(updated, committed).find(branch => branch.current)?.lastCommit).toMatchObject({ shortHash: 'abc1234', subject: commit.message });
    const created = createDemoBranch(updated, committed, 'feature/new-head', 'HEAD', false);
    expect(created.state.branches['refs/heads/feature/new-head'].commits[0]).toBe(commit.id.padEnd(40, '0'));
    expect(() => deleteDemoBranch(updated, committed, preview, true)).toThrow('重新预览');
    expect(recordDemoBranchCommit(updated, committed)).toBe(updated);
  });

  it('切换后提交沿用目标分支祖先，不混入工作区旧提交集合', () => {
    const switched = switchDemoBranch(state, worktree, 'refs/heads/main');
    const commit = { ...worktree.commits[0], id: 'abc12345', message: 'fix: main 新提交' };
    const committed = { ...worktree, branch: 'main', commits: [commit, ...worktree.commits] };
    const updated = recordDemoBranchCommit(switched.state, committed);
    expect(updated.branches['refs/heads/main'].commits).toEqual([commit.id.padEnd(40, '0'), ...state.branches['refs/heads/main'].commits]);
    expect(updated.branches['refs/heads/feature/markdown']).toBe(state.branches['refs/heads/feature/markdown']);
    expect(updated.branches['refs/remotes/origin/main']).toBe(state.branches['refs/remotes/origin/main']);
  });

  it('分离 HEAD 提交不移动任何命名分支', () => {
    const detached = { ...worktree, detached: true, commits: [{ ...worktree.commits[0], id: 'abc12345' }, ...worktree.commits] };
    expect(recordDemoBranchCommit(state, detached)).toBe(state);
  });
});
