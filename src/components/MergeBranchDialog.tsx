import { translateMessage } from '../lib/i18n-system';
import { getLanguage, t, useI18n } from '../lib/i18n';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useWorkbench } from '../lib/store';
import { mergeStartBlockReason } from '../lib/merge-view';
import type { GitBranch, GitMergePreview, Worktree } from '../lib/types';
import { commitAge } from './branch-display';
import './merge-dialog.css';

type MergeSource = Pick<GitBranch, 'fullName' | 'name'>;

function MergeBranchOption({ branch, selected, disabled, targetPath, onSelect }: {
  branch: GitBranch;
  selected: boolean;
  disabled: boolean;
  targetPath: string;
  onSelect: (source: MergeSource) => Promise<void>;
}) {
  useI18n();
  const commit = branch.lastCommit;
  const summary = `${commit.author} · ${commit.shortHash} · ${commit.subject || t("（无提交说明）")}`;
  const date = new Date(commit.committedAt * 1000);
  return <button type="button" className={`branch-option ${selected ? 'is-current' : ''}`} disabled={disabled} aria-label={t("选择 {value1} 作为合并来源", { value1: branch.name })} aria-pressed={selected} title={`${branch.name}\n${summary}\n${date.toLocaleString(getLanguage())}`} onClick={() => void onSelect({ fullName: branch.fullName, name: branch.name })}>
    <i className={`codicon codicon-${selected ? 'check' : branch.kind === 'remote' ? 'cloud' : 'git-branch'}`} aria-hidden="true" />
    <span className="branch-option-copy"><span className="branch-option-heading"><strong>{branch.name}</strong><time dateTime={date.toISOString()}>{commitAge(commit.committedAt)}</time></span><small>{summary}</small></span>
    {branch.worktreePath && branch.worktreePath !== targetPath && <span className="branch-tag" title={branch.worktreePath}>{t("其他工作区")}</span>}
  </button>;
}

/** 先预览来源与目标，只有显式确认才执行合并；其他工作区使用中的分支仍可作为来源。 */
export function MergeBranchDialog({ worktree, open, onOpenChange }: {
  worktree: Worktree;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  useI18n();
  const { branches, loadBranches, previewMerge, mergeBranch, busy } = useWorkbench();
  /** 固定打开弹窗时的目标，避免外部检出后确认按钮悄悄变成另一个分支。 */
  const [target] = useState({ id: worktree.id, path: worktree.path, branch: worktree.branch });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<MergeSource | null>(null);
  const [preview, setPreview] = useState<GitMergePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [noFf, setNoFf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previewVersion = useRef(0);
  const locked = busy || submitting;
  const query = search.trim().toLowerCase();
  const filtered = branches.items.filter(({ current, name }) => !current && name.toLowerCase().includes(query));
  const blocked = worktree.id !== target.id || worktree.path !== target.path || worktree.branch !== target.branch
    ? t("当前工作区或分支已变化，请关闭弹窗后重新选择。")
    : mergeStartBlockReason(worktree);

  useEffect(() => {
    const requests = previewVersion;
    if (open) void loadBranches();
    return () => { ++requests.current; };
  }, [open, worktree.id, loadBranches]);

  async function selectSource(branch: MergeSource) {
    if (locked || blocked) return;
    const version = ++previewVersion.current;
    setSelected(branch);
    setPreview(null);
    setPreviewing(true);
    setError(null);
    try {
      const next = await previewMerge(branch.fullName);
      if (version !== previewVersion.current || useWorkbench.getState().activeWorktreeId !== target.id) return;
      if (next.targetBranch !== target.branch) throw new Error("当前分支已变化，请刷新后重新打开合并。");
      setPreview(next);
    } catch (cause) {
      if (version === previewVersion.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (version === previewVersion.current) setPreviewing(false);
    }
  }

  async function confirmMerge() {
    if (!preview || locked || blocked || previewing) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await mergeBranch(preview, noFf);
      if (result.outcome === 'conflicts') {
        toast.warning(t("合并存在冲突"), { description: result.warning ? translateMessage(result.warning) : t("请在主界面解决冲突并暂存，然后完成合并；也可以中止合并。") });
      } else if (result.outcome === 'pending') {
        toast.warning(t("合并尚未完成"), { description: result.warning ? translateMessage(result.warning) : t("请在主界面检查并完成合并，或中止本次合并。") });
      } else if (result.outcome === 'upToDate') {
        if (result.warning) toast.warning(t("当前分支已包含来源提交，无需合并。"), { description: translateMessage(result.warning) });
        else toast.info(t("当前分支已包含来源提交，无需合并。"));
      } else if (result.warning) {
        toast.warning(t("已合并到 {value1}", { value1: target.branch }), { description: translateMessage(result.warning) });
      } else {
        toast.success(result.outcome === 'fastForward' ? t("已快进合并到 {value1}", { value1: target.branch }) : t("已合并到 {value1}", { value1: target.branch }));
      }
      onOpenChange(false);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setSubmitting(false); }
  }

  /** 列表支持方向键导航，Enter 只选择来源，不直接触发合并。 */
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

  return <Dialog open={open} onOpenChange={value => { if (!locked) onOpenChange(value); }}>
    <DialogContent className="branch-dialog merge-dialog" showCloseButton={!locked} onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus(); }}>
      <DialogHeader><DialogTitle>{t("合并到 {branch}", { branch: target.branch })}</DialogTitle><DialogDescription>{t("选择来源分支，将它的已提交内容合入当前分支。")}</DialogDescription></DialogHeader>
      <div className="branch-search"><i className="codicon codicon-search" aria-hidden="true" /><Input ref={searchRef} aria-label={t("搜索合并来源分支")} placeholder={t("搜索本地或远程分支…")} value={search} disabled={locked} onChange={event => setSearch(event.target.value)} onKeyDown={navigate} autoComplete="off" spellCheck={false} /><kbd>↑ ↓</kbd></div>
      {(blocked || error || branches.error) && <pre className="inline-error" role="alert">{translateMessage(blocked || error || branches.error || '')}</pre>}
      <div className="branch-results" ref={listRef} onKeyDown={navigate} aria-label={t("合并来源分支列表")} aria-busy={branches.loading || locked}>
        {branches.loading ? <div className="branch-placeholder" role="status"><i className="codicon codicon-loading spin" aria-hidden="true" />{t("正在读取分支…")}</div>
          : branches.error ? <div className="branch-placeholder"><Button variant="outline" disabled={locked} onClick={() => void loadBranches()}>{t("重新读取分支")}</Button></div>
            : filtered.length === 0 ? <div className="branch-placeholder">{query ? t("没有匹配“{value1}”的分支", { value1: search }) : t("暂无其他可合并的分支。")}</div>
              : (['local', 'remote'] as const).map(kind => {
                const items = filtered.filter(branch => branch.kind === kind);
                if (!items.length) return null;
                return <section key={kind} className="branch-section" aria-label={kind === 'local' ? t("本地分支") : t("远程分支")}>
                  <div className="branch-section-heading">{kind === 'local' ? t("本地分支") : t("远程分支")}<span>{items.length}</span><small>{t("最近提交优先")}</small></div>
                  {items.map(branch => <MergeBranchOption key={branch.fullName} branch={branch} selected={selected?.fullName === branch.fullName} disabled={locked || Boolean(blocked)} targetPath={target.path} onSelect={selectSource} />)}
                </section>;
              })}
      </div>
      <div className="merge-confirmation">
        <div className="merge-preview" aria-live="polite" aria-busy={previewing}>
          {selected ? <>
            <div className="merge-direction"><strong title={selected.name}>{selected.name}</strong><i className="codicon codicon-arrow-right" aria-hidden="true" /><strong title={target.branch}>{target.branch}</strong></div>
            {previewing ? <p><i className="codicon codicon-loading spin" aria-hidden="true" />{t("正在检查合并…")}</p>
              : preview ? <p>{preview.upToDate ? t("当前分支已包含来源提交，无需合并。") : t("{value1} 个待合入提交 · {value2}", { value1: preview.incomingCommits, value2: preview.fastForward && !noFf ? t("可快进合并") : t("将创建合并提交，执行时仍可能出现冲突") })}</p>
                : <Button variant="outline" size="sm" disabled={locked || Boolean(blocked)} onClick={() => void selectSource(selected)}>{t("重新检查合并")}</Button>}
          </> : <p>{t("请先选择要合入的来源分支。")}</p>}
        </div>
        <label className="merge-strategy"><input type="checkbox" checked={noFf} disabled={locked || Boolean(blocked)} onChange={event => setNoFf(event.target.checked)} /><span>{t("始终创建合并提交")}</span></label>
        <p className="merge-source-hint">{t("远程分支来自本地已获取的记录；合并不包含其他工作区尚未提交的更改。")}</p>
        <div className="merge-dialog-actions"><Button variant="outline" disabled={locked} onClick={() => onOpenChange(false)}>{t("取消")}</Button><Button disabled={locked || Boolean(blocked) || previewing || !preview || preview.upToDate} onClick={() => void confirmMerge()}>{submitting ? <><i className="codicon codicon-loading spin" aria-hidden="true" />{t("正在合并…")}</> : <><i className="codicon codicon-git-merge" aria-hidden="true" /><span>{t("合并到 {branch}", { branch: target.branch })}</span></>}</Button></div>
      </div>
    </DialogContent>
  </Dialog>;
}
