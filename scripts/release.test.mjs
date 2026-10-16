import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRelease, releaseNotes, setVersion } from './release.mjs';

const roots = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'workbench-release-'));
  roots.push(root);
  mkdirSync(join(root, 'src-tauri'));
  writeFileSync(join(root, 'package.json'), '{"name":"git-workbench","version":"0.1.0"}\n');
  writeFileSync(join(root, 'src-tauri/tauri.conf.json'), '{"version":"../package.json"}\n');
  writeFileSync(join(root, 'src-tauri/Cargo.toml'), '[package]\nname = "git-workbench"\nversion = "0.1.0"\n\n[dependencies]\nother = { version = "0.1.0" }\n');
  writeFileSync(join(root, 'src-tauri/Cargo.lock'), 'version = 4\n\n[[package]]\nname = "git-workbench"\nversion = "0.1.0"\n\n[[package]]\nname = "other"\nversion = "0.1.0"\n');
  writeFileSync(join(root, 'CHANGELOG.md'), '# 更新日志\n\n## [Unreleased]\n\n## [0.1.0] - 2026-10-16\n\n- 首版发布。\n\n## [0.0.1] - 2026-10-01\n\n- 原型。\n');
  return root;
}

afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

describe('发布版本约束', () => {
  it('读取统一版本、检查标签并只提取当前版本更新说明', () => {
    const root = fixture();
    expect(checkRelease(root, 'v0.1.0')).toBe('0.1.0');
    expect(releaseNotes(root)).toBe('- 首版发布。\n');
    expect(() => checkRelease(root, 'v0.2.0')).toThrow('标签');
  });

  it.each(['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'])('拒绝不同步的 %s', path => {
    const root = fixture();
    const file = join(root, path);
    writeFileSync(file, readFileSync(file, 'utf8').replace('version = "0.1.0"', 'version = "0.2.0"'));
    expect(() => checkRelease(root)).toThrow('版本不一致');
  });

  it('要求 Tauri 直接引用 package.json，且当前版本必须有更新日志', () => {
    const root = fixture();
    writeFileSync(join(root, 'src-tauri/tauri.conf.json'), '{"version":"0.1.0"}');
    expect(() => checkRelease(root)).toThrow('package.json');
    writeFileSync(join(root, 'src-tauri/tauri.conf.json'), '{"version":"../package.json"}');
    writeFileSync(join(root, 'CHANGELOG.md'), '# 更新日志\n\n## [0.1.0]\n\n## [0.0.1]\n- 旧版\n');
    expect(() => checkRelease(root)).toThrow('更新日志');
  });

  it.each(['## [0.1.0]', '## [0.1.0] - 2026-10-16', '## [0.1.0]extra\n\n- 无效版本标题'])('拒绝缺少正文或边界错误的日志标题 %s', changelog => {
    const root = fixture();
    writeFileSync(join(root, 'CHANGELOG.md'), changelog);
    expect(() => checkRelease(root)).toThrow('更新日志');
  });

  it('升级时同步三个版本文件并保留其他依赖版本；检查会提示补全新日志', () => {
    const root = fixture();
    setVersion(root, '0.2.0');
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('0.2.0');
    expect(readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8')).toContain('version = "0.2.0"');
    expect(readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8')).toContain('other = { version = "0.1.0" }');
    expect(readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8')).toContain('name = "other"\nversion = "0.1.0"');
    expect(() => checkRelease(root)).toThrow('更新日志');
    writeFileSync(join(root, 'CHANGELOG.md'), '## [0.2.0] - 2026-10-17\n\n- 新版本\n');
    expect(checkRelease(root, 'v0.2.0')).toBe('0.2.0');
  });

  it.each(['v0.2.0', '01.2.0', '1.0', '0.1.0-beta', '0.0.9'])('拒绝无效或回退版本 %s，原文件保持不变', version => {
    const root = fixture();
    const before = readFileSync(join(root, 'package.json'), 'utf8');
    expect(() => setVersion(root, version)).toThrow();
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before);
    expect(checkRelease(root)).toBe('0.1.0');
  });
});
