import type { GitRemoteAction, Worktree } from './types';
import type { RemoteCheckState } from './store';

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

/** 只使用本工作区的检查结果，切换后先把尚未核验的数字当作旧引用。 */
export function remoteCheckFor(worktree: Worktree, check: RemoteCheckState | null) {
  return check?.worktreeId === worktree.id ? check : null;
}

/** 标记计数的检查状态；缓存中的分叉仍可供用户预览合并。 */
export function remoteIntegration(worktree: Worktree, check: RemoteCheckState | null) {
  const current = remoteCheckFor(worktree, check);
  const remote = worktree.remote;
  if (remoteBlockReason(worktree, 'pull') || remote?.ahead == null || remote.behind == null || remote.behind <= 0) return null;
  const fullName = remote.upstreamRef;
  const name = fullName?.match(/^refs\/(?:heads|remotes)\/(.+)$/)?.[1];
  const source = fullName && name ? { fullName, name } : null;
  return { ahead: remote.ahead, behind: remote.behind, source, fresh: Boolean(current && !current.checking && current.error === null) };
}
