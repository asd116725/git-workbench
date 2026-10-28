import { getLanguage, t } from '../lib/i18n';
import { translateMessage } from '../lib/i18n-system';
import type { GitBranch, Worktree } from '../lib/types';

/** 提交时间为 Unix 秒，保留未来时间语义，避免系统时钟差异显示成负数。 */
export function commitAge(committedAt: number) {
  const relativeTime = new Intl.RelativeTimeFormat(getLanguage(), { numeric: 'always' });
  const seconds = (Date.now() / 1000) - committedAt;
  const units = [['year', 365 * 86400], ['month', 30 * 86400], ['week', 7 * 86400], ['day', 86400], ['hour', 3600], ['minute', 60]] as const;
  const unit = units.find(([, duration]) => Math.abs(seconds) >= duration);
  return unit ? relativeTime.format(-Math.trunc(seconds / unit[1]), unit[0]) : t("刚刚");
}

/** 按主工作区元数据翻译应用生成名称，普通目录名保持原文。 */
export function worktreeLabel(worktree: Worktree): string {
  return worktree.isMain ? t('主工作区') : worktree.name;
}

/** 依据分离状态翻译 Git 生成的 HEAD 标签，普通分支名与提交 SHA 保持原文。 */
export function branchLabel(worktree: Worktree): string {
  return worktree.source === 'native' && (worktree.detached || worktree.bare) ? translateMessage(worktree.branch) : worktree.branch;
}

/** 分支差异始终相对该分支的上游，不代表服务器刚刚获取到的最新状态。 */
export function branchSyncDescription(branch: GitBranch): string | null {
  if (branch.kind !== 'local' || !branch.upstream) return null;
  if (branch.ahead == null || branch.behind == null) return t('无法确定与上游 {upstream} 的提交差异；请先获取远程更新。', { upstream: branch.upstream });
  if (branch.ahead === 0 && branch.behind === 0) return t('已与上游 {upstream} 同步。数量基于最近获取的引用。', { upstream: branch.upstream });
  return t('相对上游 {upstream}：待拉取 {behind} 个提交，待推送 {ahead} 个提交。数量基于最近获取的引用。', { upstream: branch.upstream, behind: branch.behind, ahead: branch.ahead });
}
