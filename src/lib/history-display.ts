/** 日期使用本地日历分组，避免夏令时或跨月时用 24 小时误判昨天。 */
export function historyDateGroup(seconds: number, now = new Date()): string {
  const date = new Date(seconds * 1000);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return '今天';
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function historyTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
