import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CodeDiff } from './CodeDiff';
import { createDemoRepositories } from '../lib/demo-data';
import type { FileSnapshot } from '../lib/types';

vi.mock('../lib/monaco', () => ({ monaco: {} }));

function renderDiff(file: FileSnapshot) {
  return renderToStaticMarkup(<CodeDiff file={file} area="unstaged" worktreeId="test" mode="split" fontSize={13} onModeChange={() => {}} onClose={() => {}} />);
}

function nativeFile(original: string, modified: string): FileSnapshot {
  return {
    id: 'file.ts', path: 'file.ts', language: 'typescript', head: original, index: original, working: modified,
    git: { statusIndex: ' ', statusWorktree: 'M', originalPath: null, conflicted: false },
  };
}

describe('Diff 展示计算预算', () => {
  it('普通真实变更显示准确统计，忽略补丁中的末行换行标记', () => {
    const html = renderDiff(nativeFile('before\nkeep\n', 'after\nkeep\nadded'));
    expect(html).toContain('新增 2 行，删除 1 行');
    expect(html).not.toContain('统计已省略');
  });

  it('大量完全不同的行省略统计并禁用导航，不将超时误报为零处变更', () => {
    const original = Array.from({ length: 5000 }, (_, index) => `before ${index}\n`).join('');
    const modified = Array.from({ length: 5000 }, (_, index) => `after ${index}\n`).join('');
    const html = renderDiff(nativeFile(original, modified));
    expect(html).toContain('统计已省略');
    expect(html).toContain('分块导航不可用');
    expect(html).toMatch(/disabled="" title="上一个变更块"/);
    expect(html).toMatch(/disabled="" title="下一个变更块"/);
    expect(html).not.toContain('新增 0 行，删除 0 行');
  });

  it('示例仓库保持两个独立变更块与导航顺序', () => {
    const html = renderDiff(createDemoRepositories()[0].worktrees[0].files[0]);
    expect(html).toContain('title="当前变更块">1/2');
    expect(html).not.toContain('disabled="" title="下一个变更块"');
    expect(html).not.toContain('统计已省略');
  });
});
