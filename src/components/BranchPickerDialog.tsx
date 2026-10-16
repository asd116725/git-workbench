import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useWorkbench } from '../lib/store';
import type { GitBranch, Worktree } from '../lib/types';

const relativeTime = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'always' });

/** 提交时间为 Unix 秒，保留未来时间语义，避免系统时钟差异显示成负数。 */
function commitAge(committedAt: number) {
  const seconds = (Date.now() / 1000) - committedAt;
  const units = [['year', 365 * 86400], ['month', 30 * 86400], ['week', 7 * 86400], ['day', 86400], ['hour', 3600], ['minute', 60]] as const;
  const unit = units.find(([, duration]) => Math.abs(seconds) >= duration);
  return unit ? relativeTime.format(-Math.trunc(seconds / unit[1]), unit[0]) : '刚刚';
}

/** 搜索并切换当前工作区分支；其他 worktree 占用的分支只展示，不强制检出。 */
export function BranchPickerDialog({ worktree, open, onOpenChange }: {
  worktree: Worktree;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { branches, loadBranches, checkoutBranch, busy } = useWorkbench();
  const [search, setSearch] = useState('');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [switchingRef, setSwitchingRef] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const query = search.trim().toLowerCase();
  const filtered = branches.items.filter(branch => branch.name.toLowerCase().includes(query));

  useEffect(() => {
    if (open) void loadBranches();
  }, [open, worktree.id, loadBranches]);

  function disabledReason(branch: GitBranch) {
    if (branch.current) return '当前分支';
    if (branch.worktreePath && branch.worktreePath !== worktree.path) return '其他工作区使用中';
    if (branch.kind === 'remote' && !branch.localName) return '远程未配置';
    return null;
  }

  async function switchBranch(branch: GitBranch) {
    if (busy || disabledReason(branch)) return;
    setCheckoutError(null);
    setSwitchingRef(branch.fullName);
    try {
      const result = await checkoutBranch(branch.fullName);
      if (result.warning) toast.warning(`已切换到 ${result.branch}`, { description: result.warning });
      else toast.success(`已切换到 ${result.branch}`, { description: worktree.name });
      onOpenChange(false);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : String(error));
    } finally { setSwitchingRef(null); }
  }

  /** 键盘只在可切换项间移动；回到搜索框后可继续过滤长分支列表。 */
  function navigate(event: KeyboardEvent<HTMLElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (!rows.length) return;
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 && event.key !== 'ArrowDown') return;
    event.preventDefault();
    if (event.key === 'ArrowUp' && index === 0) { searchRef.current?.focus(); return; }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
    rows[next].focus();
  }

  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <DialogContent className="branch-dialog" onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus(); }}>
      <DialogHeader><DialogTitle>切换分支</DialogTitle><DialogDescription>{worktree.name} · 当前 {worktree.branch}</DialogDescription></DialogHeader>
      <div className="branch-search"><i className="codicon codicon-search" aria-hidden="true" /><Input ref={searchRef} aria-label="搜索分支" placeholder="搜索本地或远程分支…" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} onKeyDown={navigate} autoComplete="off" spellCheck={false} /><kbd>↑ ↓</kbd></div>
      {(checkoutError || branches.error) && <pre className="inline-error" role="alert">{checkoutError || branches.error}</pre>}
      <div className="branch-results" ref={listRef} onKeyDown={navigate} aria-label="分支列表" aria-busy={branches.loading || busy}>
        {branches.loading ? <div className="branch-placeholder" role="status"><i className="codicon codicon-loading spin" aria-hidden="true" />正在读取分支…</div> : branches.error ? <div className="branch-placeholder"><Button variant="outline" onClick={() => void loadBranches()}>重新读取分支</Button></div> : filtered.length === 0 ? <div className="branch-placeholder">{query ? `没有匹配“${search}”的分支` : '暂无分支记录，完成首次提交后可在此查看。'}</div> : (['local', 'remote'] as const).map(kind => {
          const items = filtered.filter(branch => branch.kind === kind);
          if (!items.length) return null;
          return <section key={kind} className="branch-section" aria-label={kind === 'local' ? '本地分支' : '远程分支'}>
            <div className="branch-section-heading">{kind === 'local' ? '本地分支' : '远程分支'}<span>{items.length}</span><small>最近提交优先</small></div>
            {items.map(branch => {
              const reason = disabledReason(branch);
              const context = branch.worktreePath && branch.worktreePath !== worktree.path ? branch.worktreePath : kind === 'remote' ? `本地跟踪分支：${branch.localName ?? '无法确定'}` : branch.upstream ? `跟踪 ${branch.upstream.replace(/^refs\/remotes\//, '')}` : '本地分支';
              const commit = branch.lastCommit;
              const summary = `${commit.author} · ${commit.shortHash} · ${commit.subject || '（无提交说明）'}`;
              const date = new Date(commit.committedAt * 1000);
              return <button type="button" key={branch.fullName} className={`branch-option ${branch.current ? 'is-current' : ''}`} disabled={busy || Boolean(reason)} aria-label={`切换到 ${branch.name}`} aria-describedby={`commit-${branch.fullName}`} aria-current={branch.current ? 'true' : undefined} title={`${branch.name}\n${summary}\n${date.toLocaleString('zh-CN')}\n${reason ?? '切换分支'} · ${context}`} onClick={() => void switchBranch(branch)}>
                <i className={`codicon codicon-${switchingRef === branch.fullName ? 'loading spin' : branch.current ? 'check' : kind === 'remote' ? 'cloud' : 'git-branch'}`} aria-hidden="true" />
                <span className="branch-option-copy"><span className="branch-option-heading"><strong>{branch.name}</strong><time dateTime={date.toISOString()}>{commitAge(commit.committedAt)}</time></span><small id={`commit-${branch.fullName}`}>{summary}</small></span>
                {reason ? <span className="branch-tag">{reason}</span> : <i className="codicon codicon-arrow-right branch-enter" aria-hidden="true" />}
              </button>;
            })}
          </section>;
        })}
      </div>
      <p className="branch-footer">远程分支来自本地已获取的记录，选择后会建立或使用对应的本地跟踪分支。</p>
    </DialogContent>
  </Dialog>;
}
