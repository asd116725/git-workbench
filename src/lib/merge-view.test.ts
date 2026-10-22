import { describe, expect, it } from 'vitest';
import { commitBlockReason, mergeStartBlockReason } from './merge-view';
import type { FileSnapshot, Worktree } from './types';

const worktree: Worktree = {
  id: 'repo', path: '/test/repo', name: 'repo', branch: 'main', source: 'native',
  hasHead: true, files: [], commits: [],
};
const merging: Worktree = { ...worktree, operation: { kind: 'merge', head: 'head', mergeHeads: ['source'], source: 'feature', message: 'Merge', } };
const file: FileSnapshot = {
  id: 'file', path: 'file', language: 'plaintext', head: null, index: null, working: null,
  git: { statusIndex: 'M', statusWorktree: ' ', originalPath: null, conflicted: false },
};

describe('合并操作的界面入口', () => {
  it('允许干净的当前分支，禁止脏工作区、分离 HEAD、未完成操作及无提交分支', () => {
    expect(mergeStartBlockReason(worktree)).toBeNull();
    expect(mergeStartBlockReason({ ...worktree, files: [file] })).toContain('干净');
    expect(mergeStartBlockReason({ ...worktree, detached: true })).toContain('本地分支');
    expect(mergeStartBlockReason(merging)).toContain('当前合并');
    expect(mergeStartBlockReason({ ...worktree, hasHead: false })).toContain('尚无提交');
  });

  it('允许无文件差异的合并提交，普通提交仍要求已暂存文件', () => {
    expect(commitBlockReason(merging, 'Merge')).toBeNull();
    expect(commitBlockReason(worktree, 'Commit')).toContain('暂存');
    expect(commitBlockReason(merging, '  ')).toContain('填写');
  });

  it('阻止冲突和未暂存的解决内容，不将新建未跟踪文件偷偷加入合并', () => {
    expect(commitBlockReason({ ...merging, files: [{ ...file, git: { ...file.git!, conflicted: true } }] }, 'Merge')).toContain('解决冲突');
    expect(commitBlockReason({ ...merging, files: [{ ...file, git: { ...file.git!, statusWorktree: 'M' } }] }, 'Merge')).toContain('修改未暂存');
    expect(commitBlockReason({ ...merging, files: [{ ...file, git: { ...file.git!, statusIndex: '?', statusWorktree: '?' } }] }, 'Merge')).toBeNull();
  });

  it('其他未完成 Git 操作不能通过普通提交按钮结束', () => {
    expect(commitBlockReason({ ...merging, operation: { ...merging.operation!, kind: 'rebase' } }, 'Commit')).toContain('变基');
  });
});
