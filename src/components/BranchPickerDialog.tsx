import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { commitAge } from './branch-display';
import { BranchCreateForm, BranchDeleteConfirmation } from './BranchForms';
import { useWorkbench } from '../lib/store';
import type { GitBranch, GitDeleteBranchPreview, Worktree } from '../lib/types';

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }

function switchDisabledReason(branch: GitBranch, worktreePath: string) {
  if (branch.current) return '当前分支';
  if (branch.worktreePath && branch.worktreePath !== worktreePath) return '其他工作区使用中';
  if (branch.kind === 'remote' && !branch.localName) return '远程未配置';
  return null;
}

/** 切换与删除使用并列按钮，避免嵌套交互元素和删除点击触发切换。 */
function BranchRow({ branch, worktreePath, locked, blocked, switching, onSwitch, onDelete }: {
  branch: GitBranch;
  worktreePath: string;
  locked: boolean;
  blocked: string | null;
  switching: boolean;
  onSwitch: (fullName: string) => Promise<void>;
  onDelete: (branch: GitBranch) => Promise<void>;
}) {
  const reason = switchDisabledReason(branch, worktreePath);
  const context = branch.worktreePath && branch.worktreePath !== worktreePath ? branch.worktreePath : branch.kind === 'remote' ? `本地跟踪分支：${branch.localName ?? '无法确定'}` : branch.upstream ? `跟踪 ${branch.upstream.replace(/^refs\/remotes\//, '')}` : '本地分支';
  const commit = branch.lastCommit;
  const summary = `${commit.author} · ${commit.shortHash} · ${commit.subject || '（无提交说明）'}`;
  const date = new Date(commit.committedAt * 1000);
  const deleteBlocked = branch.current ? '当前分支不能删除' : branch.worktreePath ? '分支正在工作区使用，不能删除' : blocked;
  return <div className={`branch-management-row ${branch.current ? 'is-current' : ''}`}>
    <button type="button" className={`branch-option ${branch.current ? 'is-current' : ''}`} disabled={locked || Boolean(blocked) || Boolean(reason)} aria-label={`切换到 ${branch.name}`} aria-describedby={`commit-${branch.fullName}`} aria-current={branch.current ? 'true' : undefined} title={`${branch.name}\n${summary}\n${date.toLocaleString('zh-CN')}\n${reason ?? blocked ?? '切换分支'} · ${context}`} onClick={() => void onSwitch(branch.fullName)}>
      <i className={`codicon codicon-${switching ? 'loading spin' : branch.current ? 'check' : branch.kind === 'remote' ? 'cloud' : 'git-branch'}`} aria-hidden="true" />
      <span className="branch-option-copy"><span className="branch-option-heading"><strong>{branch.name}</strong><time dateTime={date.toISOString()}>{commitAge(commit.committedAt)}</time></span><small id={`commit-${branch.fullName}`}>{summary}</small></span>
      {reason ? <span className="branch-tag">{reason}</span> : <i className="codicon codicon-arrow-right branch-enter" aria-hidden="true" />}
    </button>
    {branch.kind === 'local' && <Button type="button" variant="ghost" size="icon-sm" className="branch-delete-action" disabled={locked || Boolean(deleteBlocked)} aria-label={`删除本地分支 ${branch.name}`} title={deleteBlocked ?? '删除本地分支'} onClick={() => void onDelete(branch)}><i className="codicon codicon-trash" aria-hidden="true" /></Button>}
  </div>;
}

/** 三个视图共享列表搜索和 Git 状态；取消编辑返回列表，不触发分支切换。 */
export function BranchPickerDialog({ worktree, open, onOpenChange }: {
  worktree: Worktree;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { branches, loadBranches, checkoutBranch, createBranch, previewDeleteBranch, deleteBranch, busy } = useWorkbench();
  const [view, setView] = useState<'list' | 'create' | 'delete'>('list');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [switchingRef, setSwitchingRef] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [startRef, setStartRef] = useState('');
  const [checkout, setCheckout] = useState(true);
  const [deleting, setDeleting] = useState<GitBranch | null>(null);
  const [preview, setPreview] = useState<GitDeleteBranchPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestVersion = useRef(0);
  const mutation = useRef(false);
  const locked = busy || submitting;
  const blocked = worktree.operation ? '请先完成或中止当前 Git 操作，再创建、删除或切换分支。' : null;
  const hasHead = worktree.hasHead !== false;
  const hasStart = hasHead || branches.items.some(branch => branch.kind === 'local' || branch.localName);
  const query = search.trim().toLowerCase();
  const filtered = branches.items.filter(branch => branch.name.toLowerCase().includes(query));
  const demo = worktree.source !== 'native';

  useEffect(() => {
    const requests = requestVersion;
    if (open) void loadBranches();
    return () => { ++requests.current; };
  }, [open, worktree.id, loadBranches]);

  useEffect(() => {
    if (view === 'list') searchRef.current?.focus();
    if (view === 'delete' && !previewing) dialogRef.current?.querySelector<HTMLButtonElement>('[data-branch-cancel]')?.focus();
  }, [view, previewing]);

  function currentRequest(version: number) {
    return version === requestVersion.current && useWorkbench.getState().activeWorktreeId === worktree.id;
  }

  function returnToList() {
    ++requestVersion.current;
    setView('list');
    setError(null);
    setPreview(null);
    setPreviewing(false);
    setConfirmed(false);
  }

  function close(value: boolean) {
    if (locked || mutation.current) return;
    if (!value && view !== 'list') returnToList();
    else { ++requestVersion.current; onOpenChange(value); }
  }

  async function switchBranch(fullName: string) {
    const branch = branches.items.find(item => item.fullName === fullName);
    if (!branch || locked || mutation.current || blocked || switchDisabledReason(branch, worktree.path)) return;
    mutation.current = true;
    const version = ++requestVersion.current;
    setError(null);
    setSubmitting(true);
    setSwitchingRef(branch.fullName);
    try {
      const result = await checkoutBranch(branch.fullName);
      if (!currentRequest(version)) return;
      if (result.warning) toast.warning(`已切换到 ${result.branch}`, { description: result.warning });
      else toast.success(`已切换到 ${result.branch}`, { description: demo ? '演示操作，未修改本地仓库' : worktree.name });
      onOpenChange(false);
    } catch (cause) {
      if (currentRequest(version)) setError(errorMessage(cause));
    } finally {
      mutation.current = false;
      if (currentRequest(version)) { setSubmitting(false); setSwitchingRef(null); }
    }
  }

  function openCreate() {
    if (locked || blocked || !hasStart) return;
    setName('');
    setStartRef(branches.items.find(branch => branch.current)?.fullName ?? (hasHead ? 'HEAD' : branches.items.find(branch => branch.kind === 'local' || branch.localName)?.fullName ?? ''));
    setCheckout(true);
    setError(null);
    setView('create');
  }

  async function create() {
    if (locked || mutation.current || blocked || !name.trim() || !startRef) return;
    mutation.current = true;
    const version = ++requestVersion.current;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createBranch(name.trim(), startRef, checkout);
      if (!currentRequest(version)) return;
      const title = result.switched ? `已创建并切换到 ${result.branch}` : `已创建分支 ${result.branch}`;
      if (result.warning) toast.warning(title, { description: result.warning });
      else toast.success(title, { description: demo ? '演示操作，未修改本地仓库' : undefined });
      setSubmitting(false);
      if (result.switched) onOpenChange(false);
      else returnToList();
    } catch (cause) {
      if (currentRequest(version)) setError(errorMessage(cause));
    } finally {
      mutation.current = false;
      if (currentRequest(version)) setSubmitting(false);
    }
  }

  /** 每次重读都撤销强制删除授权，过期预览不会沿用用户对旧提交的确认。 */
  async function inspectDelete(branch: GitBranch) {
    if (locked || blocked || branch.kind !== 'local' || branch.current || branch.worktreePath) return;
    const version = ++requestVersion.current;
    setDeleting(branch);
    setView('delete');
    setPreview(null);
    setConfirmed(false);
    setPreviewing(true);
    setError(null);
    try {
      const result = await previewDeleteBranch(branch.fullName);
      if (currentRequest(version)) setPreview(result);
    } catch (cause) {
      if (currentRequest(version)) setError(errorMessage(cause));
    } finally {
      if (currentRequest(version)) setPreviewing(false);
    }
  }

  async function remove() {
    if (!preview || locked || mutation.current || blocked || (preview.unmergedCommits > 0 && !confirmed)) return;
    mutation.current = true;
    const version = ++requestVersion.current;
    setSubmitting(true);
    setError(null);
    try {
      const result = await deleteBranch(preview, preview.unmergedCommits > 0 && confirmed);
      if (!currentRequest(version)) return;
      if (result.warning) toast.warning(`已删除 ${result.branch}`, { description: result.warning });
      else toast.success(`已删除 ${result.branch}`, { description: demo ? '演示操作，未修改本地仓库' : undefined });
      setSubmitting(false);
      returnToList();
    } catch (cause) {
      if (currentRequest(version)) {
        setError(errorMessage(cause));
        setConfirmed(false);
        setPreview(null);
      }
    } finally {
      mutation.current = false;
      if (currentRequest(version)) setSubmitting(false);
    }
  }

  /** 方向键只遍历切换按钮；删除按钮通过 Tab 单独访问，避免误触。 */
  function navigate(event: KeyboardEvent<HTMLElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if ((event.target as HTMLElement).closest('.branch-delete-action')) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.branch-option:not(:disabled)') ?? [])];
    if (!rows.length) return;
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 && event.key !== 'ArrowDown') return;
    event.preventDefault();
    if (event.key === 'ArrowUp' && index === 0) { searchRef.current?.focus(); return; }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
    rows[next].focus();
  }

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent ref={dialogRef} className={`branch-dialog branch-management-dialog ${view !== 'list' ? 'branch-form-dialog' : ''}`} onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus(); }}>
      <DialogHeader><DialogTitle>{view === 'create' ? '新建分支' : view === 'delete' ? '删除本地分支' : '分支管理'}</DialogTitle><DialogDescription>{view === 'create' ? `在 ${worktree.name} 中创建本地分支` : `${worktree.name} · 当前 ${worktree.branch}`}{demo && <span className="branch-demo-label">演示模式 · 模拟数据</span>}</DialogDescription></DialogHeader>
      {blocked && <p className="branch-operation-note" role="status">{blocked}</p>}
      {view === 'list' && <>
        <div className="branch-list-toolbar"><div className="branch-search"><i className="codicon codicon-search" aria-hidden="true" /><Input ref={searchRef} aria-label="搜索分支" placeholder="搜索本地或远程分支…" value={search} disabled={locked} onChange={event => setSearch(event.target.value)} onKeyDown={navigate} autoComplete="off" spellCheck={false} /><kbd>↑ ↓</kbd></div><Button type="button" disabled={locked || Boolean(blocked) || branches.loading || !hasStart} title={!hasStart ? '没有可用起点，请先完成首次提交。' : undefined} onClick={openCreate}><i className="codicon codicon-add" aria-hidden="true" />新建分支</Button></div>
        {!hasStart && !branches.loading && !branches.error && <p className="branch-operation-note">没有可用起点，请先完成首次提交。</p>}
        {(error || branches.error) && <pre className="inline-error" role="alert">{error || branches.error}</pre>}
        <div className="branch-results" ref={listRef} onKeyDown={navigate} aria-label="分支列表" aria-busy={branches.loading || locked}>
          {branches.loading ? <div className="branch-placeholder" role="status"><i className="codicon codicon-loading spin" aria-hidden="true" />正在读取分支…</div> : branches.error ? <div className="branch-placeholder"><Button variant="outline" onClick={() => void loadBranches()}>重新读取分支</Button></div> : filtered.length === 0 ? <div className="branch-placeholder">{query ? `没有匹配“${search}”的分支` : '暂无分支记录，完成首次提交后可在此查看。'}</div> : (['local', 'remote'] as const).map(kind => {
            const items = filtered.filter(branch => branch.kind === kind);
            if (!items.length) return null;
            return <section key={kind} className="branch-section" aria-label={kind === 'local' ? '本地分支' : '远程分支'}>
              <div className="branch-section-heading">{kind === 'local' ? '本地分支' : '远程分支'}<span>{items.length}</span><small>最近提交优先</small></div>
              {items.map(branch => <BranchRow key={branch.fullName} branch={branch} worktreePath={worktree.path} locked={locked} blocked={blocked} switching={switchingRef === branch.fullName} onSwitch={switchBranch} onDelete={inspectDelete} />)}
            </section>;
          })}
        </div>
        <p className="branch-footer">远程分支来自本地已获取的记录，选择后会建立或使用对应的本地跟踪分支。</p>
      </>}
      {view === 'create' && <>
        {error && <pre className="inline-error" role="alert">{error}</pre>}
        <BranchCreateForm branches={branches.items} hasHead={hasHead} name={name} startRef={startRef} checkout={checkout} locked={locked} blocked={blocked} onNameChange={setName} onStartChange={setStartRef} onCheckoutChange={setCheckout} onSubmit={() => void create()} onCancel={returnToList} />
      </>}
      {view === 'delete' && <>
        <div className="branch-delete-target"><i className="codicon codicon-git-branch" aria-hidden="true" /><strong>{deleting?.name}</strong></div>
        {error && <pre className="inline-error" role="alert">{error}</pre>}
        {previewing ? <div className="branch-placeholder" role="status"><i className="codicon codicon-loading spin" aria-hidden="true" />正在检查分支…</div> : preview ? <BranchDeleteConfirmation preview={preview} confirmed={confirmed} locked={locked} blocked={blocked} onConfirmedChange={setConfirmed} onDelete={() => void remove()} onCancel={returnToList} /> : <div className="branch-form-actions"><Button variant="outline" data-branch-cancel disabled={locked} onClick={returnToList}>取消</Button><Button disabled={locked || Boolean(blocked) || !deleting} onClick={() => deleting && void inspectDelete(deleting)}>重新检查分支</Button></div>}
      </>}
    </DialogContent>
  </Dialog>;
}
