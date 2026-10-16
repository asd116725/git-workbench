import { applyPatch, diffLines, structuredPatch } from 'diff';
import type { StructuredPatchHunk } from 'diff';
import type { ChangeArea, FileSnapshot, Worktree } from './types';

/** 可独立暂存的变更块；行号以当前比较版本为准。 */
export interface DiffHunk extends StructuredPatchHunk {
  id: string;
}

function getVersions(file: FileSnapshot, area: ChangeArea) {
  return area === 'staged'
    ? { original: file.head, modified: file.index }
    : { original: file.index, modified: file.working };
}

/** 从快照派生分组，同一文件可以同时包含已暂存和未暂存修改。 */
export function getChanges(worktree: Worktree, area: ChangeArea): FileSnapshot[] {
  return worktree.files.filter((file) => {
    if (file.git) {
      if (file.git.conflicted) return area === 'unstaged';
      const status = area === 'staged' ? file.git.statusIndex : file.git.statusWorktree;
      return status !== ' ' && status !== '' && (area === 'unstaged' || status !== '?');
    }
    const { original, modified } = getVersions(file, area);
    return original !== modified;
  });
}

/** 为编辑器提供文本；文件存在性仍由原始快照保存。 */
export function getDiff(file: FileSnapshot, area: ChangeArea) {
  const { original, modified } = getVersions(file, area);
  return { original: original ?? '', modified: modified ?? '' };
}

/** 按当前比较范围判断新增、修改或删除。 */
export function getFileStatus(file: FileSnapshot, area: ChangeArea): string {
  if (file.git) {
    if (file.git.conflicted) return 'U';
    const status = area === 'staged' ? file.git.statusIndex : file.git.statusWorktree;
    return status === '?' ? 'A' : status;
  }
  const { original, modified } = getVersions(file, area);
  if (original === null) return 'A';
  if (modified === null) return 'D';
  return 'M';
}

/** 仅统计实际增删行，不计入上下文。 */
export function getDiffStats(file: FileSnapshot, area: ChangeArea) {
  const { original, modified } = getDiff(file, area);
  return diffLines(original, modified).reduce(
    (stats, change) => ({
      additions: stats.additions + (change.added ? change.count : 0),
      deletions: stats.deletions + (change.removed ? change.count : 0),
    }),
    { additions: 0, deletions: 0 },
  );
}

/** 保留三行上下文，让界面展示与应用补丁使用同一套变更块。 */
export function getHunks(file: FileSnapshot, area: ChangeArea): DiffHunk[] {
  const { original, modified } = getDiff(file, area);
  return structuredPatch(file.path, file.path, original, modified, undefined, undefined, { context: 3 })
    .hunks.map((hunk) => ({ ...hunk, id: `${file.id}:${hunk.oldStart}:${hunk.newStart}` }));
}

function updateFile(worktree: Worktree, fileId: string, update: (file: FileSnapshot) => FileSnapshot): Worktree {
  return { ...worktree, files: worktree.files.map((file) => file.id === fileId ? update(file) : file) };
}

/** 将整个工作区文件写入暂存区，不改变工作区内容。 */
export function stageFile(worktree: Worktree, fileId: string): Worktree {
  return updateFile(worktree, fileId, (file) => ({ ...file, index: file.working }));
}

/** 将暂存区恢复到 HEAD，已编辑内容仍留在工作区。 */
export function unstageFile(worktree: Worktree, fileId: string): Worktree {
  return updateFile(worktree, fileId, (file) => ({ ...file, index: file.head }));
}

/** 只将选中的未暂存块应用到索引，其余工作区内容保持不变。 */
export function stageHunk(worktree: Worktree, fileId: string, hunkIndex: number): Worktree {
  return updateFile(worktree, fileId, (file) => {
    const { original, modified } = getDiff(file, 'unstaged');
    const patch = structuredPatch(file.path, file.path, original, modified, undefined, undefined, { context: 3 });
    const hunk = patch.hunks[hunkIndex];
    if (!hunk) throw new Error('该变更块已不存在，请重新选择。');
    const content = applyPatch(original, { ...patch, hunks: [hunk] });
    if (content === false) throw new Error('变更块暂存失败，请刷新后重试。');
    return { ...file, index: file.working === null && content === '' ? null : content };
  });
}

/** 仅提交暂存内容；HEAD 前进后，工作区的未暂存修改继续保留。 */
export function commitWorktree(worktree: Worktree, message: string, description: string): Worktree {
  const title = message.trim();
  if (!title) throw new Error('请输入提交标题。');
  const staged = getChanges(worktree, 'staged');
  if (staged.length === 0) throw new Error('请先暂存需要提交的修改。');
  const commit = {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 8),
    message: title,
    description: description.trim(),
    author: 'Demo User',
    date: new Date().toISOString(),
    files: staged.map((file) => ({ ...file, working: file.index })),
  };
  return {
    ...worktree,
    files: worktree.files.map((file) => ({ ...file, head: file.index }))
      .filter((file) => file.head !== null || file.working !== null),
    commits: [commit, ...worktree.commits],
  };
}
