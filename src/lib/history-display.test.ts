import { afterEach, describe, expect, it } from 'vitest';
import { historyDateGroup, historyTime } from './history-display';
import { setLanguage } from './i18n';

afterEach(() => setLanguage('zh-CN'));

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

  it('已加载的日期在三种语言间切换时重新格式化，保留本地日历边界', () => {
    const now = new Date(2026, 10, 1, 0, 5);
    const oldDate = new Date(2026, 9, 30, 23, 59);
    for (const language of ['en', 'zh-TW', 'zh-CN'] as const) {
      setLanguage(language);
      expect(historyDateGroup(seconds(now), now)).toBe(language === 'en' ? 'Today' : '今天');
      expect(historyDateGroup(seconds(new Date(2026, 9, 31, 23, 59)), now)).toBe(language === 'en' ? 'Yesterday' : '昨天');
      expect(historyDateGroup(seconds(oldDate), now)).toBe(oldDate.toLocaleDateString(language, { year: 'numeric', month: '2-digit', day: '2-digit' }));
      expect(historyTime(seconds(oldDate))).toBe('23:59');
    }
  });
});
