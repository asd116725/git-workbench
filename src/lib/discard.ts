import { getChanges } from './demo-git';
import type { FileSnapshot, GitDiscardPreview, Worktree } from './types';

/** 原生文件未加载正文，是否新增必须依据 Git 工作区状态。 */
export function isUntrackedChange(file: FileSnapshot): boolean {
  return file.git ? file.git.statusWorktree === '?' : file.index === null;
}

/** 演示模式绑定所选文件内容，保持与原生确认失效规则一致。 */
export function previewDemoDiscard(worktree: Worktree, paths: string[]): GitDiscardPreview {
  const files = paths.map(path => {
    const file = getChanges(worktree, 'unstaged').find(file => file.path === path);
    if (!file) throw new Error('文件或暂存状态已变化，请重新预览并确认撤销。');
    return file;
  });
  return {
    files: files.map(file => ({ path: file.path, untracked: isUntrackedChange(file) })),
    snapshot: JSON.stringify([worktree.id, worktree.branch, files]),
  };
}
