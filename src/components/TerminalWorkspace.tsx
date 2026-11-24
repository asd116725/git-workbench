import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react';
import { Popover } from 'radix-ui';
import { ArrowLeft, ChevronRight, ChevronsDown, FolderOpen, Maximize2, Minimize2, Monitor, Palette, Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAppearance, type ResolvedTheme } from '../lib/appearance';
import { useDisplayNames } from '../lib/display-names';
import { t, useI18n } from '../lib/i18n';
import { translateMessage } from '../lib/i18n-system';
import { orderedItems, useSidebarOrder } from '../lib/sidebar-order';
import { resolveTerminalPalette, terminalThemeOptions, type TerminalTheme } from '../lib/terminal-theme';
import { groupTerminalSessions, isTerminalWorktree, type TerminalSession, type useTerminalWorkspace } from '../lib/terminal-workspace';
import type { Repository, Worktree } from '../lib/types';
import { terminalWorktreeLabel, worktreeLabel } from './branch-display';
import './terminal-workspace.css';

type TerminalController = ReturnType<typeof useTerminalWorkspace>;

function Hint({ text, children }: { text: string; children: ReactElement }) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent className="terminal-tooltip">{text}</TooltipContent></Tooltip>;
}

/** 应用主题后把输入焦点交还给终端，取消时由菜单恢复按钮焦点。 */
function TerminalThemeMenu({ theme, workbenchTheme, focusTerminal }: {
  theme: TerminalTheme;
  workbenchTheme: ResolvedTheme;
  focusTerminal: () => boolean;
}) {
  const applied = useRef(false);
  return <DropdownMenu onOpenChange={open => { if (open) applied.current = false; }}>
    <Hint text={t('终端主题')}><DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon-xs" className="terminal-action" aria-label={t('终端主题')}><Palette aria-hidden="true" /></Button>
    </DropdownMenuTrigger></Hint>
    <DropdownMenuContent data-terminal-workspace="" className="terminal-theme-menu" side="top" align="end" sideOffset={7}
      onCloseAutoFocus={event => { if (applied.current && focusTerminal()) event.preventDefault(); }}>
      <DropdownMenuLabel>{t('终端主题')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={theme} aria-label={t('终端主题')}>
        {terminalThemeOptions.map(option => {
          const palette = resolveTerminalPalette(option.id, workbenchTheme);
          return <DropdownMenuRadioItem className="terminal-theme-option" key={option.id} value={option.id}
            onSelect={() => { applied.current = true; useAppearance.getState().setTerminalTheme(option.id); }}>
            <span className="terminal-theme-swatch" aria-hidden="true" style={{ backgroundColor: palette.background }}>
              <i style={{ backgroundColor: palette.red }} /><i style={{ backgroundColor: palette.green }} /><i style={{ backgroundColor: palette.blue }} />
            </span>
            {t(option.label)}
          </DropdownMenuRadioItem>;
        })}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** 只列出可启动的本地目录；即便项目只有一个工作树，也在第二步由用户确认目录。 */
function TerminalPicker({ repositories, names, onStart }: {
  repositories: Repository[];
  names: Record<string, string>;
  onStart: (repository: Repository, worktree: Worktree) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const order = useSidebarOrder(state => state.order);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const choseWorktree = useRef(false);
  const projects = orderedItems(repositories, order.projects)
    .map(repo => ({ repo, worktrees: orderedItems(repo.worktrees.filter(isTerminalWorktree), order.worktrees[repo.id]) }))
    .filter(project => project.worktrees.length);
  const project = projects.find(item => item.repo.id === projectId);
  const filter = query.trim().toLocaleLowerCase();
  const matches = projects.filter(({ repo }) => [names[repo.id], repo.name].some(name => name?.toLocaleLowerCase().includes(filter)));
  const title = project ? t('选择工作树') : t('选择项目');

  useLayoutEffect(() => {
    if (projectId) list.current?.querySelector('button')?.focus();
    else search.current?.focus();
  }, [projectId]);

  function changeOpen(next: boolean) {
    if (next) {
      choseWorktree.current = false;
      setQuery('');
      setProjectId(null);
    }
    setOpen(next);
  }

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const buttons = Array.from(list.current?.querySelectorAll('button') ?? []);
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? index + 1 : index <= 0 ? buttons.length - 1 : index - 1;
      buttons[next % buttons.length]?.focus();
    } else if (event.key === 'Enter' && event.target === search.current && buttons.length) {
      event.preventDefault();
      buttons[0].click();
    } else if (event.key === 'ArrowLeft' && project) {
      event.preventDefault();
      setProjectId(null);
    }
  }

  return <Popover.Root open={open} onOpenChange={changeOpen}>
    <Hint text={t('新建终端')}><Popover.Trigger asChild><Button variant="ghost" size="icon-xs" className="terminal-action" aria-label={t('新建终端')}><Plus /></Button></Popover.Trigger></Hint>
    <Popover.Portal><Popover.Content data-terminal-workspace="" className="terminal-picker" aria-label={title} side="top" sideOffset={7} collisionPadding={12}
      onKeyDown={moveFocus} onOpenAutoFocus={event => { event.preventDefault(); search.current?.focus(); }}
      onCloseAutoFocus={event => { if (choseWorktree.current) event.preventDefault(); }}>
      <div className="terminal-picker-heading">
        {project && <Button variant="ghost" size="icon-xs" onClick={() => setProjectId(null)} aria-label={t('返回项目列表')}><ArrowLeft /></Button>}
        <strong>{title}</strong>
      </div>
      {project ? <p className="terminal-picker-project" title={names[project.repo.id] ?? project.repo.name}>{names[project.repo.id] ?? project.repo.name}</p>
        : <div className="terminal-picker-search"><Search /><Input ref={search} value={query} onChange={event => setQuery(event.target.value)} aria-label={t('搜索项目')} placeholder={t('搜索项目')} /></div>}
      <div className="terminal-picker-list" ref={list}>
        {project ? project.worktrees.map(worktree => <button className="terminal-picker-option" key={worktree.id} title={`${worktreeLabel(worktree, names[worktree.id])}\n${worktree.path}`}
          onClick={() => { choseWorktree.current = true; onStart(project.repo, worktree); setOpen(false); }}>
          <FolderOpen /><span className="terminal-picker-worktree"><strong>{terminalWorktreeLabel(project.repo, worktree, names)}</strong><small>{worktree.path}</small></span>
        </button>) : matches.map(({ repo, worktrees }) => <button className="terminal-picker-option" key={repo.id} onClick={() => setProjectId(repo.id)}>
          <FolderOpen /><span className="terminal-picker-name">{names[repo.id] ?? repo.name}</span>
          <small>{worktrees.length === 1 ? t('1 个工作树') : t('{count} 个工作树', { count: worktrees.length })}</small><ChevronRight />
        </button>)}
        {!project && !matches.length && <p className="terminal-picker-empty">{query ? t('没有匹配的项目') : t('没有可用的本地工作树')}</p>}
      </div>
      <Popover.Arrow className="terminal-picker-arrow" width={16} height={8} />
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

function sessionName(session: TerminalSession, name: string) {
  return session.ordinal > 1 ? `${name} · ${session.ordinal}` : name;
}

/** 布局只挂载活动终端，标签选择与工作树选择互相独立。 */
export function TerminalWorkspace({ terminal, repositories, onCollapse }: {
  terminal: TerminalController;
  repositories: Repository[];
  onCollapse: () => void;
}) {
  useI18n();
  const names = useDisplayNames(state => state.names);
  const theme = useAppearance(state => state.terminalTheme);
  const workbenchTheme = useAppearance(state => state.resolvedTheme);
  const palette = resolveTerminalPalette(theme, workbenchTheme);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const tabList = useRef<HTMLDivElement>(null);
  const focusInput = useRef(true);
  const { activeId, attach } = terminal;
  const active = terminal.sessions.find(s => s.id === activeId);
  const confirm = terminal.sessions.find(s => s.id === confirmId);

  useLayoutEffect(() => {
    if (!activeId || !host.current) return;
    const detach = attach(activeId, host.current, focusInput.current);
    focusInput.current = true;
    tabList.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return detach;
  }, [activeId, attach]);

  function close(session: TerminalSession) {
    if (session.phase === 'running' || session.phase === 'starting') setConfirmId(session.id);
    else void terminal.close(session.id);
  }

  return <Tabs value={activeId ?? ''} onValueChange={terminal.activate} className="terminal-workspace" data-terminal-workspace="">
    <div className="terminal-toolbar">
      <span className="terminal-heading"><Monitor aria-hidden="true" /><strong>{t('终端')}</strong></span>
      <TabsList ref={tabList} className="terminal-tabs" aria-label={t('终端会话')}
        onKeyDownCapture={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) focusInput.current = false; }}
        onPointerDownCapture={() => { focusInput.current = true; }}>
        {groupTerminalSessions(terminal.sessions).map(({ repositoryId, compact, sessions }) => {
          const repo = repositories.find(item => item.id === repositoryId) ?? {
            name: sessions[0].repositoryName, worktrees: sessions.map(session => session.worktree),
          };
          const project = names[repositoryId] ?? repo.name;
          return <div className="terminal-group" key={repositoryId}>
            {!compact && <span className="terminal-group-name" title={project}>{project}</span>}
            {sessions.map(session => {
              const label = sessionName(session, terminalWorktreeLabel(repo, session.worktree, names));
              const fullName = `${project} / ${sessionName(session, worktreeLabel(session.worktree, names[session.worktree.id]))}`;
              const selected = session.id === activeId;
              return <div className="terminal-tab" data-active={selected || undefined} key={session.id}>
                <Hint text={`${fullName}\n${session.worktree.path}`}><TabsTrigger value={session.id} className="terminal-tab-select"
                  aria-label={session.unread ? t('{name}，有新输出', { name: fullName }) : fullName}
                  onClick={() => { if (selected) terminal.focus(); }}>
                  <span>{compact ? sessionName(session, project) : label}</span>
                  {session.unread && <i className="terminal-unread" />}
                </TabsTrigger></Hint>
                <Hint text={t('关闭终端 {name}', { name: label })}><button className="terminal-tab-close" tabIndex={selected ? 0 : -1}
                  disabled={session.closing} aria-label={t('关闭终端 {name}', { name: fullName })} onClick={() => close(session)}><X /></button></Hint>
              </div>;
            })}
          </div>;
        })}
      </TabsList>
      <TerminalPicker repositories={repositories} names={names} onStart={(repo, tree) => { focusInput.current = true; void terminal.start(repo, tree); }} />
      {active && <Hint text={t('起始目录：{path}', { path: active.worktree.path })}><span className="terminal-directory"><FolderOpen aria-hidden="true" /><span><bdi dir="ltr">{active.worktree.path}</bdi></span></span></Hint>}
      <div className="terminal-layout-actions">
        <TerminalThemeMenu theme={theme} workbenchTheme={workbenchTheme} focusTerminal={terminal.focus} />
        <Hint text={terminal.maximized ? t('还原终端面板') : t('最大化终端面板')}><Button className="terminal-action" variant="ghost" size="icon-xs"
          aria-label={terminal.maximized ? t('还原终端面板') : t('最大化终端面板')} onClick={terminal.toggleMaximized}>
          {terminal.maximized ? <Minimize2 /> : <Maximize2 />}
        </Button></Hint>
        <Hint text={t('收起终端')}><Button variant="ghost" size="icon-xs" className="terminal-action" aria-label={t('收起终端')} onClick={onCollapse}><ChevronsDown /></Button></Hint>
      </div>
    </div>
    {active && <TabsContent value={active.id} className="terminal-body" tabIndex={-1}
      style={{ '--terminal-background': palette.background, '--terminal-foreground': palette.foreground } as CSSProperties}>
      <div className="terminal-host" ref={host} />
      {active.phase === 'starting' && <p className="terminal-notice" role="status">{t('正在启动终端…')}</p>}
      {active.phase === 'failed' && <div className="terminal-notice" role="alert"><span>{t('终端启动失败')}{active.error && ` · ${translateMessage(active.error)}`}</span>
        <Button size="xs" variant="outline" onClick={() => void terminal.restart(active.id)}>{t('重试')}</Button></div>}
      {active.phase === 'exited' && <div className="terminal-notice" role="status"><span>{active.exitCode === null ? t('Shell 已退出') : t('Shell 已退出，退出码 {code}', { code: active.exitCode })}{active.error && ` · ${translateMessage(active.error)}`}</span>
        <Button size="xs" variant="outline" onClick={() => void terminal.restart(active.id)}>{t('重新启动')}</Button></div>}
      {active.phase === 'running' && active.error && <div role="alert" className="terminal-notice">{translateMessage(active.error)}</div>}
    </TabsContent>}
    {confirm && <Dialog open onOpenChange={open => { if (!open) setConfirmId(null); }}>
      <DialogContent className="removal-confirmation-dialog" overlayClassName="removal-confirmation-overlay" showCloseButton={false} data-terminal-workspace=""
        onOpenAutoFocus={event => { event.preventDefault(); cancel.current?.focus(); }}
        onCloseAutoFocus={event => { event.preventDefault(); terminal.focus(); }}>
        <DialogTitle>{t('关闭这个终端？')}</DialogTitle>
        <DialogDescription asChild><div className="removal-confirmation-description">
          <div className="removal-confirmation-target"><strong>{names[confirm.repositoryId] ?? confirm.repositoryName} / {sessionName(confirm, worktreeLabel(confirm.worktree, names[confirm.worktree.id]))}</strong><span>{confirm.worktree.path}</span></div>
          <p>{t('关闭会终止这个 Shell 和该终端中的任务。')}</p>
        </div></DialogDescription>
        <div className="removal-confirmation-actions">
          <Button ref={cancel} variant="outline" onClick={() => setConfirmId(null)}>{t('取消')}</Button>
          <Button variant="destructive" onClick={() => { void terminal.close(confirm.id); setConfirmId(null); }}>{t('关闭终端')}</Button>
        </div>
      </DialogContent>
    </Dialog>}
  </Tabs>;
}
