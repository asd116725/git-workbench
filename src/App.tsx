import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { version as appVersion } from '../package.json';
import { isTauri } from '@tauri-apps/api/core';
import { open as chooseDirectory } from '@tauri-apps/plugin-dialog';
import { Group, Panel, Separator as ResizeHandle } from 'react-resizable-panels';
import { toast, Toaster } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CodeDiff } from './components/CodeDiff';
import { HistoryView } from './components/HistoryView';
import { useHistory } from './lib/history-store';
import { BranchPickerDialog } from './components/BranchPickerDialog';
import { MergeBranchDialog } from './components/MergeBranchDialog';
import { MergeStatusBanner } from './components/MergeStatusBanner';
import { RemoteActions } from './components/RemoteActions';
import { ChangeFileTree } from './components/ChangeFileTree';
import { FileIcon } from './components/FileIcon';
import { buildChangeTree } from './lib/change-tree';
import { findWorktree, getMergeMessage, usePreferences, useWorkbench } from './lib/store';
import { commitBlockReason, mergeStartBlockReason } from './lib/merge-view';
import { startAutoRefresh } from './lib/auto-refresh';
import { getChanges, getFileStatus } from './lib/demo-git';
import type { ChangeArea, FileSnapshot, Repository, Worktree } from './lib/types';
import '@vscode/codicons/dist/codicon.css';
import './workbench.css';

const native = isTauri();

function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <i className={`codicon codicon-${name} ${className}`} aria-hidden="true" />;
}

function Hint({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

function fileName(file: FileSnapshot) { return file.path.split('/').pop()!; }
function directory(file: FileSnapshot) { return file.path.split('/').slice(0, -1).join('/') || '仓库根目录'; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function firstAvailableWorktree(repository: Repository) { return repository.worktrees.find(worktree => worktree.available !== false && !worktree.bare); }

function RepositorySidebar({ onOpen, onSettings }: { onOpen: () => void; onSettings: () => void }) {
  const { repositories, activeWorktreeId, selectWorktree, busy } = useWorkbench();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return <aside className="repository-sidebar" aria-label="仓库导航">
    <div className="section-heading"><span>仓库</span><Hint label="打开仓库"><Button variant="ghost" size="icon-sm" aria-label="打开仓库" disabled={busy} onClick={onOpen}><Icon name="add" /></Button></Hint></div>
    <nav className="repositories">
      {repositories.map(repository => {
        const active = repository.worktrees.some(worktree => worktree.id === activeWorktreeId);
        const open = expanded[repository.id] ?? active;
        return <div className="repository-group" key={repository.id}>
          <button className="repository-row" disabled={busy} aria-expanded={open} onClick={() => {
            const first = firstAvailableWorktree(repository);
            if (!active && first) selectWorktree(first.id);
            setExpanded(value => ({ ...value, [repository.id]: active ? !open : true }));
          }}><Icon name={open ? 'chevron-down' : 'chevron-right'} /><Icon name="repo" /><span>{repository.name}</span><small className="repository-worktree-count" title={`${repository.worktrees.length} 个工作区`}>{repository.worktrees.length}</small></button>
          {open && <div className="worktree-list">{repository.worktrees.map(worktree => <button
            key={worktree.id}
            disabled={busy || worktree.available === false || worktree.bare}
            className={`worktree-row ${activeWorktreeId === worktree.id ? 'selected' : ''}`}
            aria-current={activeWorktreeId === worktree.id ? 'page' : undefined}
            onClick={() => selectWorktree(worktree.id)}
            title={[worktree.path, worktree.locked !== undefined && worktree.locked !== null ? `锁定：${worktree.locked || '已锁定'}` : '', worktree.prunable ? `可清理：${worktree.prunable}` : ''].filter(Boolean).join('\n')}
          ><Icon name={worktree.isMain ? 'repo' : 'worktree'} /><span className="worktree-copy"><span>{worktree.name}</span><span className="worktree-branch"><Icon name={worktree.detached ? 'git-commit' : 'git-branch'} />{worktree.bare ? '裸仓库' : worktree.available === false ? '目录不可用' : worktree.branch}</span></span>{worktree.locked !== undefined && worktree.locked !== null && <Icon name="lock" className="worktree-lock" />}</button>)}</div>}
        </div>;
      })}
    </nav>
    <div className="sidebar-bottom">
      <button className="sidebar-action" onClick={onSettings}><Icon name="settings-gear" />设置</button>
      <button className="sidebar-action" disabled={busy} onClick={onOpen}><Icon name="folder-opened" />打开仓库</button>
    </div>
  </aside>;
}

function WorkbenchToolbar({ worktree, onBranchOpen, onMergeOpen }: { worktree: Worktree; onBranchOpen: () => void; onMergeOpen: () => void }) {
  const { view, setView, busy, refreshing, refresh } = useWorkbench();
  const real = worktree.source === 'native';
  const mergeBlocked = mergeStartBlockReason(worktree);
  const historyLoading = useHistory(state => state.sessions[worktree.id]?.loading ?? false);
  const refreshingView = view === 'history' ? historyLoading : refreshing;
  return <div className="workbench-toolbar">
    <Tabs value={view} onValueChange={value => setView(value as 'changes' | 'history')} className="view-tabs">
      <TabsList className="view-tabs-list"><TabsTrigger value="changes">本地更改</TabsTrigger><TabsTrigger value="history">提交历史</TabsTrigger></TabsList>
    </Tabs>
    <div className="toolbar-actions">
      <Button variant="outline" size="sm" className="branch-trigger" disabled={busy || refreshing} onClick={onBranchOpen} aria-label={`管理分支：${worktree.branch}`} title="查看、切换、创建或删除本地分支"><Icon name={worktree.detached ? 'git-commit' : 'git-branch'} /><span className="truncate">{worktree.branch}</span><Icon name="chevron-down" /></Button>
      {real && <Hint label={mergeBlocked ?? `将其他分支合并到 ${worktree.branch}`}><span><Button variant="ghost" size="sm" className="merge-trigger" disabled={busy || refreshing || Boolean(mergeBlocked)} onClick={onMergeOpen}><Icon name="git-merge" />合并</Button></span></Hint>}
      <Separator orientation="vertical" className="toolbar-separator" />
      {(real || view === 'history') && <Button variant="ghost" size="sm" disabled={busy || refreshingView} onClick={() => void (view === 'history' ? useHistory.getState().refresh(worktree) : refresh()).catch(error => toast.error(errorMessage(error)))}><Icon name="refresh" className={refreshingView ? 'spin' : ''} />{refreshingView ? '刷新中' : '刷新'}</Button>}
      <RemoteActions key={`${worktree.id}:${worktree.branch}`} worktree={worktree} />
    </div>
  </div>;
}

function FileGroup({ worktree, area, disabled, conflictsOnly = false }: { worktree: Worktree; area: ChangeArea; disabled: boolean; conflictsOnly?: boolean }) {
  const { selection, selectFile, stage, unstage } = useWorkbench();
  const { fileView } = usePreferences();
  const files = useMemo(() => getChanges(worktree, area).filter(file => Boolean(file.git?.conflicted) === conflictsOnly), [worktree, area, conflictsOnly]);
  const nodes = useMemo(() => fileView === 'tree' ? buildChangeTree(files) : [], [files, fileView]);
  const label = conflictsOnly ? '合并冲突' : area === 'unstaged' ? '未暂存' : '已暂存';

  /** 目录按钮仅处理当前分组的后代文件，保留另一分组及同名前缀目录的状态。 */
  function renderBulkAction(path?: string) {
    if (conflictsOnly) return null;
    const targets = path ? files.filter(file => file.path.startsWith(`${path}/`)) : files;
    const actionLabel = `${area === 'unstaged' ? '暂存' : '取消暂存'}${path ? `目录 ${path}` : '全部变更'}`;
    return <Hint label={`${actionLabel}（${targets.length} 个文件）`}><Button variant="ghost" size="icon-sm" className="bulk-stage-action" disabled={disabled || targets.length === 0} aria-label={actionLabel} onClick={() => void (area === 'unstaged' ? stage : unstage)(targets.map(file => file.id)).catch(error => toast.error(errorMessage(error)))}><Icon name={area === 'unstaged' ? 'add' : 'remove'} /></Button></Hint>;
  }

  function renderFile(file: FileSnapshot, depth = 0) {
    const selected = selection?.fileId === file.id && selection.area === area;
    const status = getFileStatus(file, area);
    const actionLabel = `${conflictsOnly ? '暂存已解决的冲突' : area === 'unstaged' ? '暂存' : '取消暂存'} ${file.path}`;
    const path = file.git?.originalPath ? `${file.git.originalPath} → ${file.path}` : file.path;
    return <div key={file.id} className={`file-row ${fileView === 'tree' ? 'tree-file-row' : ''} ${selected ? 'selected' : ''}`} style={{ '--file-depth': depth } as CSSProperties}>
      <button className="file-select" onClick={() => selectFile(file.id, area)} aria-pressed={selected} aria-label={`${label}：${file.path}`} title={path}>
        <FileIcon path={file.path} language={file.language} />
        <span className="file-copy"><span className="file-name">{fileName(file)}</span>{fileView === 'list' && <span className="file-path">{file.git?.originalPath ? path : directory(file)}</span>}</span>
        <span className={`file-status status-${status}`}>{status}</span>
      </button>
      <Hint label={actionLabel}><Button variant={selected ? 'secondary' : 'ghost'} size="icon-sm" className="file-action" disabled={disabled} aria-label={actionLabel} onClick={() => void (area === 'unstaged' ? stage(file.id) : unstage(file.id)).catch(error => toast.error(errorMessage(error)))}><Icon name={area === 'unstaged' ? 'add' : 'remove'} /></Button></Hint>
    </div>;
  }

  return <Collapsible defaultOpen className="file-group">
    <div className="file-group-header"><CollapsibleTrigger className="file-group-heading"><Icon name="chevron-down" /><span>{label}</span><Badge variant="secondary" className="count-badge">{files.length}</Badge></CollapsibleTrigger>{files.length > 0 && renderBulkAction()}</div>
    <CollapsibleContent>
      {fileView === 'tree' ? <ChangeFileTree nodes={nodes} selectedFileId={selection?.area === area ? selection.fileId : null} renderFile={renderFile} renderDirectoryAction={renderBulkAction} /> : files.map(file => renderFile(file))}
      {files.length === 0 && <p className="empty-group">{area === 'staged' ? '暂存文件后即可提交' : '工作区没有未暂存的更改'}</p>}
    </CollapsibleContent>
  </Collapsible>;
}

function CommitComposer({ worktree, busy, onCommit }: { worktree: Worktree; busy: boolean; onCommit: () => Promise<void> }) {
  const { drafts, setDraft, mergeDrafts, setMergeMessage } = useWorkbench();
  const merging = worktree.operation?.kind === 'merge';
  const message = merging ? getMergeMessage(worktree, mergeDrafts) : drafts[worktree.id]?.message ?? '';
  const stagedCount = getChanges(worktree, 'staged').length;
  const blocked = commitBlockReason(worktree, message);
  const ready = !busy && !blocked;
  return <form className="commit-composer" onSubmit={event => { event.preventDefault(); if (ready) void onCommit(); }}>
    <FieldGroup className="commit-fields"><Field><FieldLabel htmlFor="commit-message">{merging ? '合并提交信息' : '提交信息'}</FieldLabel><Textarea id="commit-message" placeholder={'简要说明这次更改\n\n添加详细说明（可选）'} value={message} disabled={busy || Boolean(worktree.operation && !merging)} autoComplete="off" onChange={event => merging ? setMergeMessage(event.target.value) : setDraft({ message: event.target.value })} /></Field>
    </FieldGroup>
    {blocked && (worktree.operation || worktree.files.some(file => file.git?.conflicted)) && <p className="commit-warning">{blocked}</p>}
    <Button type="submit" className="commit-button" disabled={!ready} title={blocked ?? undefined}><Icon name={busy ? 'loading' : merging ? 'git-merge' : 'check'} className={busy ? 'spin' : ''} />{busy ? '正在处理…' : merging ? '完成合并' : `提交 ${stagedCount} 个文件`}</Button>
    <div className="commit-target"><Icon name="git-branch" /><span className="truncate">{worktree.branch}</span><kbd>⌘ ↵</kbd></div>
  </form>;
}

function ChangesView({ worktree, shortcutsEnabled }: { worktree: Worktree; shortcutsEnabled: boolean }) {
  const { selection, closeFile, stageChunk, commit, continueMerge, mergeDrafts, drafts, busy, refreshing, diff, refresh } = useWorkbench();
  const { fontSize, diffMode, setDiffMode, fileView, setFileView, layout, setLayout } = usePreferences();
  const real = worktree.source === 'native';
  const file = real ? diff.file : worktree.files.find(item => item.id === selection?.fileId) ?? null;
  const changedCount = new Set([...getChanges(worktree, 'unstaged'), ...getChanges(worktree, 'staged')].map(item => item.id)).size;

  async function handleCommit() {
    if (busy || refreshing) return;
    try {
      if (worktree.operation?.kind === 'merge') {
        const result = await continueMerge();
        if (result.outcome !== 'merged') toast.warning(result.outcome === 'conflicts' ? '仍有未解决的冲突' : '合并尚未完成', { description: result.warning ?? '请检查文件和当前合并状态后重试。' });
        else if (result.warning) toast.warning('合并已完成', { description: result.warning });
        else toast.success('合并已完成', { description: result.commitId?.slice(0, 7) });
        return;
      }
      const hash = await commit();
      toast.success(real ? '提交成功' : '演示提交成功', { description: `${hash.slice(0, 7)} · 已提交暂存内容，未暂存的更改仍然保留。` });
    } catch (error) { toast.error(errorMessage(error)); }
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (!shortcutsEnabled || event.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.isComposing) {
        const message = worktree.operation?.kind === 'merge' ? getMergeMessage(worktree, mergeDrafts) : drafts[worktree.id]?.message ?? '';
        if (!busy && !refreshing && !commitBlockReason(worktree, message)) {
          event.preventDefault();
          void handleCommit();
        }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  return <Group orientation="horizontal" className={`changes-view ${busy ? 'is-committing' : ''}`} defaultLayout={layout.changes ? { changes: layout.changes, diff: layout.diff } : undefined} onLayoutChanged={setLayout}>
    <Panel id="changes" defaultSize="24.2%" minSize="270px" maxSize="420px">
      <section className="changes-panel" aria-label="文件变更与提交">
        <div className="changes-heading"><h1>本地更改</h1><Badge variant="secondary" className="count-badge">{changedCount}</Badge><div className="file-view-switch" role="group" aria-label="文件显示方式">{(['tree', 'list'] as const).map(mode => <Hint key={mode} label={mode === 'tree' ? '树形视图' : '列表视图'}><Button variant="ghost" size="icon-xs" aria-label={mode === 'tree' ? '树形视图' : '列表视图'} aria-pressed={fileView === mode} onClick={() => setFileView(mode)}><Icon name={mode === 'tree' ? 'list-tree' : 'list-flat'} /></Button></Hint>)}</div></div>
        <div className="file-groups">{worktree.files.some(file => file.git?.conflicted) && <FileGroup worktree={worktree} area="unstaged" conflictsOnly disabled={busy || refreshing} />}<FileGroup worktree={worktree} area="unstaged" disabled={busy || refreshing} /><FileGroup worktree={worktree} area="staged" disabled={busy || refreshing} /></div>
        <CommitComposer worktree={worktree} busy={busy || refreshing} onCommit={handleCommit} />
      </section>
    </Panel>
    <ResizeHandle className="resize-handle" aria-label="调整变更列表宽度" />
    <Panel id="diff" minSize="420px">
      {real && (diff.loading || diff.notice || diff.error) ? <section className="diff-message" aria-label="代码差异" aria-live="polite"><Icon name={diff.loading ? 'loading' : diff.error ? 'warning' : 'file'} className={diff.loading ? 'spin' : ''} /><h2>{diff.loading ? '正在读取文件差异…' : diff.error ? '无法读取差异' : '文件差异说明'}</h2><p>{diff.error ?? diff.notice}</p>{diff.error && <Button variant="outline" disabled={busy || refreshing} onClick={() => void refresh().catch(error => toast.error(errorMessage(error)))}>重新读取</Button>}</section> : <CodeDiff file={file} area={selection?.area ?? 'unstaged'} worktreeId={worktree.id} fontSize={fontSize} mode={diffMode} onModeChange={setDiffMode} onClose={closeFile} onStageHunk={!real && !busy && file && selection?.area === 'unstaged' ? index => stageChunk(file.id, index) : undefined} />}
    </Panel>
  </Group>;
}

function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { fontSize, setFontSize, resetLayout } = usePreferences();
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>工作台设置</DialogTitle><DialogDescription>调整阅读体验，偏好会保存在当前设备。</DialogDescription></DialogHeader>
    <FieldGroup><Field><FieldLabel htmlFor="font-size">代码字号 <span className="field-value">{fontSize}px</span></FieldLabel><Input id="font-size" type="range" min="11" max="18" step="1" value={fontSize} onChange={event => setFontSize(Number(event.target.value))} /><FieldDescription>应用于并排和内联代码差异视图。</FieldDescription></Field></FieldGroup>
    <Separator /><div className="settings-row"><div><strong>恢复默认布局</strong><p>重置分栏宽度、字号与 Diff 显示方式。</p></div><Button variant="outline" onClick={() => { resetLayout(); onOpenChange(false); toast.success('已恢复默认布局'); }}>恢复</Button></div>
    {!native && <div className="settings-row"><div><strong>重置示例数据</strong><p>恢复最初的文件更改与提交记录。</p></div><Button variant="outline" onClick={() => { useWorkbench.getState().reset(); useHistory.getState().reset(); onOpenChange(false); toast.success('示例数据已重置'); }}>重置</Button></div>}
    <Separator /><div className="settings-row"><div><strong>Git Workbench</strong><p>当前版本</p></div><span>v{appVersion}</span></div>
    <p className="settings-footnote"><Icon name="info" />{native ? '使用系统 Git，提交沿用仓库的作者、签名和 hooks 配置。' : '浏览器为界面演示，真实仓库操作请使用桌面应用。'}</p>
  </DialogContent></Dialog>;
}

function OpenRepositoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { repositories, selectWorktree, activeWorktreeId, openRepository, busy } = useWorkbench();
  const [path, setPath] = useState('');
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);

  async function openPath(repositoryPath: string) {
    setOpeningError(null);
    try {
      await openRepository(repositoryPath);
      onOpenChange(false);
    } catch (error) { setOpeningError(errorMessage(error)); }
  }

  async function browse() {
    setChoosing(true);
    setOpeningError(null);
    try {
      const selected = await chooseDirectory({ directory: true, multiple: false, title: '选择本地 Git 仓库' });
      if (typeof selected === 'string') {
        setPath(selected);
        await openPath(selected);
      }
    } catch (error) { setOpeningError(errorMessage(error)); }
    finally { setChoosing(false); }
  }

  return <Dialog open={open} onOpenChange={value => { if (!busy && !choosing) onOpenChange(value); }}><DialogContent className="open-repository-dialog"><DialogHeader><DialogTitle>{native ? '打开本地仓库' : '打开示例仓库'}</DialogTitle><DialogDescription>{native ? '选择已存在的 Git 仓库或工作区目录，也可以直接输入本地路径。' : '浏览器中使用示例数据。请启动桌面应用以管理本地 Git 仓库。'}</DialogDescription></DialogHeader>
    {native && <form className="repository-open-form" onSubmit={event => { event.preventDefault(); if (path.trim() && !busy && !choosing) void openPath(path.trim()); }}>
      <Field><FieldLabel htmlFor="repository-path">仓库路径</FieldLabel><Input id="repository-path" value={path} onChange={event => setPath(event.target.value)} placeholder="/Users/你的用户名/项目目录" autoComplete="off" spellCheck={false} disabled={busy || choosing} /></Field>
      <div className="repository-open-actions"><Button type="button" variant="outline" disabled={busy || choosing} onClick={() => void browse()}><Icon name="folder-opened" />选择文件夹</Button><Button type="submit" disabled={!path.trim() || busy || choosing}>{busy ? '正在打开…' : '打开仓库'}</Button></div>
      {openingError && <pre className="inline-error" role="alert">{openingError}</pre>}
    </form>}
    {repositories.length > 0 && <div className="repository-picker"><p className="picker-label">已打开的仓库</p>{repositories.map(repository => {
      const target = repository.worktrees.find(item => item.id === activeWorktreeId && item.available !== false && !item.bare) ?? firstAvailableWorktree(repository);
      return <button className="picker-row" disabled={busy || choosing || !target} key={repository.id} onClick={() => { if (target) selectWorktree(target.id); onOpenChange(false); }}><Icon name="repo" /><span><strong>{repository.name}</strong><small title={target?.path}>{target?.path ?? '工作区目录不可用'} · {repository.worktrees.length} 个工作区</small></span><Icon name={repository.worktrees.some(item => item.id === activeWorktreeId) ? 'check' : 'chevron-right'} /></button>;
    })}</div>}
  </DialogContent></Dialog>;
}

function WelcomeView({ onOpen }: { onOpen: () => void }) {
  return <div className="welcome-view"><span className="welcome-icon"><Icon name="source-control" /></span><span className="welcome-eyebrow">GIT WORKBENCH</span><h1>从一个本地仓库开始</h1><p>查看代码差异，整理暂存区，完成每一次提交。</p><Button size="lg" onClick={onOpen}><Icon name="folder-opened" />打开本地仓库</Button><span className="welcome-note">支持现有 Git 仓库与 Worktree</span></div>;
}

export default function App() {
  const { repositories, activeWorktreeId, view, busy, restoring, refreshing, error, autoRefreshError } = useWorkbench();
  const { layout, setLayout, layoutResetKey } = usePreferences();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const repository = repositories.find(item => item.worktrees.some(worktree => worktree.id === activeWorktreeId));
  const worktree = findWorktree(repositories, activeWorktreeId);
  const changedCount = worktree ? new Set([...getChanges(worktree, 'unstaged'), ...getChanges(worktree, 'staged')].map(item => item.id)).size : 0;
  const real = worktree?.source === 'native';

  useEffect(() => { void useWorkbench.getState().restoreSession(); }, []);
  useEffect(() => startAutoRefresh(), []);

  return <TooltipProvider delayDuration={400}><div className={`workbench ${native ? 'native-window' : 'browser-window'}`}>
    <header className="titlebar" data-tauri-drag-region><div className="app-title" data-tauri-drag-region>{!native && <Icon name="source-control" />}代码管理</div><div className="window-context" data-tauri-drag-region>{repository?.name ?? '本地 Git 工作台'}{worktree && <><span>/</span>{worktree.branch}</>}</div><span className="titlebar-version">Git Workbench</span></header>
    <Group key={layoutResetKey} orientation="horizontal" className="app-body" defaultLayout={layout.repositories ? { repositories: layout.repositories, workspace: layout.workspace } : undefined} onLayoutChanged={setLayout}>
      <Panel id="repositories" defaultSize="15%" minSize="190px" maxSize="320px"><RepositorySidebar onOpen={() => setRepositoryOpen(true)} onSettings={() => setSettingsOpen(true)} /></Panel>
      <ResizeHandle className="resize-handle" aria-label="调整仓库列表宽度" />
      <Panel id="workspace" minSize="850px"><main className="workspace">
        {error && <div className="git-error" role="alert"><Icon name="warning" /><pre>{error}</pre></div>}
        {autoRefreshError && <div className="git-error" role="status"><Icon name="warning" /><pre>{autoRefreshError}</pre></div>}
        {repository && worktree ? <>
        <WorkbenchToolbar worktree={worktree} onBranchOpen={() => setBranchOpen(true)} onMergeOpen={() => setMergeOpen(true)} />
        {worktree.operation && <MergeStatusBanner key={`${worktree.id}:${worktree.operation.kind}:${worktree.operation.head}:${worktree.operation.mergeHeads.join(',')}`} worktree={worktree} />}
        {view === 'changes' ? <ChangesView key={activeWorktreeId} worktree={worktree} shortcutsEnabled={!settingsOpen && !repositoryOpen && !branchOpen && !mergeOpen} /> : <HistoryView key={activeWorktreeId} worktree={worktree} />}
        <footer className="statusbar"><span className="status-branch"><Icon name="git-branch" />{worktree.branch}</span><span className="status-divider" /><span>{view === 'history' ? '历史只读' : busy ? 'Git 操作进行中…' : refreshing ? '正在刷新…' : changedCount ? `${changedCount} 个文件有更改` : '工作区干净'}</span><span className={`status-demo ${real ? 'status-native' : ''}`}><Icon name={real ? 'repo' : 'beaker'} />{real ? '本地 Git' : '演示模式'}</span><span className="status-spacer" /><span className="status-path" title={worktree.path}>{worktree.path}</span></footer>
      </> : restoring ? <div className="diff-message" role="status"><Icon name="loading spin" />正在恢复上次打开的仓库…</div> : <WelcomeView onOpen={() => setRepositoryOpen(true)} />}</main></Panel>
    </Group>
    <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} /><OpenRepositoryDialog open={repositoryOpen} onOpenChange={setRepositoryOpen} /><Toaster theme="dark" position="bottom-right" closeButton richColors />
    {branchOpen && worktree && <BranchPickerDialog key={worktree.id} worktree={worktree} open onOpenChange={setBranchOpen} />}
    {mergeOpen && worktree && <MergeBranchDialog key={worktree.id} worktree={worktree} open onOpenChange={setMergeOpen} />}
  </div></TooltipProvider>;
}
