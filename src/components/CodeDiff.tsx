import { t, useI18n } from '../lib/i18n';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import { structuredPatch } from 'diff';
import { getDiff, getHunks } from '../lib/demo-git';
import type { ChangeArea, FileSnapshot } from '../lib/types';
import { monaco } from '../lib/monaco';
import { getEditorLanguage } from '../lib/syntax-highlighter';
import { createDiffContentUpdater } from '../lib/diff-content';
import { FileIcon } from './FileIcon';
import './code-diff.css';

/** 差异面板只负责展示与选择，暂存操作交给仓库业务层。 */
export interface CodeDiffProps {
  file: FileSnapshot | null;
  area: ChangeArea;
  worktreeId: string;
  mode: 'split' | 'inline';
  fontSize: number;
  onModeChange: (mode: 'split' | 'inline') => void;
  onStageHunk?: (hunkIndex: number) => void;
  originalLabel?: string;
  modifiedLabel?: string;
  onClose: () => void;
}

function CodeIcon({ name }: { name: string }) {
  return <i className={`codicon codicon-${name}`} aria-hidden="true" />;
}

/** 按比较对象重建编辑器，让卸载生命周期释放旧文件的两个 Monaco 模型。 */
export function CodeDiff(props: CodeDiffProps) {
  useI18n();
  if (!props.file) {
    return (
      <section className="code-diff-root code-diff-empty" aria-label={t("代码差异")}>
        <span className="code-diff-empty-icon"><CodeIcon name="diff" /></span>
        <h2>{t("选择一个文件，查看更改")}</h2>
        <p>{t("在左侧选择未暂存或已暂存的文件")}</p>
        <span className="code-diff-empty-hint">{t("每一次清晰的提交，都从查看差异开始")}</span>
      </section>
    );
  }

  return (
    <ActiveCodeDiff
      key={`${props.worktreeId}:${props.file.id}:${props.area}`}
      {...props}
      file={props.file}
    />
  );
}

function ActiveCodeDiff({
  file,
  area,
  worktreeId,
  mode,
  fontSize,
  onModeChange,
  onStageHunk,
  originalLabel: originalLabelOverride,
  modifiedLabel: modifiedLabelOverride,
  onClose,
}: CodeDiffProps & { file: FileSnapshot }) {
  const { t } = useI18n();
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const contentUpdaterRef = useRef<ReturnType<typeof createDiffContentUpdater> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedHunk, setSelectedHunk] = useState(0);
  const diff = useMemo(() => getDiff(file, area), [file, area]);
  /** 真实文件限制计算预算；从同一补丁派生统计，避免主线程重复计算差异。 */
  const { hunks, stats } = useMemo(() => {
    const hunks = file.git
      ? structuredPatch(file.path, file.path, diff.original, diff.modified, undefined, undefined,
        { context: 3, timeout: 16, maxEditLength: 1024 })?.hunks
      : getHunks(file, area);
    if (!hunks) return { hunks: [], stats: null };
    const stats = { additions: 0, deletions: 0 };
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) stats.additions++;
        else if (line.startsWith('-')) stats.deletions++;
      }
    }
    return { hunks, stats };
  }, [file, area, diff.original, diff.modified]);
  const activeHunk = Math.min(selectedHunk, Math.max(0, hunks.length - 1));
  const pathParts = file.path.split('/').slice(0, -1);
  const fileName = file.path.slice(file.path.lastIndexOf('/') + 1);
  const originalLabel = originalLabelOverride ?? (area === 'staged' ? t("HEAD（上次提交）") : t("暂存区（当前版本）"));
  const modifiedLabel = modifiedLabelOverride ?? (area === 'staged' ? t("暂存区（已暂存的更改）") : t("工作区（未暂存的更改）"));
  const canStageHunk = area === 'unstaged' && onStageHunk !== undefined;
  /** 两侧模型必须使用不同 URI，防止不同 worktree 或暂存状态复用内容。 */
  const modelRoot = `git-workbench://diff/${encodeURIComponent(worktreeId)}/${encodeURIComponent(file.id)}/${area}`;
  const encodedPath = file.path.split('/').map(encodeURIComponent).join('/');
  const originalModelPath = `${modelRoot}/original/${encodedPath}`;
  const modifiedModelPath = `${modelRoot}/modified/${encodedPath}`;
  const language = getEditorLanguage(file.path, file.language);

  const options = useMemo<editor.IDiffEditorConstructionOptions>(() => ({
    readOnly: true,
    originalEditable: false,
    domReadOnly: true,
    automaticLayout: true,
    renderSideBySide: mode === 'split',
    useInlineViewWhenSpaceIsLimited: false,
    renderMarginRevertIcon: false,
    renderGutterMenu: false,
    enableSplitViewResizing: true,
    minimap: { enabled: false },
    /** 使用 VS Code 的平台默认字体与行高；完整显示上下文，便于对照变更。 */
    fontSize,
    lineHeight: 0,
    lineNumbersMinChars: 5,
    lineDecorationsWidth: 10,
    glyphMargin: false,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    padding: { top: 10, bottom: 20 },
    renderLineHighlight: 'none',
    overviewRulerBorder: false,
    fixedOverflowWidgets: true,
    contextmenu: false,
    codeLens: false,
    folding: false,
    links: false,
    matchBrackets: 'never',
    selectionHighlight: false,
    occurrencesHighlight: 'off',
    renderValidationDecorations: 'off',
    stickyScroll: { enabled: false },
    guides: { indentation: false },
    wordWrap: 'off',
    diffWordWrap: 'off',
    ignoreTrimWhitespace: false,
    hideUnchangedRegions: { enabled: false },
    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
    ariaLabel: t("{value1} 的代码差异", { value1: fileName }),
    originalAriaLabel: `${fileName} · ${originalLabel}`,
    modifiedAriaLabel: `${fileName} · ${modifiedLabel}`,
  }), [fileName, fontSize, mode, originalLabel, modifiedLabel, t]);

  /** Monaco 0.57 必须先解绑模型再销毁；组件独占两份模型，StrictMode 重挂载时重新创建。 */
  useLayoutEffect(() => {
    const original = monaco.editor.createModel('', language, monaco.Uri.parse(originalModelPath));
    const modified = monaco.editor.createModel('', language, monaco.Uri.parse(modifiedModelPath));
    const instance = monaco.editor.createDiffEditor(containerRef.current!, {
      automaticLayout: true,
      readOnly: true,
      theme: 'workbench-dark',
    });
    const viewModel = instance.createViewModel({ original, modified });
    instance.setModel(viewModel);
    const contentUpdater = createDiffContentUpdater(instance, viewModel);
    contentUpdaterRef.current = contentUpdater;
    editorRef.current = instance;

    return () => {
      editorRef.current = null;
      contentUpdaterRef.current = null;
      contentUpdater.dispose();
      instance.setModel(null);
      instance.dispose();
      viewModel.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [language, originalModelPath, modifiedModelPath]);

  useLayoutEffect(() => {
    editorRef.current!.updateOptions(options);
  }, [options, language, originalModelPath, modifiedModelPath]);

  useLayoutEffect(() => {
    contentUpdaterRef.current!.update(diff.original, diff.modified);
  }, [diff.original, diff.modified, language, originalModelPath, modifiedModelPath]);

  /** 使用业务层的补丁块索引导航，保证“暂存此块”操作与当前选择一致。 */
  function navigateHunk(direction: -1 | 1) {
    if (hunks.length === 0) return;
    const index = (activeHunk + direction + hunks.length) % hunks.length;
    setSelectedHunk(index);
    const hunk = hunks[index];
    contentUpdaterRef.current?.cancelPendingRestore();
    const instance = editorRef.current;
    instance?.getModifiedEditor().revealLineInCenter(Math.max(1, hunk.newStart));
    instance?.getOriginalEditor().revealLineInCenter(Math.max(1, hunk.oldStart));
  }

  return (
    <section className="code-diff-root" aria-label={t("{value1} 的代码差异", { value1: fileName })}>
      <div className="code-diff-tabs">
        <div className="code-diff-tab">
          <FileIcon path={file.path} language={file.language} />
          <span className="code-diff-tab-name">{fileName}</span>
          <button className="code-diff-icon-button code-diff-close" onClick={onClose} title={t("关闭文件")} aria-label={t("关闭文件")}>
            <CodeIcon name="close" />
          </button>
        </div>
        <span className="code-diff-readonly"><CodeIcon name="lock" />{t("只读")}</span>
      </div>

      <div className="code-diff-toolbar">
        <div className="code-diff-breadcrumb" title={file.path}>
          {pathParts.map((part, index) => (
            <span className="code-diff-breadcrumb-part" key={`${index}-${part}`}>
              {part}<CodeIcon name="chevron-right" />
            </span>
          ))}
          <span className="code-diff-breadcrumb-name">{fileName}</span>
        </div>
        <div className="code-diff-toolbar-actions">
          <div className="code-diff-mode" role="group" aria-label={t("差异显示方式")}>
            <button className={mode === 'split' ? 'is-active' : ''} aria-pressed={mode === 'split'} onClick={() => onModeChange('split')}>{t("并排")}</button>
            <button className={mode === 'inline' ? 'is-active' : ''} aria-pressed={mode === 'inline'} onClick={() => onModeChange('inline')}>{t("内联")}</button>
          </div>
          {stats ? (
            <span className="code-diff-stats" aria-label={t("新增 {value1} 行，删除 {value2} 行", { value1: stats.additions, value2: stats.deletions })}>
              <span className="code-diff-added">+{stats.additions}</span>
              <span className="code-diff-deleted">−{stats.deletions}</span>
            </span>
          ) : <span className="code-diff-stats" title={t("变更较复杂，已省略行数统计与分块导航")}>{t("统计已省略")}</span>}
        </div>
      </div>

      <div className={`code-diff-compare-headings ${mode === 'inline' ? 'code-diff-compare-inline' : ''}`}>
        <div className="code-diff-comparison-label">{mode === 'split' ? originalLabel : `${originalLabel} → ${modifiedLabel}`}</div>
        <div className="code-diff-modified-heading">
          {mode === 'split' && <span className="code-diff-comparison-label">{modifiedLabel}</span>}
          <div className="code-diff-hunk-actions">
            {canStageHunk && (
              <button className="code-diff-stage-button" onClick={() => onStageHunk(activeHunk)} disabled={hunks.length === 0} title={t("暂存第 {value1} 个变更块", { value1: activeHunk + 1 })}>
                <CodeIcon name="git-branch" /><span>{t("暂存此块")}</span>
              </button>
            )}
            <span className="code-diff-hunk-count" title={stats ? t("当前变更块") : t("分块导航不可用")}>{stats ? `${hunks.length ? activeHunk + 1 : 0}/${hunks.length}` : '—'}</span>
            <button className="code-diff-icon-button" onClick={() => navigateHunk(-1)} disabled={hunks.length < 2} title={t("上一个变更块")} aria-label={t("上一个变更块")}><CodeIcon name="arrow-up" /></button>
            <button className="code-diff-icon-button" onClick={() => navigateHunk(1)} disabled={hunks.length < 2} title={t("下一个变更块")} aria-label={t("下一个变更块")}><CodeIcon name="arrow-down" /></button>
          </div>
        </div>
      </div>

      <div className="code-diff-editor" ref={containerRef} />
    </section>
  );
}
