import { getLanguage, t } from '../lib/i18n';
import { translateMessage } from '../lib/i18n-system';
import type { Worktree } from '../lib/types';

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
