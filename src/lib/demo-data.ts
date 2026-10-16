import type { Commit, FileSnapshot, Repository } from './types';

const markdownControlHead = `import React, { useCallback, useRef } from 'react';
import { FormItem, render as renderPreview } from '@demo/runtime';
import type { FormControlProps } from '@demo/core';
import { Button, Modal, Tabs, Tab } from '@demo/ui';
import { MarkdownEditor } from './MarkdownEditor';

/** Markdown 编辑器的表单属性。 */
export interface MarkdownControlProps extends FormControlProps {
  placeholder?: string;
  minHeight?: number;
  enablePreview?: boolean;
}

/** 在表单内编辑 Markdown，并同步更新预览内容。 */
export function MarkdownControl(props: MarkdownControlProps) {
  const {
    value = '',
    onChange,
    disabled,
    placeholder = '输入 Markdown 内容…',
    minHeight = 320,
    enablePreview = true,
  } = props;

  const editorRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const handleChange = useCallback((nextValue: string) => {
    if (disabled) return;
    onChange(nextValue);
  }, [disabled, onChange]);

  const renderToolbar = () => (
    <div className="markdown-toolbar">
      <Button icon="fa fa-bold" tooltip="加粗" />
      <Button icon="fa fa-italic" tooltip="斜体" />
      <Button icon="fa fa-link" tooltip="插入链接" />
      <span className="markdown-toolbar-divider" />
      <Button icon="fa fa-image" tooltip="插入图片" />
    </div>
  );

  return (
    <div className="markdown-control">
      {renderToolbar()}
      <div className="markdown-editor" ref={editorRef}>
        <MarkdownEditor
          value={value}
          onChange={handleChange}
          disabled={disabled}
          placeholder={placeholder}
          minHeight={minHeight}
        />
      </div>
      {enablePreview && (
        <div className="markdown-preview" ref={previewRef}>
          {renderPreview({ type: 'markdown', value })}
        </div>
      )}
    </div>
  );
}

FormItem({ type: 'markdown-editor' })(MarkdownControl);
`;

const markdownControlWorking = markdownControlHead
  .replace("import { MarkdownEditor } from './MarkdownEditor';", "import { MarkdownEditor } from './MarkdownEditor';\nimport { useMarkdownScrollSync } from './useMarkdownScrollSync';")
  .replace('  return (\n    <div className="markdown-control">', `  const { handleEditorScroll, handlePreviewScroll } = useMarkdownScrollSync({
    editorRef,
    previewRef,
    enabled: enablePreview,
  });

  return (
    <div className="markdown-control markdown-control--split">`)
  .replace('<div className="markdown-editor" ref={editorRef}>', '<div className="markdown-editor" ref={editorRef} onScroll={handleEditorScroll}>')
  .replace('          minHeight={minHeight}', '          className="markdown-editor-content"\n          minHeight={minHeight}')
  .replace('<div className="markdown-preview" ref={previewRef}>', '<div className="markdown-preview" ref={previewRef} onScroll={handlePreviewScroll}>');

const scrollSync = `import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';

/** 绑定编辑区与预览区的滚动容器。 */
interface ScrollSyncOptions {
  editorRef: RefObject<HTMLDivElement | null>;
  previewRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
}

/** 按可滚动距离同步位置，避免双方滚动事件循环触发。 */
export function useMarkdownScrollSync(options: ScrollSyncOptions) {
  const syncingRef = useRef(false);
  const { editorRef, previewRef, enabled } = options;

  const syncScroll = useCallback((source: HTMLElement, target: HTMLElement) => {
    if (!enabled || syncingRef.current) return;
    syncingRef.current = true;
    const distance = source.scrollHeight - source.clientHeight;
    const progress = distance > 0 ? source.scrollTop / distance : 0;
    target.scrollTop = progress * (target.scrollHeight - target.clientHeight);
    requestAnimationFrame(() => { syncingRef.current = false; });
  }, [enabled]);

  return {
    handleEditorScroll: () => {
      if (editorRef.current && previewRef.current) {
        syncScroll(editorRef.current, previewRef.current);
      }
    },
    handlePreviewScroll: () => {
      if (editorRef.current && previewRef.current) {
        syncScroll(previewRef.current, editorRef.current);
      }
    },
  };
}
`;

const markdownHead = `import React from 'react';
import { renderMarkdown } from '../utils/markdown';

/** 展示 Markdown 渲染结果。 */
export function Markdown({ value }: { value: string }) {
  const html = renderMarkdown(value);
  return <article className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
`;

const markdownWorking = `import React from 'react';
import { renderMarkdown } from '../utils/markdown';
import { buildMarkdownScrollSource } from '../utils/markdownScrollSource';

/** 保留源行映射，让预览区滚动与编辑内容对应。 */
export function Markdown({ value }: { value: string }) {
  const source = buildMarkdownScrollSource(value);
  const html = renderMarkdown(source);
  return <article className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
`;

const styleHead = `.markdown-control {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.markdown-preview {
  padding: 16px;
  overflow: auto;
}
`;

const styleWorking = `${styleHead}
.markdown-control--split {
  display: grid;
  grid-template-columns: 1fr 1fr;

  .markdown-toolbar {
    grid-column: 1 / -1;
  }

  .markdown-editor,
  .markdown-preview {
    max-height: 640px;
    overscroll-behavior: contain;
  }
}
`;

const scrollSyncTest = `import { describe, expect, it } from 'vitest';
import { getScrollProgress } from '../src/utils/markdownScrollSource';

describe('Markdown 编辑预览滚动同步', () => {
  it('按可滚动距离计算比例', () => {
    expect(getScrollProgress({ scrollTop: 200, scrollHeight: 800, clientHeight: 400 })).toBe(0.5);
  });

  it('内容未超出容器时保持顶部', () => {
    expect(getScrollProgress({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 })).toBe(0);
  });
});
`;

const scrollSourceTest = `import { describe, expect, it } from 'vitest';
import { buildMarkdownScrollSource } from '../src/utils/markdownScrollSource';

describe('Markdown 源行映射', () => {
  it('给段落添加源行信息', () => {
    const source = buildMarkdownScrollSource('# 标题\\n\\n正文');
    expect(source).toContain('data-source-line="1"');
    expect(source).toContain('data-source-line="3"');
  });
});
`;

function modifiedFile(id: string, path: string, language: string, head: string, working: string): FileSnapshot {
  return { id, path, language, head, index: head, working };
}

function addedFile(id: string, path: string, content: string): FileSnapshot {
  return { id, path, language: 'typescript', head: null, index: content, working: content };
}

function createHistory(files: FileSnapshot[]): Commit[] {
  return [
    { id: 'a1b2c3d4', message: 'feat(preview): 添加预览模式配置', description: '虚构演示提交：允许按需启用预览模式。', author: 'Demo User', date: '2026-10-14T08:54:00+08:00', files: [{ id: 'history-preview', path: 'packages/editor/src/component/PreviewOptions.tsx', language: 'typescript', head: 'const previewMode = false;\n', index: 'const previewMode = true;\n', working: 'const previewMode = true;\n' }] },
    { id: 'b2c3d4e5', message: 'feat(editor): 添加示例 Markdown 面板', description: '', author: 'Demo User', date: '2026-10-13T17:32:00+08:00', files: files.slice(0, 1).map((file) => ({ ...file, head: null, index: file.head, working: file.head })) },
    { id: 'c3d4e5f6', message: 'test: 配置示例测试环境', description: '', author: 'Example Contributor', date: '2026-10-12T14:06:00+08:00', files: [{ id: 'history-config', path: 'vitest.config.ts', language: 'typescript', head: 'export default { test: {} };\n', index: "export default { test: { environment: 'jsdom' } };\n", working: "export default { test: { environment: 'jsdom' } };\n" }] },
  ];
}

/** 每次返回独立示例快照，重置时不会保留上一次演示的修改。 */
export function createDemoRepositories(): Repository[] {
  const markdownFiles: FileSnapshot[] = [
    modifiedFile('markdown-control', 'packages/editor/src/renderer/markdown/MarkdownControl.tsx', 'typescript', markdownControlHead, markdownControlWorking),
    modifiedFile('markdown-ui', 'packages/ui/src/components/Markdown.tsx', 'typescript', markdownHead, markdownWorking),
    modifiedFile('markdown-style', 'packages/ui/scss/components/markdown.scss', 'scss', styleHead, styleWorking),
    addedFile('scroll-sync', 'packages/editor/src/renderer/markdown/useMarkdownScrollSync.ts', scrollSync),
    addedFile('scroll-sync-test', 'packages/editor/__tests__/MarkdownScrollSync.test.tsx', scrollSyncTest),
    addedFile('scroll-source-test', 'packages/ui/__tests__/MarkdownScrollSource.test.tsx', scrollSourceTest),
  ];
  const grayFiles = [modifiedFile('preview-panel', 'packages/editor/src/component/PreviewPanel.tsx', 'typescript', 'export const previewOptions = { autoRefresh: false };\n', 'export const previewOptions = { autoRefresh: true };\n')];
  const materialFiles = [modifiedFile('material-title', 'src/components/material/MaterialCard.tsx', 'typescript', "export const getTitle = (material: Material) => material.name;\n", "export const getTitle = (material: Material) => material.title || material.name;\n")];
  const mirrorFiles = [modifiedFile('mirror-surface', 'src/components/WindowLayout.tsx', 'typescript', 'export const windowStyle = { width: 360, height: 640 };\n', "export const windowStyle = { width: '100%', height: '100%', objectFit: 'contain' };\n")];
  return [
    {
      id: 'demo-editor', name: 'demo-editor', worktrees: [
        { id: 'editor-main', name: '主工作区', branch: 'feature/markdown', path: '~/Projects/demo-editor', files: markdownFiles, commits: createHistory(markdownFiles) },
        { id: 'editor-preview', name: 'preview', branch: 'feature/preview', path: '~/Projects/demo-editor-preview', files: grayFiles, commits: createHistory(grayFiles) },
        { id: 'editor-docs', name: 'docs', branch: 'docs/guide', path: '~/Projects/demo-editor-docs', files: [], commits: createHistory(markdownFiles) },
      ],
    },
    { id: 'demo-dashboard', name: 'demo-dashboard', worktrees: [{ id: 'dashboard-main', name: 'demo-dashboard', branch: 'feature/material', path: '~/Projects/demo-dashboard', files: materialFiles, commits: [{ id: 'd4e5f6a7', message: 'feat(cards): 展示演示卡片标题', description: '', author: 'Demo User', date: '2026-10-13T10:20:00+08:00', files: materialFiles.map((file) => ({ ...file, index: file.working })) }] }] },
    { id: 'demo-desktop', name: 'demo-desktop', worktrees: [{ id: 'desktop-main', name: 'demo-desktop', branch: 'main', path: '~/Projects/demo-desktop', files: mirrorFiles, commits: [{ id: 'e5f6a7b8', message: 'style(window): 调整示例窗口布局', description: '', author: 'Demo User', date: '2026-10-12T16:45:00+08:00', files: mirrorFiles.map((file) => ({ ...file, index: file.working })) }] }] },
  ];
}
