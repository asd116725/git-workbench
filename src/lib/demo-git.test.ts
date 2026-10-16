import { describe, expect, it } from 'vitest';
import { createDemoRepositories } from './demo-data';
import { commitWorktree, getChanges, getDiff, getDiffStats, getFileStatus, getHunks, stageFile, stageHunk, unstageFile } from './demo-git';
import type { FileSnapshot, Worktree } from './types';

function mainWorktree() {
  return createDemoRepositories()[0].worktrees[0];
}

function worktreeWith(file: Partial<FileSnapshot>): Worktree {
  return {
    id: 'test', name: 'test', branch: 'main', path: '/demo/test', commits: [],
    files: [{ id: 'file', path: 'file.ts', language: 'typescript', head: 'before\n', index: 'before\n', working: 'after\n', ...file }],
  };
}

describe('示例仓库', () => {
  it('初始提供三个未暂存、三个已暂存文件及干净 worktree', () => {
    const repositories = createDemoRepositories();
    expect(getChanges(repositories[0].worktrees[0], 'unstaged')).toHaveLength(3);
    expect(getChanges(repositories[0].worktrees[0], 'staged')).toHaveLength(3);
    expect(getChanges(repositories[0].worktrees[2], 'unstaged')).toHaveLength(0);
    expect(getChanges(repositories[0].worktrees[2], 'staged')).toHaveLength(0);
    const another = createDemoRepositories();
    repositories[0].worktrees[0].files[0].working = 'changed';
    expect(another[0].worktrees[0].files[0].working).not.toBe('changed');
  });

  it('选中文件包含两个可分别暂存的变更块', () => {
    const hunks = getHunks(mainWorktree().files[0], 'unstaged');
    expect(hunks).toHaveLength(2);
    expect(hunks[0].oldStart).toBeLessThan(hunks[1].oldStart);
  });
});

describe('暂存和差异', () => {
  it('整文件暂存与取消暂存不修改工作区或原始对象', () => {
    const original = mainWorktree();
    const file = original.files[0];
    const staged = stageFile(original, file.id);
    expect(staged.files[0].index).toBe(file.working);
    expect(getChanges(staged, 'unstaged')).toHaveLength(2);
    expect(getChanges(staged, 'staged')).toHaveLength(4);
    expect(original.files[0].index).toBe(file.head);
    expect(unstageFile(staged, file.id).files[0]).toEqual(file);
  });

  it('块暂存只修改选中块，使同一文件同时出现在两组', () => {
    const original = mainWorktree();
    const file = original.files[0];
    const staged = stageHunk(original, file.id, 0);
    expect(staged.files[0].index).toContain("import { useMarkdownScrollSync }");
    expect(staged.files[0].index).not.toContain('const { handleEditorScroll');
    expect(staged.files[0].working).toBe(file.working);
    expect(getChanges(staged, 'staged').map((changed) => changed.id)).toContain(file.id);
    expect(getChanges(staged, 'unstaged').map((changed) => changed.id)).toContain(file.id);
    expect(getDiff(staged.files[0], 'staged').original).toBe(file.head);
    expect(getDiff(staged.files[0], 'unstaged').original).toBe(staged.files[0].index);
    expect(unstageFile(staged, file.id).files[0]).toEqual(file);
  });

  it('先暂存后面的块也能保持顺序并逐步暂存全部内容', () => {
    let worktree = mainWorktree();
    const file = worktree.files[0];
    const originalIndex = file.index;
    worktree = stageHunk(worktree, file.id, getHunks(file, 'unstaged').length - 1);
    expect(worktree.files[0].index).not.toBe(originalIndex);
    expect(worktree.files[0].index).not.toContain("import { useMarkdownScrollSync }");
    while (getHunks(worktree.files[0], 'unstaged').length > 0) {
      worktree = stageHunk(worktree, file.id, 0);
    }
    expect(worktree.files[0].index).toBe(file.working);
  });

  it('准确计算增删行并区分空文件和不存在的文件', () => {
    const file = worktreeWith({ head: 'one\ntwo\n', index: 'one\ntwo\n', working: 'one\nthree\nfour\n' }).files[0];
    expect(getDiffStats(file, 'unstaged')).toEqual({ additions: 2, deletions: 1 });
    const empty = worktreeWith({ head: null, index: null, working: '' });
    expect(getChanges(empty, 'unstaged')).toHaveLength(1);
    expect(getFileStatus(empty.files[0], 'unstaged')).toBe('A');
    expect(stageFile(empty, 'file').files[0].index).toBe('');
  });

  it('支持新增文件暂存、取消及块暂存', () => {
    const original = worktreeWith({ head: null, index: null, working: 'export const value = 1;\n' });
    const staged = stageHunk(original, 'file', 0);
    expect(staged.files[0].index).toBe(original.files[0].working);
    expect(getFileStatus(staged.files[0], 'staged')).toBe('A');
    expect(getChanges(staged, 'unstaged')).toHaveLength(0);
    expect(unstageFile(staged, 'file').files[0].index).toBeNull();
  });

  it('支持删除文件暂存与取消，不把删除误判为空文件', () => {
    const original = worktreeWith({ working: null });
    expect(getFileStatus(original.files[0], 'unstaged')).toBe('D');
    const staged = stageHunk(original, 'file', 0);
    expect(staged.files[0].index).toBeNull();
    expect(getFileStatus(staged.files[0], 'staged')).toBe('D');
    expect(unstageFile(staged, 'file').files[0]).toEqual(original.files[0]);
    expect(commitWorktree(staged, '删除文件', '').files).toHaveLength(0);
  });

  it('不存在的变更块提供明确错误', () => {
    expect(() => stageHunk(mainWorktree(), 'markdown-control', 99)).toThrow('该变更块已不存在');
  });
});

describe('提交', () => {
  it('只提交暂存内容，保留同文件中未暂存的修改及完整提交差异', () => {
    const original = mainWorktree();
    const staged = stageHunk(original, 'markdown-control', 0);
    const committed = commitWorktree(staged, '  feat: 同步 Markdown 滚动  ', '  接入滚动同步 Hook  ');
    expect(getChanges(committed, 'staged')).toHaveLength(0);
    expect(getChanges(committed, 'unstaged')).toHaveLength(3);
    expect(committed.files[0].head).toBe(staged.files[0].index);
    expect(committed.files[0].working).toBe(original.files[0].working);
    expect(committed.commits[0]).toMatchObject({ message: 'feat: 同步 Markdown 滚动', description: '接入滚动同步 Hook', author: 'Demo User' });
    expect(committed.commits[0].files).toHaveLength(4);
    expect(committed.commits[0].files[0].head).toBe(original.files[0].head);
    expect(committed.commits[0].files[0].working).toBe(staged.files[0].index);
    expect(staged.commits).toHaveLength(original.commits.length);
  });

  it('完整提交后仓库干净，拒绝空标题或无暂存内容', () => {
    const staged = stageFile(worktreeWith({}), 'file');
    expect(() => commitWorktree(staged, '   ', '')).toThrow('请输入提交标题');
    const committed = commitWorktree(staged, '更新文件', '');
    expect(getChanges(committed, 'unstaged')).toHaveLength(0);
    expect(getChanges(committed, 'staged')).toHaveLength(0);
    expect(() => commitWorktree(committed, '再次提交', '')).toThrow('请先暂存');
  });

  it('提交空文件后仍保留该文件', () => {
    const staged = stageFile(worktreeWith({ head: null, index: null, working: '' }), 'file');
    expect(commitWorktree(staged, '添加空文件', '').files[0]).toMatchObject({ head: '', index: '', working: '' });
  });
});
