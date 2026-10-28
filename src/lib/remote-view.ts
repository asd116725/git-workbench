import type { GitRemoteAction, Worktree } from './types';

/** 获取不改动当前分支；拉取和推送要求已有提交且没有待完成的 Git 操作。 */
export function remoteBlockReason(worktree: Worktree, action: GitRemoteAction): string | null {
  if (worktree.source !== 'native') return '演示模式不连接远程，请在桌面应用中打开本地仓库。';
  const remote = worktree.remote;
  if (!remote) return '远程状态尚未加载，请刷新后重试。';
  if (!remote.remotes.length) return '尚未配置远程仓库，请先在 Git 中添加远程仓库。';
  if (action === 'fetch') return null;
  if (worktree.hasHead === false) return '请先完成首次提交。';
  if (worktree.detached) return '当前处于分离 HEAD，请先切换到本地分支。';
  if (worktree.operation) return '请先完成或中止当前 Git 操作。';
  if (remote.upstreamRemote === '.') return '当前上游是本地分支，请先配置远程上游。';
  if (remote.upstreamRemote && !remote.remotes.includes(remote.upstreamRemote)) return '上游对应的远程仓库已不存在，请检查 Git 配置。';
  if (action === 'pull' && !remote.upstream) return '当前分支尚未设置上游，请先推送并建立跟踪。';
  return null;
}
