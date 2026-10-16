import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('安装包的第三方许可', () => {
  it('包含 Monaco 内嵌依赖的完整声明，不能只收录 Monaco 的 MIT 许可', () => {
    const notices = readFileSync(new URL('../node_modules/monaco-editor/ThirdPartyNotices.txt', import.meta.url), 'utf8').replace(/\r\n/g, '\n').trim();
    const bundled = readFileSync(new URL('../docs/licenses/dependencies.txt', import.meta.url), 'utf8');
    expect(bundled).toContain(notices);
    expect(bundled).not.toContain('\r\n');
  });
});
