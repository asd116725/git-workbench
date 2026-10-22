import { getChanges } from './demo-git';
import type { GitOperation, Worktree } from './types';

export const operationNames: Record<GitOperation['kind'], string> = {
  merge: '合并', rebase: '变基', 'cherry-pick': '拣选提交', revert: '还原提交', am: '应用补丁',
};

/** 入口和弹窗使用相同限制；最终仍由 Git 在执行前核验仓库状态。 */
export function mergeStartBlockReason(worktree: Worktree): string | null {
  if (worktree.source !== 'native') return '请打开本地仓库后合并分支。';
  if (worktree.operation) return `请先完成当前${operationNames[worktree.operation.kind]}操作。`;
  if (worktree.detached) return '请先切换到一个本地分支。';
  if (!worktree.hasHead) return '当前分支尚无提交，暂时不能合并。';
  if (worktree.files.length) return '请先提交或在外部工具中保存当前更改，保持工作区和暂存区干净。';
  return null;
}

/** 合并即使没有文件差异也可完成，但不能遗漏尚未暂存的冲突解决内容。 */
export function commitBlockReason(worktree: Worktree, message: string): string | null {
  const operation = worktree.operation;
  if (operation && operation.kind !== 'merge') return `请先在外部工具中完成${operationNames[operation.kind]}操作。`;
  if (worktree.files.some(file => file.git?.conflicted)) return '请先在编辑器中解决冲突，再暂存对应文件。';
  if (operation?.kind === 'merge' && worktree.files.some(file => file.git && ![' ', '', '?'].includes(file.git.statusWorktree))) {
    return '还有已跟踪文件的修改未暂存，请检查并暂存后完成合并。';
  }
  if (!message.trim()) return '请填写提交信息。';
  if (operation?.kind !== 'merge' && !getChanges(worktree, 'staged').length) return '请先暂存需要提交的文件。';
  return null;
}
