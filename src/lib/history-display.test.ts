import { describe, expect, it } from 'vitest';
import { historyDateGroup, historyTime } from './history-display';

function seconds(date: Date) { return date.getTime() / 1000; }

describe('历史日期分组', () => {
  it('按本地日历区分今天、昨天和更早日期，跨月不受影响', () => {
    const now = new Date(2026, 10, 1, 0, 5);
    expect(historyDateGroup(seconds(new Date(2026, 10, 1, 0, 1)), now)).toBe('今天');
    expect(historyDateGroup(seconds(new Date(2026, 9, 31, 23, 59)), now)).toBe('昨天');
    expect(historyDateGroup(seconds(new Date(2026, 9, 30, 23, 59)), now)).toBe('2026/10/30');
  });

  it('提交时间采用本地 24 小时制', () => {
    expect(historyTime(seconds(new Date(2026, 9, 22, 16, 7)))).toBe('16:07');
  });
});
