import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('文件图标离线资源', () => {
  it('清单引用的 SVG 均随应用保存，许可说明同时存在', () => {
    const data = JSON.parse(readFileSync(new URL('../src/lib/file-icons-data.json', import.meta.url), 'utf8'));
    const assets = new Set([data.defaults, data.names, data.extensions, data.languages, data.folders, data.foldersExpanded].flatMap(Object.values));
    for (const asset of assets) {
      expect(asset).toMatch(/^[\w-]+\.svg$/);
      expect(readFileSync(new URL(`../public/file-icons/${asset}`, import.meta.url), 'utf8')).toContain('<svg');
    }
    expect(readFileSync(new URL('../docs/licenses/vscode-icons-artwork.txt', import.meta.url), 'utf8')).toContain('Attribution-ShareAlike 4.0 International');
    expect(readFileSync(new URL('../docs/licenses/vscode-icons-code.txt', import.meta.url), 'utf8')).toContain('The MIT License');
  });
});
