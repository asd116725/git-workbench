import { describe, expect, it } from 'vitest';
import { buildChangeTree, type ChangeTreeNode } from './change-tree';
import { getChanges } from './demo-git';
import type { FileSnapshot, Worktree } from './types';

function file(path: string): FileSnapshot {
  return { id: path, path, language: 'typescript', head: 'head', index: 'index', working: 'working' };
}

function leaves(nodes: ChangeTreeNode[]): FileSnapshot[] {
  return nodes.flatMap(node => node.kind === 'file' ? [node.file] : leaves(node.children));
}

describe('变更文件目录树', () => {
  it('目录优先并自然排序，同名文件保留完整路径和原始快照', () => {
    const files = [file('README.md'), file('src/test10.ts'), file('docs/index.ts'), file('src/test2.ts'), file('src/index.ts')];
    const tree = buildChangeTree(files);
    expect(tree.map(node => node.name)).toEqual(['docs', 'src', 'README.md']);
    expect(tree[1]).toMatchObject({ kind: 'directory', path: 'src', fileCount: 3 });
    expect(leaves(tree).map(item => item.path)).toEqual(['docs/index.ts', 'src/index.ts', 'src/test2.ts', 'src/test10.ts', 'README.md']);
    expect(leaves(tree).find(item => item.path === 'src/index.ts')).toBe(files[4]);
    expect(files.map(item => item.path)).toEqual(['README.md', 'src/test10.ts', 'docs/index.ts', 'src/test2.ts', 'src/index.ts']);
  });

  it('文件变成目录时同时展示旧文件删除和新增子文件', () => {
    const removed = file('config');
    const added = file('config/index.ts');
    expect(buildChangeTree([removed, added]).map(node => [node.kind, node.path])).toEqual([
      ['directory', 'config'], ['file', 'config'],
    ]);
    expect(leaves(buildChangeTree([removed, added]))).toEqual([added, removed]);
  });

  it('中文、空格、反斜线和特殊名称不被规范化或丢失', () => {
    const files = [file('中文 目录/__proto__/a.ts'), file('literal\\name.ts'), file('中文 目录/另一个.ts')];
    const tree = buildChangeTree(files);
    expect(leaves(tree)).toHaveLength(3);
    expect(tree.some(node => node.kind === 'file' && node.path === 'literal\\name.ts')).toBe(true);
    expect(leaves(tree)).toEqual(expect.arrayContaining(files));
    expect(buildChangeTree([])).toEqual([]);
  });

  it('暂存和未暂存独立分组，重命名按目标目录展示但保留源路径', () => {
    const renamed = { ...file('new/name.ts'), git: { statusIndex: 'R', statusWorktree: 'M', originalPath: 'old/name.ts', conflicted: false } };
    const unstaged = { ...file('src/only.ts'), git: { statusIndex: ' ', statusWorktree: 'M', originalPath: null, conflicted: false } };
    const worktree: Worktree = { id: 'test', name: 'test', path: '/test', branch: 'main', commits: [], files: [renamed, unstaged] };
    const stagedTree = buildChangeTree(getChanges(worktree, 'staged'));
    expect(stagedTree[0].path).toBe('new');
    expect(leaves(stagedTree)).toEqual([renamed]);
    expect(leaves(stagedTree)[0].git?.originalPath).toBe('old/name.ts');
    expect(leaves(buildChangeTree(getChanges(worktree, 'unstaged')))).toEqual([renamed, unstaged]);
  });
});
