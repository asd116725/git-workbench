const relativeTime = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'always' });

/** 提交时间为 Unix 秒，保留未来时间语义，避免系统时钟差异显示成负数。 */
export function commitAge(committedAt: number) {
  const seconds = (Date.now() / 1000) - committedAt;
  const units = [['year', 365 * 86400], ['month', 30 * 86400], ['week', 7 * 86400], ['day', 86400], ['hour', 3600], ['minute', 60]] as const;
  const unit = units.find(([, duration]) => Math.abs(seconds) >= duration);
  return unit ? relativeTime.format(-Math.trunc(seconds / unit[1]), unit[0]) : '刚刚';
}
