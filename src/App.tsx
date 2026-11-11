import { useAppearance } from './lib/appearance';
import { startNativeAppearance } from './lib/native-appearance';
import { AppearancePicker } from './components/AppearancePicker';
import { languages, t, useI18n, type Language } from './lib/i18n';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { translateMessage } from './lib/i18n-system';
import { version as appVersion } from '../package.json';
import { isTauri } from '@tauri-apps/api/core';
import { open as chooseDirectory } from '@tauri-apps/plugin-dialog';
import { Group, Panel, Separator as ResizeHandle, usePanelRef } from 'react-resizable-panels';
import { PanelLeft, PanelRight } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CodeDiff } from './components/CodeDiff';
import { CommitComposer } from './components/CommitComposer';
import { HistoryView } from './components/HistoryView';
import { useHistory } from './lib/history-store';
import { BranchPickerDialog } from './components/BranchPickerDialog';
import { RenameDialog, type RenameTarget } from './components/RenameDialog';
import { useDisplayNames } from './lib/display-names';
import { orderedItems, useSidebarOrder, type SortEdge, type SortScope } from './lib/sidebar-order';
import { useSidebarSorting } from './components/useSidebarSorting';
import { BranchSyncCounts } from './components/BranchSyncStatus';
import { MergeBranchDialog } from './components/MergeBranchDialog';
import { MergeStatusBanner } from './components/MergeStatusBanner';
import { RemoteActions } from './components/RemoteActions';
import { DiscardChangesDialog } from './components/DiscardChangesDialog';
import { isUntrackedChange } from './lib/discard';
import { ChangeFileTree } from './components/ChangeFileTree';
import { FileIcon } from './components/FileIcon';
import { branchLabel, worktreeLabel, worktreeSyncDescription } from './components/branch-display';
import { buildChangeTree } from './lib/change-tree';
import { findWorktree, getMergeMessage, usePreferences, useWorkbench } from './lib/store';
import { commitBlockReason, mergeStartBlockReason } from './lib/merge-view';
import { startAutoRefresh } from './lib/auto-refresh';
import { getChanges, getFileStatus } from './lib/demo-git';
import type { ChangeArea, FileSnapshot, Repository, Worktree } from './lib/types';
import '@vscode/codicons/dist/codicon.css';
import './workbench.css';
import './appearance.css';

const native = isTauri();

function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <i className={`codicon codicon-${name} ${className}`} aria-hidden="true" />;
}

function Hint({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

function fileName(file: FileSnapshot) { return file.path.split('/').pop()!; }
function directory(file: FileSnapshot) { return file.path.split('/').slice(0, -1).join('/') || t("仓库根目录"); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function firstAvailableWorktree(repository: Repository) { return repository.worktrees.find(worktree => worktree.available !== false && !worktree.bare); }

/** 仓库展开只由箭头控制，名称与工作区按钮只负责选择。 */
function RepositorySidebar({ onOpen, onSettings, onMove }: { onOpen: () => void; onSettings: () => void; onMove: () => void }) {
  useI18n();
  const { repositories, activeWorktreeId, selectWorktree, busy } = useWorkbench();
  const { sidebarSide, sidebarCollapsed, sidebarWidth, setSidebarCollapsed } = usePreferences();
  const names = useDisplayNames(state => state.names);
  const order = useSidebarOrder(state => state.order);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [sortAnnouncement, setSortAnnouncement] = useState('');
  const orderErrorShown = useRef(false);
  const sortedRepositories = orderedItems(repositories, order.projects);
  const repositoryIds = sortedRepositories.map(item => item.id);
  const sorting = useSidebarSorting(busy, moveItem);
  const toggleLabel = t(sidebarCollapsed ? '展开仓库栏' : '收起仓库栏');
  const SidebarIcon = sidebarSide === 'left' ? PanelLeft : PanelRight;

  useEffect(() => {
    try { useSidebarOrder.getState().observe(repositories); }
    catch {
      if (!orderErrorShown.current) {
        toast.error(t('排序保存失败，请重试。'));
        orderErrorShown.current = true;
      }
    }
  }, [repositories]);

  /** 以最新元数据限定同一列表，避免刷新期间的过期拖动跨组或恢复已删除项。 */
  function moveItem(scope: SortScope, source: string, target: string, edge: SortEdge) {
    const currentRepositories = useWorkbench.getState().repositories;
    const { order: currentOrder, move } = useSidebarOrder.getState();
    const items = scope === null ? currentRepositories : currentRepositories.find(item => item.id === scope)?.worktrees ?? [];
    const ids = orderedItems<{ id: string }>(items, scope === null ? currentOrder.projects : currentOrder.worktrees[scope]).map(item => item.id);
    try {
      if (move(scope, ids, source, target, edge)) {
        const saved = useSidebarOrder.getState().order;
        const position = orderedItems<{ id: string }>(items, scope === null ? saved.projects : saved.worktrees[scope]).findIndex(item => item.id === source) + 1;
        setSortAnnouncement(t('已移至第 {position} 位', { position }));
      }
    } catch { toast.error(t('排序保存失败，请重试。')); }
  }

  function sortHandle(scope: SortScope, id: string, name: string, ids: string[]) {
    const label = t(scope === null ? '调整项目 {name} 的顺序' : '调整工作树 {name} 的顺序', { name });
    return <Button variant="ghost" size="icon-xs" className="sidebar-sort-handle" aria-label={label} title={t('拖动排序，或按 ↑ / ↓ 调整')} {...sorting.handleProps(scope, id, ids)}><Icon name="gripper" /></Button>;
  }

  function renameButton(id: string, kind: RenameTarget['kind'], defaultName: string) {
    const label = kind === 'project' ? t('修改项目名称') : kind === 'main' ? t('修改主工作区名称') : t('修改工作树名称');
    return <Hint label={label}><Button variant="ghost" size="icon-xs" className="name-edit-button" disabled={busy} aria-label={label} onClick={event => setRenameTarget({ id, kind, defaultName, name: names[id] ?? defaultName, customized: names[id] !== undefined, trigger: event.currentTarget })}><Icon name="edit" /></Button></Hint>;
  }

  return <aside className={`repository-sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`} style={{ '--repository-expanded-width': `${sidebarWidth}px` } as CSSProperties} aria-label={t("仓库导航")}>
    <div className="section-heading repository-heading"><span className="repository-heading-title">{t("仓库")}</span><div className="repository-heading-actions">
      <Hint label={t("打开仓库")}><Button variant="ghost" size="icon-sm" className="repository-heading-open" aria-label={t("打开仓库")} disabled={busy} onClick={onOpen}><Icon name="add" /></Button></Hint>
      <DropdownMenu>
        <Hint label={t('仓库栏选项')}><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="repository-heading-menu" aria-label={t('仓库栏选项')}><Icon name="ellipsis" /></Button></DropdownMenuTrigger></Hint>
        <DropdownMenuContent align="end" className="repository-layout-menu">
          <DropdownMenuItem onSelect={onMove}><Icon name={sidebarSide === 'left' ? 'arrow-right' : 'arrow-left'} />{t(sidebarSide === 'left' ? '移至右侧面板' : '移至左侧面板')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Hint label={toggleLabel}><Button variant="ghost" size="icon-sm" aria-label={toggleLabel} aria-expanded={!sidebarCollapsed} aria-controls="repository-tree" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}><SidebarIcon aria-hidden="true" /></Button></Hint>
    </div></div>
    <nav id="repository-tree" className="repositories" inert={sidebarCollapsed} aria-hidden={sidebarCollapsed}>
      {sortedRepositories.map(repository => {
        const active = repository.worktrees.some(worktree => worktree.id === activeWorktreeId);
        const name = names[repository.id] ?? repository.name;
        const worktrees = orderedItems(repository.worktrees, order.worktrees[repository.id]);
        const worktreeIds = worktrees.map(item => item.id);
        return <Collapsible className={`repository-group${active ? ' contains-current' : ''}`} defaultOpen={active} key={repository.id} {...sorting.rowProps(null, repository.id)}>
          <div className="repository-row">
            <CollapsibleTrigger className="repository-toggle" aria-label={t("展开或收起仓库 {name}", { name })}><Icon name="chevron-down" /></CollapsibleTrigger>
            <button className="repository-select" disabled={busy} aria-label={t("选择仓库 {name}", { name })} title={name} onClick={() => {
              const first = firstAvailableWorktree(repository);
              if (!active && first) selectWorktree(first.id);
            }}><span className="repository-icon"><Icon name="folder" /><Icon name="folder-opened" /></span><span className="repository-name">{name}</span><small className="repository-worktree-count" title={t("{value1} 个工作区", { value1: repository.worktrees.length })}><span className="repository-count-label">{t(repository.worktrees.length === 1 ? "1 工作树" : "{count} 工作树", { count: repository.worktrees.length })}</span>{active && <span className="repository-current-label">{t("当前 · {count}", { count: repository.worktrees.length })}</span>}</small></button>
            {sortHandle(null, repository.id, name, repositoryIds)}{renameButton(repository.id, 'project', repository.name)}
          </div>
          <CollapsibleContent><div className="worktree-list">{worktrees.map(worktree => {
            const syncDescription = worktreeSyncDescription(worktree);
            const name = worktreeLabel(worktree, names[worktree.id]);
            const details = [name, worktree.isMain ? t('主工作区') : t('关联'), branchLabel(worktree), worktree.path, syncDescription, worktree.locked !== undefined && worktree.locked !== null ? t("锁定：{value1}", { value1: worktree.locked || t("已锁定") }) : '', worktree.prunable ? t("可清理：{value1}", { value1: worktree.prunable }) : ''].filter(Boolean).join('\n');
            return <div className="worktree-row-container" key={worktree.id} {...sorting.rowProps(repository.id, worktree.id)}><Tooltip><TooltipTrigger asChild><button
            disabled={busy || worktree.available === false || worktree.bare}
            className={`worktree-row ${activeWorktreeId === worktree.id ? 'selected' : ''}`}
            aria-current={activeWorktreeId === worktree.id ? 'page' : undefined}
            onClick={() => selectWorktree(worktree.id)}
          ><Icon name={worktree.isMain ? 'device-desktop' : 'worktree'} /><span className="worktree-copy"><span className="worktree-title"><span className="worktree-name">{name}</span>{worktree.isMain && names[worktree.id] && <span className="worktree-kind" title={t('主工作区')}>{t('主')}</span>}{!worktree.isMain && <span className="worktree-kind">{t("关联")}</span>}{worktree.locked !== undefined && worktree.locked !== null && <Icon name="lock" className="worktree-lock" />}{activeWorktreeId === worktree.id && <span className="worktree-current">{t("当前")}</span>}</span><span className="worktree-branch"><Icon name={worktree.detached ? 'git-commit' : 'git-branch'} /><span className="worktree-branch-name">{worktree.bare ? t("裸仓库") : worktree.available === false ? t("目录不可用") : branchLabel(worktree)}</span>{syncDescription && <BranchSyncCounts sync={worktree.branchSync} />}</span></span>{syncDescription && <span className="sr-only">{syncDescription}</span>}</button></TooltipTrigger><TooltipContent className="worktree-tooltip">{details}</TooltipContent></Tooltip>{sortHandle(repository.id, worktree.id, name, worktreeIds)}{renameButton(worktree.id, worktree.isMain ? 'main' : 'worktree', worktreeLabel(worktree))}</div>;
          })}</div></CollapsibleContent>
        </Collapsible>;
      })}
    </nav>
    <span className="sr-only" role="status">{sortAnnouncement}</span>
    <div className="sidebar-bottom">
      <Hint label={t("设置")}><button className="sidebar-action" aria-label={t("设置")} onClick={onSettings}><Icon name="settings-gear" /><span>{t("设置")}</span></button></Hint>
      <Hint label={t("打开仓库")}><button className="sidebar-action" aria-label={t("打开仓库")} disabled={busy} onClick={onOpen}><Icon name="folder-opened" /><span>{t("打开仓库")}</span></button></Hint>
    </div>
    {renameTarget && <RenameDialog target={renameTarget} onClose={() => setRenameTarget(null)} />}
  </aside>;
}

function WorkbenchToolbar({ worktree, onBranchOpen, onMergeOpen }: { worktree: Worktree; onBranchOpen: () => void; onMergeOpen: () => void }) {
  useI18n();
  const { view, setView, busy, refreshing, refresh } = useWorkbench();
  const real = worktree.source === 'native';
  const mergeBlocked = mergeStartBlockReason(worktree);
  const historyLoading = useHistory(state => state.sessions[worktree.id]?.loading ?? false);
  const refreshingView = view === 'history' ? historyLoading : refreshing;
  return <div className="workbench-toolbar">
    <Tabs value={view} onValueChange={value => setView(value as 'changes' | 'history')} className="view-tabs">
      <TabsList className="view-tabs-list"><TabsTrigger value="changes">{t("本地更改")}</TabsTrigger><TabsTrigger value="history">{t("提交历史")}</TabsTrigger></TabsList>
    </Tabs>
    <div className="toolbar-actions">
      <Button variant="outline" size="sm" className="branch-trigger" disabled={busy || refreshing} onClick={onBranchOpen} aria-label={t("管理分支：{value1}", { value1: branchLabel(worktree) })} title={t("查看、切换、创建或删除本地分支")}><Icon name={worktree.detached ? 'git-commit' : 'git-branch'} /><span className="truncate">{branchLabel(worktree)}</span><Icon name="chevron-down" /></Button>
      {real && <Hint label={mergeBlocked ? translateMessage(mergeBlocked) : t("将其他分支合并到 {value1}", { value1: branchLabel(worktree) })}><span><Button variant="ghost" size="sm" className="merge-trigger" disabled={busy || refreshing || Boolean(mergeBlocked)} onClick={onMergeOpen}><Icon name="git-merge" />{t("合并")}</Button></span></Hint>}
      <Separator orientation="vertical" className="toolbar-separator" />
      {(real || view === 'history') && <Button variant="ghost" size="sm" disabled={busy || refreshingView} onClick={() => void (view === 'history' ? useHistory.getState().refresh(worktree) : refresh()).catch(error => toast.error(translateMessage(errorMessage(error))))}><Icon name="refresh" className={refreshingView ? 'spin' : ''} />{refreshingView ? t("刷新中") : t("刷新")}</Button>}
      <RemoteActions key={`${worktree.id}:${worktree.branch}`} worktree={worktree} />
    </div>
  </div>;
}

function FileGroup({ worktree, area, disabled, conflictsOnly = false }: { worktree: Worktree; area: ChangeArea; disabled: boolean; conflictsOnly?: boolean }) {
  const { language } = useI18n();
  const { selection, selectFile, stage, unstage } = useWorkbench();
  const { fileView } = usePreferences();
  const files = useMemo(() => getChanges(worktree, area).filter(file => Boolean(file.git?.conflicted) === conflictsOnly), [worktree, area, conflictsOnly]);
  const nodes = useMemo(() => fileView === 'tree' ? buildChangeTree(files, language) : [], [files, fileView, language]);
  const [discardTarget, setDiscardTarget] = useState<{ worktreeId: string; branch: string; fileIds: string[]; bulk: boolean } | null>(null);
  const canDiscard = area === 'unstaged' && !conflictsOnly;
  const discardDisabled = disabled || Boolean(worktree.operation);
  const label = conflictsOnly ? t("合并冲突") : area === 'unstaged' ? t("未暂存") : t("已暂存");

  /** 目录按钮仅处理当前分组的后代文件，保留另一分组及同名前缀目录的状态。 */
  function renderBulkAction(path?: string) {
    if (conflictsOnly) return null;
    const targets = path ? files.filter(file => file.path.startsWith(`${path}/`)) : files;
    const actionLabel = path ? t(area === 'unstaged' ? "暂存目录 {path}" : "取消暂存目录 {path}", { path }) : t(area === 'unstaged' ? "暂存全部变更" : "取消暂存全部变更");
    return <Hint label={t("{value1}（{value2} 个文件）", { value1: actionLabel, value2: targets.length })}><Button variant="ghost" size="icon-sm" className="bulk-stage-action" disabled={disabled || targets.length === 0} aria-label={actionLabel} onClick={() => void (area === 'unstaged' ? stage : unstage)(targets.map(file => file.id)).catch(error => toast.error(translateMessage(errorMessage(error))))}><Icon name={area === 'unstaged' ? 'add' : 'remove'} /></Button></Hint>;
  }

  function openDiscard(fileIds: string[], bulk: boolean) {
    setDiscardTarget({ worktreeId: worktree.id, branch: worktree.branch, fileIds, bulk });
  }

  function renderFile(file: FileSnapshot, depth = 0) {
    const selected = selection?.fileId === file.id && selection.area === area;
    const status = getFileStatus(file, area);
    const untracked = isUntrackedChange(file);
    const discardLabel = t(untracked ? '移到废纸篓 {path}' : '撤销未暂存修改 {path}', { path: file.path });
    const actionLabel = `${conflictsOnly ? t("暂存已解决的冲突") : area === 'unstaged' ? t("暂存") : t("取消暂存")} ${file.path}`;
    const path = file.git?.originalPath ? `${file.git.originalPath} → ${file.path}` : file.path;
    return <div key={file.id} className={`file-row ${fileView === 'tree' ? 'tree-file-row' : ''} ${selected ? 'selected' : ''}`} style={{ '--file-depth': depth } as CSSProperties}>
      <button className="file-select" onClick={() => selectFile(file.id, area)} aria-pressed={selected} aria-label={`${label}：${file.path}`} title={path}>
        <FileIcon path={file.path} language={file.language} />
        <span className="file-copy"><span className="file-name">{fileName(file)}</span>{fileView === 'list' && <span className="file-path">{file.git?.originalPath ? path : directory(file)}</span>}</span>
        <span className={`file-status status-${status}`}>{status}</span>
      </button>
      {canDiscard && <Hint label={discardLabel}><Button variant="ghost" size="icon-sm" className="file-action file-discard-action" disabled={discardDisabled} aria-label={discardLabel} onClick={() => openDiscard([file.id], false)}><Icon name={untracked ? 'trash' : 'discard'} /></Button></Hint>}
      <Hint label={actionLabel}><Button variant={selected ? 'secondary' : 'ghost'} size="icon-sm" className="file-action" disabled={disabled} aria-label={actionLabel} onClick={() => void (area === 'unstaged' ? stage(file.id) : unstage(file.id)).catch(error => toast.error(translateMessage(errorMessage(error))))}><Icon name={area === 'unstaged' ? 'add' : 'remove'} /></Button></Hint>
    </div>;
  }

  return <><Collapsible defaultOpen className="file-group">
    <div className="file-group-header"><CollapsibleTrigger className="file-group-heading"><Icon name="chevron-down" /><span>{label}</span><Badge variant="secondary" className="count-badge">{files.length}</Badge></CollapsibleTrigger>{canDiscard && files.length > 0 && <Hint label={t('撤销全部未暂存修改')}><Button variant="ghost" size="icon-sm" className="bulk-discard-action" disabled={discardDisabled} aria-label={t('撤销全部未暂存修改')} onClick={() => openDiscard(files.map(file => file.id), true)}><Icon name="discard" /></Button></Hint>}{files.length > 0 && renderBulkAction()}</div>
    <CollapsibleContent>
      {fileView === 'tree' ? <ChangeFileTree nodes={nodes} selectedFileId={selection?.area === area ? selection.fileId : null} renderFile={renderFile} renderDirectoryAction={renderBulkAction} /> : files.map(file => renderFile(file))}
      {files.length === 0 && <p className="empty-group">{area === 'staged' ? t("暂存文件后即可提交") : t("工作区没有未暂存的更改")}</p>}
    </CollapsibleContent>
  </Collapsible>
    {discardTarget?.worktreeId === worktree.id && discardTarget.branch === worktree.branch && <DiscardChangesDialog fileIds={discardTarget.fileIds} bulk={discardTarget.bulk} onClose={() => setDiscardTarget(null)} />}
  </>;
}

function ChangesView({ worktree, shortcutsEnabled }: { worktree: Worktree; shortcutsEnabled: boolean }) {
  useI18n();
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
        if (result.outcome !== 'merged') toast.warning(result.outcome === 'conflicts' ? t("仍有未解决的冲突") : t("合并尚未完成"), { description: result.warning ? translateMessage(result.warning) : t("请检查文件和当前合并状态后重试。") });
        else if (result.warning) toast.warning(t("合并已完成"), { description: translateMessage(result.warning) });
        else toast.success(t("合并已完成"), { description: result.commitId?.slice(0, 7) });
        return;
      }
      const hash = await commit();
      toast.success(real ? t("提交成功") : t("演示提交成功"), { description: t("{value1} · 已提交暂存内容，未暂存的更改仍然保留。", { value1: hash.slice(0, 7) }) });
    } catch (error) { toast.error(translateMessage(errorMessage(error))); }
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
      <section className="changes-panel" aria-label={t("文件变更与提交")}>
        <div className="changes-heading"><h1>{t("本地更改")}</h1><Badge variant="secondary" className="count-badge">{changedCount}</Badge><div className="file-view-switch" role="group" aria-label={t("文件显示方式")}>{(['tree', 'list'] as const).map(mode => <Hint key={mode} label={mode === 'tree' ? t("树形视图") : t("列表视图")}><Button variant="ghost" size="icon-xs" aria-label={mode === 'tree' ? t("树形视图") : t("列表视图")} aria-pressed={fileView === mode} onClick={() => setFileView(mode)}><Icon name={mode === 'tree' ? 'list-tree' : 'list-flat'} /></Button></Hint>)}</div></div>
        <div className="file-groups">{worktree.files.some(file => file.git?.conflicted) && <FileGroup worktree={worktree} area="unstaged" conflictsOnly disabled={busy || refreshing} />}<FileGroup worktree={worktree} area="unstaged" disabled={busy || refreshing} /><FileGroup worktree={worktree} area="staged" disabled={busy || refreshing} /></div>
        <CommitComposer key={JSON.stringify([worktree.id, worktree.path, worktree.branch, worktree.detached])} worktree={worktree} busy={busy || refreshing} onCommit={handleCommit} />
      </section>
    </Panel>
    <ResizeHandle className="resize-handle" aria-label={t("调整变更列表宽度")} />
    <Panel id="diff" minSize="420px">
      {real && (diff.loading || diff.notice || diff.error) ? <section className="diff-message" aria-label={t("代码差异")} aria-live="polite"><Icon name={diff.loading ? 'loading' : diff.error ? 'warning' : 'file'} className={diff.loading ? 'spin' : ''} /><h2>{diff.loading ? t("正在读取文件差异…") : diff.error ? t("无法读取差异") : t("文件差异说明")}</h2><p>{translateMessage(diff.error ?? diff.notice ?? '')}</p>{diff.error && <Button variant="outline" disabled={busy || refreshing} onClick={() => void refresh().catch(error => toast.error(translateMessage(errorMessage(error))))}>{t("重新读取")}</Button>}</section> : <CodeDiff file={file} area={selection?.area ?? 'unstaged'} worktreeId={worktree.id} fontSize={fontSize} mode={diffMode} onModeChange={setDiffMode} onClose={closeFile} onStageHunk={!real && !busy && file && selection?.area === 'unstaged' ? index => stageChunk(file.id, index) : undefined} />}
    </Panel>
  </Group>;
}

function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { language, setLanguage } = useI18n();
  const { fontSize, setFontSize, resetLayout } = usePreferences();
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="settings-dialog">
      <DialogHeader><DialogTitle>{t("工作台设置")}</DialogTitle><DialogDescription>{t("调整外观与阅读体验，找到适合你的工作方式。")}</DialogDescription></DialogHeader>
      <AppearancePicker />
      <Separator />
      <div className="settings-preferences-grid">
        <Field><FieldLabel htmlFor="interface-language">{t("界面语言")}</FieldLabel>
          <select id="interface-language" value={language} onChange={event => setLanguage(event.target.value as Language)} aria-describedby="interface-language-description">
            {languages.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select><FieldDescription id="interface-language-description">{t("切换后立即生效，并保存在当前设备。")}</FieldDescription>
        </Field>
        <Field><FieldLabel htmlFor="font-size">{t("代码字号")} <span className="field-value">{fontSize}px</span></FieldLabel>
          <Input id="font-size" type="range" min="11" max="18" step="1" value={fontSize} onChange={event => setFontSize(Number(event.target.value))} />
          <FieldDescription>{t("应用于并排和内联代码差异视图。")}</FieldDescription>
        </Field>
      </div>
      <Separator />
      <div className="settings-row"><div><strong>{t("恢复默认布局")}</strong><p>{t("重置仓库栏位置与展开状态、分栏宽度、字号与 Diff 显示方式。")}</p></div><Button variant="outline" onClick={() => { resetLayout(); onOpenChange(false); toast.success(t("已恢复默认布局")); }}>{t("恢复")}</Button></div>
      {!native && <div className="settings-row"><div><strong>{t("重置示例数据")}</strong><p>{t("恢复最初的文件更改与提交记录。")}</p></div><Button variant="outline" onClick={() => { useWorkbench.getState().reset(); useHistory.getState().reset(); onOpenChange(false); toast.success(t("示例数据已重置")); }}>{t("重置")}</Button></div>}
      <Separator />
      <div className="settings-row"><div><strong>Git Workbench</strong><p>{t("当前版本")}</p></div><span>v{appVersion}</span></div>
      <p className="settings-footnote"><Icon name="info" />{t("切换主题时保留当前工作区、差异阅读位置和提交草稿。")}</p>
    </DialogContent>
  </Dialog>;
}

function OpenRepositoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  useI18n();
  const names = useDisplayNames(state => state.names);
  const projectOrder = useSidebarOrder(state => state.order.projects);
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
      const selected = await chooseDirectory({ directory: true, multiple: false, title: t("选择本地 Git 仓库") });
      if (typeof selected === 'string') {
        setPath(selected);
        await openPath(selected);
      }
    } catch (error) { setOpeningError(errorMessage(error)); }
    finally { setChoosing(false); }
  }

  return <Dialog open={open} onOpenChange={value => { if (!busy && !choosing) onOpenChange(value); }}><DialogContent className="open-repository-dialog"><DialogHeader><DialogTitle>{native ? t("打开本地仓库") : t("打开示例仓库")}</DialogTitle><DialogDescription>{native ? t("选择已存在的 Git 仓库或工作区目录，也可以直接输入本地路径。") : t("浏览器中使用示例数据。请启动桌面应用以管理本地 Git 仓库。")}</DialogDescription></DialogHeader>
    {native && <form className="repository-open-form" onSubmit={event => { event.preventDefault(); if (path.trim() && !busy && !choosing) void openPath(path.trim()); }}>
      <Field><FieldLabel htmlFor="repository-path">{t("仓库路径")}</FieldLabel><Input id="repository-path" value={path} onChange={event => setPath(event.target.value)} placeholder={t("/Users/你的用户名/项目目录")} autoComplete="off" spellCheck={false} disabled={busy || choosing} /></Field>
      <div className="repository-open-actions"><Button type="button" variant="outline" disabled={busy || choosing} onClick={() => void browse()}><Icon name="folder-opened" />{t("选择文件夹")}</Button><Button type="submit" disabled={!path.trim() || busy || choosing}>{busy ? t("正在打开…") : t("打开仓库")}</Button></div>
      {openingError && <pre className="inline-error" role="alert">{translateMessage(openingError)}</pre>}
    </form>}
    {repositories.length > 0 && <div className="repository-picker"><p className="picker-label">{t("已打开的仓库")}</p>{orderedItems(repositories, projectOrder).map(repository => {
      const target = repository.worktrees.find(item => item.id === activeWorktreeId && item.available !== false && !item.bare) ?? firstAvailableWorktree(repository);
      const name = names[repository.id] ?? repository.name;
      return <button className="picker-row" disabled={busy || choosing || !target} key={repository.id} onClick={() => { if (target) selectWorktree(target.id); onOpenChange(false); }}><Icon name="repo" /><span><strong title={name}>{name}</strong><small title={target?.path}>{target?.path ?? t("工作区目录不可用")} · {t("{value1} 个工作区", { value1: repository.worktrees.length })}</small></span><Icon name={repository.worktrees.some(item => item.id === activeWorktreeId) ? 'check' : 'chevron-right'} /></button>;
    })}</div>}
  </DialogContent></Dialog>;
}

function WelcomeView({ onOpen }: { onOpen: () => void }) {
  useI18n();
  return <div className="welcome-view"><span className="welcome-icon"><Icon name="source-control" /></span><span className="welcome-eyebrow">GIT WORKBENCH</span><h1>{t("从一个本地仓库开始")}</h1><p>{t("查看代码差异，整理暂存区，完成每一次提交。")}</p><Button size="lg" onClick={onOpen}><Icon name="folder-opened" />{t("打开本地仓库")}</Button><span className="welcome-note">{t("支持现有 Git 仓库与 Worktree")}</span></div>;
}

export default function App() {
  useI18n();
  const names = useDisplayNames(state => state.names);
  const resolvedTheme = useAppearance(state => state.resolvedTheme);
  const { repositories, activeWorktreeId, view, busy, restoring, refreshing, error, autoRefreshError } = useWorkbench();
  const { sidebarSide, sidebarCollapsed, sidebarWidth, setSidebarSide, setSidebarCollapsed, setSidebarWidth, layoutResetKey } = usePreferences();
  const repositoryPanel = usePanelRef();
  const bodyRef = useRef<HTMLDivElement>(null);
  const layoutScroll = useRef<Array<{ element: HTMLElement; top: number; left: number }>>([]);
  const [initialSidebarWidth] = useState(() => sidebarCollapsed ? 44 : sidebarWidth);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const repository = repositories.find(item => item.worktrees.some(worktree => worktree.id === activeWorktreeId));
  const repositoryName = repository ? names[repository.id] ?? repository.name : t('本地 Git 工作台');
  const worktree = findWorktree(repositories, activeWorktreeId);
  const changedCount = worktree ? new Set([...getChanges(worktree, 'unstaged'), ...getChanges(worktree, 'staged')].map(item => item.id)).size : 0;
  const real = worktree?.source === 'native';

  useEffect(() => startNativeAppearance(), []);
  useEffect(() => { void useWorkbench.getState().restoreSession(); }, []);
  useEffect(() => startAutoRefresh(), []);
  useEffect(() => {
    /** 换侧后分栏库会按顺序重新注册，等它完成后再应用已保存的宽度。 */
    const frame = requestAnimationFrame(() => {
      if (sidebarCollapsed) repositoryPanel.current?.collapse();
      else repositoryPanel.current?.resize(sidebarWidth);
    });
    return () => cancelAnimationFrame(frame);
  }, [repositoryPanel, sidebarCollapsed, sidebarWidth, sidebarSide, layoutResetKey]);
  useLayoutEffect(() => {
    layoutScroll.current.forEach(({ element, top, left }) => element.scrollTo(left, top));
    layoutScroll.current = [];
  }, [sidebarSide]);

  /** 浏览器移动已有 DOM 时会清空滚动位置，换侧前记录并在绘制前恢复。 */
  function moveSidebar() {
    layoutScroll.current = [...bodyRef.current!.querySelectorAll<HTMLElement>('*')]
      .filter(element => element.scrollTop || element.scrollLeft)
      .map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }));
    setSidebarSide(sidebarSide === 'left' ? 'right' : 'left');
  }

  /** 面板使用稳定的 key 调整顺序，保留仓库树、编辑器与 AI 会话的组件状态。 */
  const sidebarPanel = <Panel key="repositories" id="repositories" panelRef={repositoryPanel} defaultSize={initialSidebarWidth} minSize="240px" maxSize="360px" collapsible collapsedSize="44px" groupResizeBehavior="preserve-pixel-size"><RepositorySidebar onOpen={() => setRepositoryOpen(true)} onSettings={() => setSettingsOpen(true)} onMove={moveSidebar} /></Panel>;
  const sidebarHandle = <ResizeHandle key="repository-resize" className="resize-handle" disabled={sidebarCollapsed} disableDoubleClick aria-label={t("调整仓库列表宽度")} onDoubleClick={() => {
    if (!sidebarCollapsed) setSidebarWidth(usePreferences.getInitialState().sidebarWidth);
  }} />;
  const workspacePanel = <Panel key="workspace" id="workspace" minSize="690px"><main className="workspace">
    {error && <div className="git-error" role="alert"><Icon name="warning" /><pre>{translateMessage(error)}</pre></div>}
    {autoRefreshError && <div className="git-error" role="status"><Icon name="warning" /><pre>{translateMessage(autoRefreshError)}</pre></div>}
    {repository && worktree ? <>
      <WorkbenchToolbar worktree={worktree} onBranchOpen={() => setBranchOpen(true)} onMergeOpen={() => setMergeOpen(true)} />
      {worktree.operation && <MergeStatusBanner key={`${worktree.id}:${worktree.operation.kind}:${worktree.operation.head}:${worktree.operation.mergeHeads.join(',')}`} worktree={worktree} />}
      {view === 'changes' ? <ChangesView key={activeWorktreeId} worktree={worktree} shortcutsEnabled={!settingsOpen && !repositoryOpen && !branchOpen && !mergeOpen} /> : <HistoryView key={activeWorktreeId} worktree={worktree} />}
      <footer className="statusbar"><span className="status-branch"><Icon name="git-branch" />{branchLabel(worktree)}</span><span className="status-divider" /><span>{view === 'history' ? t("历史只读") : busy ? t("Git 操作进行中…") : refreshing ? t("正在刷新…") : changedCount ? t("{value1} 个文件有更改", { value1: changedCount }) : t("工作区干净")}</span><span className={`status-demo ${real ? 'status-native' : ''}`}><Icon name={real ? 'repo' : 'beaker'} />{real ? t("本地 Git") : t("演示模式")}</span><span className="status-spacer" /><span className="status-path" title={worktree.path}>{worktree.path}</span></footer>
    </> : restoring ? <div className="diff-message" role="status"><Icon name="loading spin" />{t("正在恢复上次打开的仓库…")}</div> : <WelcomeView onOpen={() => setRepositoryOpen(true)} />}
  </main></Panel>;

  return <TooltipProvider delayDuration={400}><div className={`workbench ${native ? 'native-window' : 'browser-window'}`}>
    <header className="titlebar" data-tauri-drag-region><div className="app-title" data-tauri-drag-region>{!native && <Icon name="source-control" />}{t("代码管理")}</div><div className="window-context" data-tauri-drag-region><span className="window-repository-name" title={repositoryName}>{repositoryName}</span>{worktree && <><span className="window-context-separator">/</span><span className="window-branch-name" title={branchLabel(worktree)}>{branchLabel(worktree)}</span></>}</div><span className="titlebar-version">Git Workbench</span></header>
    <Group key={layoutResetKey} elementRef={bodyRef} orientation="horizontal" className="app-body" onLayoutChanged={(layout, { isUserInteraction }) => {
      if (!isUserInteraction) return;
      const collapsed = repositoryPanel.current!.isCollapsed();
      if (collapsed !== sidebarCollapsed) setSidebarCollapsed(collapsed);
      if (!collapsed) {
        /** 键盘调整同步触发布局回调，此时面板 DOM 可能仍是上一帧宽度。 */
        const availableWidth = bodyRef.current!.clientWidth - bodyRef.current!.querySelector<HTMLElement>(':scope > [data-separator]')!.offsetWidth;
        setSidebarWidth(availableWidth * layout.repositories / 100);
      }
    }}>
      {sidebarSide === 'left' ? [sidebarPanel, sidebarHandle, workspacePanel] : [workspacePanel, sidebarHandle, sidebarPanel]}
    </Group>
    <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} /><OpenRepositoryDialog open={repositoryOpen} onOpenChange={setRepositoryOpen} /><Toaster theme={resolvedTheme} position="bottom-right" closeButton richColors containerAriaLabel={t("通知")} toastOptions={{ closeButtonAriaLabel: t("关闭通知") }} />
    {branchOpen && worktree && <BranchPickerDialog key={worktree.id} worktree={worktree} open onOpenChange={setBranchOpen} />}
    {mergeOpen && worktree && <MergeBranchDialog key={worktree.id} worktree={worktree} open onOpenChange={setMergeOpen} />}
  </div></TooltipProvider>;
}
