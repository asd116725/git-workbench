import { describe, expect, it } from 'vitest';
import { cleanErrorLog } from './error-log';

describe('错误日志文本', () => {
  it('去除 ANSI 颜色、光标控制及字符串指令，保留普通文本', () => {
    const raw = '\x1b[31mError:\x1b[0m \x9b1m失败\x9b0m\n'
      + '\x1b]8;;https://example.test\x1b\\查看详情\x1b]8;;\x07\n'
      + '\x1bP隐藏的设备控制序列\x1b\\\x1b(B\x1b[2K\x1b7\x1b8  at script.js:1';
    expect(cleanErrorLog(raw)).toBe('Error: 失败\n查看详情\n  at script.js:1');
  });

  it('保留空行、缩进、末尾换行和 Unicode，将终端回车转换为换行', () => {
    expect(cleanErrorLog('\ufeff\r\n\t<script>🔧 修復</script>\uFFFD\x00 \r\r\n末行\n'))
      .toBe('\n\t<script>🔧 修復</script>\uFFFD \n\n末行\n');
  });

  it.each([
    ['OSC', 'Git:\n\x1b]incomplete\nError: build failed\n\x07more'],
    ['C1 OSC', 'Git:\n\x9dincomplete\r\nError: build failed\r\x9cmore'],
    ['DCS', 'Git:\n\x1bPincomplete\r\nError: build failed\n\x1b\\more'],
    ['C1 DCS', 'Git:\n\x90incomplete\rError: build failed\n\x9cmore'],
  ])('截断的 %s 指令保留跨行错误正文', (_sequence, raw) => {
    expect(cleanErrorLog(raw)).toBe('Git:\nincomplete\nError: build failed\nmore');
  });

  it('保留视口外的完整日志文本', () => {
    const raw = '  追踪信息\n'.repeat(10000) + 'Error: 末行';
    expect(cleanErrorLog(raw)).toBe(raw);
  });
});
