import { describe, expect, it } from 'vitest';
import { uiMessages } from './i18n-ui-messages';
import { systemMessages } from './i18n-system-messages';

const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();

describe('翻译资源完整性', () => {
  it('界面与系统的同名文案使用一致译文', () => {
    for (const source of Object.keys(uiMessages)) {
      if (source in systemMessages) expect(systemMessages[source], source).toEqual(uiMessages[source]);
    }
  });

  it('两种译文均非空且完整保留动态参数', () => {
    for (const [source, translations] of Object.entries({ ...uiMessages, ...systemMessages })) {
      for (const language of ['en', 'zh-TW'] as const) {
        expect(translations[language].trim(), `${source}: ${language}`).not.toBe('');
        expect(placeholders(translations[language]), `${source}: ${language}`).toEqual(placeholders(source));
      }
    }
  });
});
