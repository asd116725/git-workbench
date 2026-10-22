import { invoke } from '@tauri-apps/api/core';
import { getFileStatus } from './demo-git';
import { fileLanguage } from './native-git';
import { useWorkbench } from './store';
import type { Commit, FileSnapshot, Worktree } from './types';
import type { HistoryChangedFile, HistoryCommitDetail, HistoryCommitSummary, HistoryDiff, HistoryPage } from './history-types';

/** 将历史前后版本适配为只读 staged Diff，不参与任何真实暂存操作。 */
export function historyFileSnapshot(file: HistoryChangedFile, content?: HistoryDiff): FileSnapshot {
  return {
    id: file.path, path: file.path,
    language: fileLanguage(file.path),
    head: content?.original ?? null, index: content?.modified ?? null, working: null,
    git: { statusIndex: file.status, statusWorktree: ' ', originalPath: file.oldPath, conflicted: false },
  };
}

/** 示例数据原有短 ID 在不同分支重复，补充稳定后缀避免正文缓存混用。 */
function demoOid(commit: Commit, owner: string) {
  let hash = 2166136261;
  for (const character of owner) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return commit.id.padEnd(32, '0') + (hash >>> 0).toString(16).padStart(8, '0');
}
function summary(commit: Commit, owner: string, parent?: Commit): HistoryCommitSummary {
  return {
    oid: demoOid(commit, owner), shortHash: commit.id.slice(0, 7), subject: commit.message,
    authorName: commit.author, authorEmail: 'demo@example.com', committedAt: Math.floor(new Date(commit.date).getTime() / 1000),
    parents: parent ? [demoOid(parent, owner)] : [],
  };
}

/** 演示分页也固定首屏快照，模拟提交新增后仍可继续浏览旧列表。 */
interface DemoSnapshot { owner: string; commits: Commit[] }
const demoSnapshots = new Map<string, DemoSnapshot>();
function snapshotKey(worktree: Worktree, snapshot: string) { return `${worktree.id}:${snapshot}`; }
function demoTarget(worktree: Worktree, reference: string | null) {
  if (!reference || reference === `refs/heads/${worktree.branch}`) return worktree;
  const repository = useWorkbench.getState().repositories.find(repository => repository.worktrees.some(item => item.id === worktree.id));
  const target = repository?.worktrees.find(item => reference === `refs/heads/${item.branch}`);
  if (!target) throw new Error('演示分支不存在，请选择其他分支。');
  return target;
}
function demoCommit(worktree: Worktree, oid: string) {
  const snapshots = [
    ...Array.from(demoSnapshots.entries()).filter(([key]) => key.startsWith(`${worktree.id}:`)).map(([, snapshot]) => snapshot),
    { owner: worktree.id, commits: worktree.commits },
  ];
  for (const snapshot of snapshots) {
    const index = snapshot.commits.findIndex(item => demoOid(item, snapshot.owner) === oid);
    if (index !== -1) return { commit: snapshot.commits[index], parent: snapshot.commits[index + 1], owner: snapshot.owner };
  }
  throw new Error('提交不存在，请刷新历史。');
}

/** 原生与演示共用历史读取协议，演示数据不会进入真实 Git 命令。 */
export const historyGit = {
  async ref(worktree: Worktree, reference: string | null): Promise<{ oid: string | null }> {
    if (worktree.source === 'native') return invoke('git_history_ref', { repoPath: worktree.path, reference });
    const target = demoTarget(worktree, reference);
    const oid = target.commits[0] ? demoOid(target.commits[0], target.id) : null;
    if (oid) demoSnapshots.set(snapshotKey(worktree, oid), { owner: target.id, commits: target.commits });
    return { oid };
  },
  async page(worktree: Worktree, snapshot: string, query: string, cursor: string | null): Promise<HistoryPage> {
    if (worktree.source === 'native') return invoke('git_history', { repoPath: worktree.path, snapshot, query, cursor });
    const { owner, commits } = demoSnapshots.get(snapshotKey(worktree, snapshot))!;
    const needle = query.toLocaleLowerCase();
    const found = commits.map((commit, index) => ({ commit, summary: summary(commit, owner, commits[index + 1]) }))
      .filter(({ commit, summary }) => [commit.message, commit.description, summary.authorName, summary.authorEmail, summary.oid].some(value => value.toLocaleLowerCase().includes(needle)));
    const offset = cursor ? Number(cursor) : 0;
    return { commits: found.slice(offset, offset + 50).map(item => item.summary), nextCursor: found.length > offset + 50 ? String(offset + 50) : null };
  },
  async detail(worktree: Worktree, oid: string, parentIndex: number): Promise<HistoryCommitDetail> {
    if (worktree.source === 'native') return invoke('git_commit_detail', { repoPath: worktree.path, oid, parentIndex });
    const { commit, parent, owner } = demoCommit(worktree, oid);
    return {
      commit: summary(commit, owner, parent), message: [commit.message, commit.description].filter(Boolean).join('\n\n'),
      parentOid: parent ? demoOid(parent, owner) : null, parentIndex: 0,
      files: commit.files.map(file => ({ path: file.path, oldPath: file.git?.originalPath ?? null, status: getFileStatus(file, 'staged'), oldMode: file.head === null ? '000000' : '100644', newMode: file.index === null ? '000000' : '100644' })),
    };
  },
  async diff(worktree: Worktree, oid: string, parentIndex: number, path: string): Promise<HistoryDiff> {
    if (worktree.source === 'native') return invoke('git_commit_diff', { repoPath: worktree.path, oid, parentIndex, path });
    const file = demoCommit(worktree, oid).commit.files.find(item => item.path === path);
    if (!file) throw new Error('该提交中没有这个文件。');
    return { original: file.head, modified: file.index, notice: null };
  },
};
