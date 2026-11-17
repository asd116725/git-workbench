import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { editor } from 'monaco-editor';
import { monaco } from '../lib/monaco';
import { editorThemes, useAppearance } from '../lib/appearance';
import { getEditorLanguage } from '../lib/syntax-highlighter';
import { findConflictBlocks } from '../lib/conflict-markers';
import { t, useI18n } from '../lib/i18n';
import { translateMessage } from '../lib/i18n-system';
import type { ConflictPreview, FileSnapshot } from '../lib/types';
import './conflict-content.css';

/** 冲突预览只读；Git 索引是否未合并与工作区是否仍有标记分别呈现。 */
export function ConflictContent({ file, preview, sideLabels, worktreeId, fontSize, children }: {
  file: FileSnapshot;
  preview: ConflictPreview;
  sideLabels: Record<'ours' | 'theirs', string>;
  worktreeId: string;
  fontSize: number;
  children: ReactNode;
}) {
  useI18n();
  const [view, setView] = useState<'working' | 'sides'>('working');
  const [selected, setSelected] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<editor.IEditorDecorationsCollection | null>(null);
  const initialized = useRef(false);
  const text = preview.working.text;
  const blocks = useMemo(() => findConflictBlocks(text ?? '', preview.markerSize), [text, preview.markerSize]);
  const active = Math.min(selected, Math.max(0, blocks.length - 1));
  const language = getEditorLanguage(file.path, file.language);
  const modelPath = `git-workbench://conflict/${encodeURIComponent(worktreeId)}/${encodeURIComponent(file.id)}`;
  const readable = text !== null;

  useLayoutEffect(() => {
    if (view !== 'working' || !readable) return;
    const model = monaco.editor.createModel('', language, monaco.Uri.parse(modelPath));
    const current = monaco.editor.create(container.current!, {
      model, readOnly: true, domReadOnly: true, automaticLayout: true,
      theme: editorThemes[useAppearance.getState().resolvedTheme],
      minimap: { enabled: false }, scrollBeyondLastLine: false, contextmenu: false,
      renderLineHighlight: 'none', folding: false, links: false, stickyScroll: { enabled: false },
      padding: { top: 10, bottom: 20 }, overviewRulerBorder: false,
    });
    instance.current = current;
    decorations.current = current.createDecorationsCollection();
    initialized.current = false;
    return () => {
      instance.current = null;
      decorations.current = null;
      current.setModel(null);
      current.dispose();
      model.dispose();
    };
  }, [view, readable, language, modelPath]);

  useLayoutEffect(() => {
    instance.current?.updateOptions({ fontSize, ariaLabel: t('工作区冲突内容') });
  }, [fontSize, view, readable, language, modelPath]);

  /** 外部编辑后保留阅读位置；首次进入自动定位首个完整冲突块。 */
  useLayoutEffect(() => {
    const current = instance.current;
    if (!current || text === null) return;
    const state = current.saveViewState();
    if (current.getValue() !== text) current.setValue(text);
    const ranges: editor.IModelDeltaDecoration[] = [];
    function highlight(start: number, end: number, className: string) {
      if (end < start) return;
      ranges.push({ range: new monaco.Range(start, 1, end, 1), options: { isWholeLine: true, className } });
    }
    for (const block of blocks) {
      highlight(block.start, (block.base ?? block.separator) - 1, 'conflict-lines-ours');
      if (block.base) highlight(block.base, block.separator - 1, 'conflict-lines-base');
      highlight(block.separator, block.end, 'conflict-lines-theirs');
      for (const line of [block.start, block.base, block.separator, block.end]) {
        if (line) highlight(line, line, 'conflict-marker-line');
      }
    }
    decorations.current?.set(ranges);
    if (initialized.current && state) current.restoreViewState(state);
    else if (blocks.length) current.revealLineInCenter(blocks[0].start);
    initialized.current = true;
  }, [text, blocks, view, readable, language, modelPath]);

  function navigate(direction: -1 | 1) {
    const next = (active + direction + blocks.length) % blocks.length;
    setSelected(next);
    instance.current?.revealLineInCenter(blocks[next].start);
    instance.current?.setPosition({ lineNumber: blocks[next].start, column: 1 });
  }

  return <>
    <div className="conflict-toolbar">
      <span className="conflict-status"><i className="codicon codicon-warning" aria-hidden="true" />{t('未合并')}</span>
      <div className="code-diff-mode" role="group" aria-label={t('冲突查看方式')}>
        <button className={view === 'working' ? 'is-active' : ''} aria-pressed={view === 'working'} onClick={() => { if (view !== 'working') { setSelected(0); setView('working'); } }}>{t('冲突位置')}</button>
        <button className={view === 'sides' ? 'is-active' : ''} aria-pressed={view === 'sides'} onClick={() => setView('sides')}>{t('双方对照')}</button>
      </div>
    </div>
    <p className="conflict-help">{t('只读查看；请在外部编辑器中解决冲突，然后暂存文件。')}</p>
    {view === 'working' ? <>
      {text !== null ? <>
        <div className="conflict-navigation">
          <span>{blocks.length ? t('{count} 处冲突', { count: blocks.length }) : t('无文本冲突标记')}</span>
          <div>
            <span aria-live="polite">{blocks.length ? `${active + 1}/${blocks.length}` : '0/0'}</span>
            <button className="code-diff-icon-button" disabled={!blocks.length} onClick={() => navigate(-1)} title={t('上一个冲突')} aria-label={t('上一个冲突')}><i className="codicon codicon-arrow-up" aria-hidden="true" /></button>
            <button className="code-diff-icon-button" disabled={!blocks.length} onClick={() => navigate(1)} title={t('下一个冲突')} aria-label={t('下一个冲突')}><i className="codicon codicon-arrow-down" aria-hidden="true" /></button>
          </div>
        </div>
        {blocks.length ? <div className="conflict-legend"><span>{t('当前侧（ours）')}</span><span>{t('另一侧（theirs）')}</span>{blocks.some(block => block.base) && <span>{t('共同祖先')}</span>}</div>
          : <p className="conflict-help" role="status">{t('未发现文本冲突标记，Git 仍记录此文件未合并。')}</p>}
        <div className="code-diff-editor conflict-editor" ref={container} />
      </> : <div className="conflict-unavailable" role="status">{preview.working.notice ? translateMessage(preview.working.notice) : t('工作区文件不存在。')}<p>{t('可切换到“双方对照”查看冲突版本。')}</p></div>}
    </> : <>
      <p className="conflict-help">{t('此处比较 Git 的 ours / theirs 版本；变基时 ours 为变基目标，theirs 为正在重放的提交。')}</p>
      {preview.ours.notice || preview.theirs.notice ? <div className="conflict-side-notices">
        {(['ours', 'theirs'] as const).map(side => <div key={side}><strong>{sideLabels[side]}</strong><p>{preview[side].notice ? translateMessage(preview[side].notice!) : t('另一侧无法作为文本对照，请在外部编辑器中查看。')}</p></div>)}
      </div> : children}
    </>}
  </>;
}
