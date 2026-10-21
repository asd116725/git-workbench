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
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CodeDiff } from './components/CodeDiff';
import { BranchPickerDialog } from './components/BranchPickerDialog';
import { ChangeFileTree } from './components/ChangeFileTree';
import { buildChangeTree } from './lib/change-tree';
import { findWorktree, usePreferences, useWorkbench } from './lib/store';
import { startAutoRefresh } from './lib/auto-refresh';
import { getChanges, getFileStatus } from './lib/demo-git';
import type { ChangeArea, Commit, FileSnapshot, Repository, Worktree } from './lib/types';
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

function WorkbenchToolbar({ repository, worktree, onBranchOpen }: { repository: Repository; worktree: Worktree; onBranchOpen: () => void }) {
  const { view, setView, selectWorktree, busy, refreshing, refresh } = useWorkbench();
  const real = worktree.source === 'native';
  return <div className="workbench-toolbar">
    <Tabs value={view} onValueChange={value => setView(value as 'changes' | 'history')} className="view-tabs">
      <TabsList className="view-tabs-list"><TabsTrigger value="changes">本地更改</TabsTrigger><TabsTrigger value="history" disabled={real} title={real ? '真实仓库的历史浏览将在后续版本提供' : undefined}>提交历史</TabsTrigger></TabsList>
    </Tabs>
    <div className="toolbar-actions">
      {real ? <Button variant="outline" size="sm" className="branch-trigger" disabled={busy || refreshing} onClick={onBranchOpen} aria-label={`切换分支：${worktree.branch}`} title="查看和切换分支"><Icon name={worktree.detached ? 'git-commit' : 'git-branch'} /><span className="truncate">{worktree.branch}</span><Icon name="chevron-down" /></Button> : <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="branch-trigger" disabled={busy} title={worktree.path}><Icon name="git-branch" /><span className="truncate">{worktree.branch}</span><Icon name="chevron-down" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuLabel>切换工作区</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuGroup>{repository.worktrees.map(item => <DropdownMenuItem key={item.id} onSelect={() => selectWorktree(item.id)}><Icon name={item.id === worktree.id ? 'check' : 'git-branch'} /><span>{item.branch}</span><span className="menu-detail">{item.name}</span></DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>}
      <Separator orientation="vertical" className="toolbar-separator" />
      {real && <Button variant="ghost" size="sm" disabled={busy || refreshing} onClick={() => void refresh().catch(error => toast.error(errorMessage(error)))}><Icon name="refresh" className={refreshing ? 'spin' : ''} />{refreshing ? '刷新中' : '刷新'}</Button>}
      {([['获取', 'cloud-download'], ['拉取', 'arrow-down'], ['推送', 'arrow-up']] as const).map(([label, icon]) => <Hint key={label} label="远程操作将在后续版本提供"><span><Button variant="ghost" size="sm" className="remote-action" disabled><Icon name={icon} />{label}</Button></span></Hint>)}
    </div>
  </div>;
}

function FileGroup({ worktree, area, disabled }: { worktree: Worktree; area: ChangeArea; disabled: boolean }) {
  const { selection, selectFile, stage, unstage } = useWorkbench();
  const { fileView } = usePreferences();
  const files = useMemo(() => getChanges(worktree, area), [worktree, area]);
  const nodes = useMemo(() => fileView === 'tree' ? buildChangeTree(files) : [], [files, fileView]);
  const label = area === 'unstaged' ? '未暂存' : '已暂存';

  /** 目录按钮仅处理当前分组的后代文件，保留另一分组及同名前缀目录的状态。 */
  function renderBulkAction(path?: string) {
    const targets = path ? files.filter(file => file.path.startsWith(`${path}/`)) : files;
    const actionLabel = `${area === 'unstaged' ? '暂存' : '取消暂存'}${path ? `目录 ${path}` : '全部变更'}`;
    return <Hint label={`${actionLabel}（${targets.length} 个文件）`}><Button variant="ghost" size="icon-sm" className="bulk-stage-action" disabled={disabled || targets.length === 0} aria-label={actionLabel} onClick={() => void (area === 'unstaged' ? stage : unstage)(targets.map(file => file.id)).catch(error => toast.error(errorMessage(error)))}><Icon name={area === 'unstaged' ? 'add' : 'remove'} /></Button></Hint>;
  }

  function renderFile(file: FileSnapshot, depth = 0) {
    const selected = selection?.fileId === file.id && selection.area === area;
    const status = getFileStatus(file, area);
    const actionLabel = `${area === 'unstaged' ? '暂存' : '取消暂存'} ${fileName(file)}`;
    const path = file.git?.originalPath ? `${file.git.originalPath} → ${file.path}` : file.path;
    return <div key={file.id} className={`file-row ${fileView === 'tree' ? 'tree-file-row' : ''} ${selected ? 'selected' : ''}`} style={{ '--file-depth': depth } as CSSProperties}>
      <button className="file-select" onClick={() => selectFile(file.id, area)} aria-pressed={selected} aria-label={`${label}：${file.path}`} title={path}>
        <Icon name="file-code" className={file.language === 'scss' || file.language === 'css' ? 'file-icon-style' : 'file-icon-code'} />
        <span className="file-copy"><span className="file-name">{fileName(file)}</span>{fileView === 'list' && <span className="file-path">{file.git?.originalPath ? path : directory(file)}</span>}</span>
        <span className={`file-status status-${status}`}>{status}</span>
      </button>
      <Hint label={actionLabel}><Button variant={selected ? 'secondary' : 'ghost'} size="icon-sm" className="file-action" disabled={disabled} aria-label={`${area === 'unstaged' ? '暂存' : '取消暂存'} ${file.path}`} onClick={() => void (area === 'unstaged' ? stage(file.id) : unstage(file.id)).catch(error => toast.error(errorMessage(error)))}><Icon name={area === 'unstaged' ? 'add' : 'remove'} /></Button></Hint>
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
  const { drafts, setDraft } = useWorkbench();
  const draft = drafts[worktree.id] ?? { message: '' };
  const stagedCount = getChanges(worktree, 'staged').length;
  const conflicted = worktree.files.some(file => file.git?.conflicted);
  const ready = stagedCount > 0 && draft.message.trim().length > 0 && !busy && !conflicted;
  return <form className="commit-composer" onSubmit={event => { event.preventDefault(); if (ready) void onCommit(); }}>
    <FieldGroup className="commit-fields"><Field><FieldLabel htmlFor="commit-message">提交信息</FieldLabel><Textarea id="commit-message" placeholder={'简要说明这次更改\n\n添加详细说明（可选）'} value={draft.message} disabled={busy} autoComplete="off" onChange={event => setDraft({ message: event.target.value })} /></Field>
    </FieldGroup>
    {conflicted && <p className="commit-warning">请先在编辑器中解决冲突，再暂存对应文件。</p>}
    <Button type="submit" className="commit-button" disabled={!ready}><Icon name={busy ? 'loading' : 'check'} className={busy ? 'spin' : ''} />{busy ? '正在处理…' : `提交 ${stagedCount} 个文件`}</Button>
    <div className="commit-target"><Icon name="git-branch" /><span className="truncate">{worktree.branch}</span><kbd>⌘ ↵</kbd></div>
  </form>;
}

function ChangesView({ worktree, shortcutsEnabled }: { worktree: Worktree; shortcutsEnabled: boolean }) {
  const { selection, closeFile, stageChunk, commit, drafts, busy, refreshing, diff, refresh } = useWorkbench();
  const { fontSize, diffMode, setDiffMode, fileView, setFileView, layout, setLayout } = usePreferences();
  const real = worktree.source === 'native';
  const file = real ? diff.file : worktree.files.find(item => item.id === selection?.fileId) ?? null;
  const changedCount = new Set([...getChanges(worktree, 'unstaged'), ...getChanges(worktree, 'staged')].map(item => item.id)).size;

  async function handleCommit() {
    if (busy || refreshing) return;
    try {
      const hash = await commit();
      toast.success(real ? '提交成功' : '演示提交成功', { description: `${hash.slice(0, 7)} · 已提交暂存内容，未暂存的更改仍然保留。` });
    } catch (error) { toast.error(errorMessage(error)); }
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (!shortcutsEnabled || event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.isComposing) {
        const draft = drafts[worktree.id];
        if (!busy && !refreshing && !worktree.files.some(item => item.git?.conflicted) && draft?.message.trim() && getChanges(worktree, 'staged').length) {
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
        <div className="file-groups"><FileGroup worktree={worktree} area="unstaged" disabled={busy || refreshing} /><FileGroup worktree={worktree} area="staged" disabled={busy || refreshing} /></div>
        <CommitComposer worktree={worktree} busy={busy || refreshing} onCommit={handleCommit} />
      </section>
    </Panel>
    <ResizeHandle className="resize-handle" aria-label="调整变更列表宽度" />
    <Panel id="diff" minSize="420px">
      {real && (diff.loading || diff.notice || diff.error) ? <section className="diff-message" aria-label="代码差异" aria-live="polite"><Icon name={diff.loading ? 'loading' : diff.error ? 'warning' : 'file'} className={diff.loading ? 'spin' : ''} /><h2>{diff.loading ? '正在读取文件差异…' : diff.error ? '无法读取差异' : '文件差异说明'}</h2><p>{diff.error ?? diff.notice}</p>{diff.error && <Button variant="outline" disabled={busy || refreshing} onClick={() => void refresh().catch(error => toast.error(errorMessage(error)))}>重新读取</Button>}</section> : <CodeDiff file={file} area={selection?.area ?? 'unstaged'} worktreeId={worktree.id} fontSize={fontSize} mode={diffMode} onModeChange={setDiffMode} onClose={closeFile} onStageHunk={!real && !busy && file && selection?.area === 'unstaged' ? index => stageChunk(file.id, index) : undefined} />}
    </Panel>
  </Group>;
}

function HistoryView({ worktree }: { worktree: Worktree }) {
  const [selectedId, setSelectedId] = useState(worktree.commits[0]?.id);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const { fontSize, diffMode, setDiffMode } = usePreferences();
  const selected = worktree.commits.find(commit => commit.id === selectedId) ?? worktree.commits[0];
  const file = closed ? null : selected?.files.find(item => item.id === selectedFileId) ?? selected?.files[0] ?? null;
  function selectCommit(commit: Commit) { setSelectedId(commit.id); setSelectedFileId(null); setClosed(false); }
  return <section className="history-view" aria-label="提交历史">
    <div className="history-title"><Icon name="history" /><h1>提交历史</h1><Badge variant="secondary">{worktree.commits.length}</Badge><span>当前工作区 · {worktree.branch}</span></div>
    <div className="history-list" role="list" aria-label="提交记录">{worktree.commits.map(commit => <button key={commit.id} className={`history-row ${selected?.id === commit.id ? 'selected' : ''}`} onClick={() => selectCommit(commit)}>
      <Icon name="git-commit" /><span className="history-message">{commit.message}</span><span>{commit.author}</span><time>{new Date(commit.date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</time><code>{commit.id.slice(0, 7)}</code>
    </button>)}</div>
    {selected ? <><div className="commit-detail"><strong>{selected.message}</strong><span>{selected.author} · {selected.files.length} 个文件 · {selected.id.slice(0, 7)}</span>{selected.description && <p>{selected.description}</p>}</div>
      <div className="history-diff"><div className="history-files"><div className="file-group-heading">变更文件<Badge variant="secondary" className="count-badge">{selected.files.length}</Badge></div>{selected.files.map(item => <button className={`history-file ${file?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => { setSelectedFileId(item.id); setClosed(false); }} title={item.path}><Icon name="file-code" /><span className="truncate">{fileName(item)}</span><span className={`file-status status-${getFileStatus(item, 'staged')}`}>{getFileStatus(item, 'staged')}</span></button>)}</div>
      <CodeDiff file={file} area="staged" worktreeId={`${worktree.id}/history/${selected.id}`} fontSize={fontSize} mode={diffMode} onModeChange={setDiffMode} originalLabel="父提交" modifiedLabel="当前提交" onClose={() => setClosed(true)} /></div></> : <div className="history-empty">还没有提交记录，先完成一次演示提交。</div>}
  </section>;
}

function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { fontSize, setFontSize, resetLayout } = usePreferences();
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>工作台设置</DialogTitle><DialogDescription>调整阅读体验，偏好会保存在当前设备。</DialogDescription></DialogHeader>
    <FieldGroup><Field><FieldLabel htmlFor="font-size">代码字号 <span className="field-value">{fontSize}px</span></FieldLabel><Input id="font-size" type="range" min="11" max="18" step="1" value={fontSize} onChange={event => setFontSize(Number(event.target.value))} /><FieldDescription>应用于并排和内联代码差异视图。</FieldDescription></Field></FieldGroup>
    <Separator /><div className="settings-row"><div><strong>恢复默认布局</strong><p>重置分栏宽度、字号与 Diff 显示方式。</p></div><Button variant="outline" onClick={() => { resetLayout(); onOpenChange(false); toast.success('已恢复默认布局'); }}>恢复</Button></div>
    {!native && <div className="settings-row"><div><strong>重置示例数据</strong><p>恢复最初的文件更改与提交记录。</p></div><Button variant="outline" onClick={() => { useWorkbench.getState().reset(); onOpenChange(false); toast.success('示例数据已重置'); }}>重置</Button></div>}
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
        <WorkbenchToolbar repository={repository} worktree={worktree} onBranchOpen={() => setBranchOpen(true)} />
        {view === 'changes' || real ? <ChangesView key={activeWorktreeId} worktree={worktree} shortcutsEnabled={!settingsOpen && !repositoryOpen && !branchOpen} /> : <HistoryView key={activeWorktreeId} worktree={worktree} />}
        <footer className="statusbar"><span className="status-branch"><Icon name="git-branch" />{worktree.branch}</span><span className="status-divider" /><span>{busy ? 'Git 操作进行中…' : refreshing ? '正在刷新…' : changedCount ? `${changedCount} 个文件有更改` : '工作区干净'}</span><span className={`status-demo ${real ? 'status-native' : ''}`}><Icon name={real ? 'repo' : 'beaker'} />{real ? '本地 Git' : '演示模式'}</span><span className="status-spacer" /><span className="status-path" title={worktree.path}>{worktree.path}</span></footer>
      </> : restoring ? <div className="diff-message" role="status"><Icon name="loading spin" />正在恢复上次打开的仓库…</div> : <WelcomeView onOpen={() => setRepositoryOpen(true)} />}</main></Panel>
    </Group>
    <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} /><OpenRepositoryDialog open={repositoryOpen} onOpenChange={setRepositoryOpen} /><Toaster theme="dark" position="bottom-right" closeButton richColors />
    {branchOpen && worktree && <BranchPickerDialog key={worktree.id} worktree={worktree} open onOpenChange={setBranchOpen} />}
  </div></TooltipProvider>;
}
