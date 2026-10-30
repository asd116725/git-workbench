import { translateMessage } from '../lib/i18n-system';
import { t, useI18n } from '../lib/i18n';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { remoteBlockReason } from '../lib/remote-view';
import { useWorkbench } from '../lib/store';
import type { GitRemoteAction, Worktree } from '../lib/types';

/** 保留原始文案键，渲染和异步完成时再按当前语言翻译。 */
const actions = [
  { action: 'fetch', label: "获取", icon: 'cloud-download' },
  { action: 'pull', label: "拉取", icon: 'arrow-down' },
  { action: 'push', label: "推送", icon: 'arrow-up' },
] as const;

/** 发布只说明目标与跟踪关系，提交差异仅用于已有上游的推送。 */
function actionDescription(worktree: Worktree, action: GitRemoteAction, needsPublish: boolean) {
  const remote = worktree.remote;
  if (action === 'fetch') return t("获取所有远程仓库的最新引用");
  if (action === 'pull') return t("从 {value1} 拉取，只允许快进；分叉时请先合并", { value1: remote?.upstream ?? '' });
  const destination = remote?.upstream ?? (remote?.defaultRemote ? `${remote.defaultRemote}/${worktree.branch}` : null);
  if (needsPublish) return destination
    ? t("发布到 {destination}，并建立上游跟踪。", { destination })
    : t("选择远程仓库发布当前分支，并建立上游跟踪。");
  const count = remote?.upstream ? remote.ahead : null;
  const pending = count == null ? t("待上传数量未知") : count > 0 ? t("{value1} 个待上传提交", { value1: count }) : t("没有待上传提交");
  return [destination ? t("推送到 {value1}", { value1: destination }) : t("选择远程仓库并推送当前分支"), pending,
    t("数量基于最近获取的远程引用"),
  ].join(' · ');
}

/** 远程操作复用工作区互斥锁；只有首次推送目标不明确时才要求选择远程仓库。 */
export function RemoteActions({ worktree }: { worktree: Worktree }) {
  useI18n();
  const { busy, refreshing, remoteOperation, runRemote } = useWorkbench();
  const [choosingRemote, setChoosingRemote] = useState(false);
  const [selectedRemote, setSelectedRemote] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const remote = worktree.remote;
  /** 残缺的上游配置仍由推送流程报错，不能当作首次发布。 */
  const needsPublish = Boolean(remote && !remote.upstream && !remote.upstreamRemote);
  const count = remote?.upstream ? remote.ahead : null;
  const pushBlocked = remoteBlockReason(worktree, 'push');
  const locked = busy || refreshing;

  async function execute(action: GitRemoteAction, target?: string) {
    setDialogError(null);
    const sourceLabel = actions.find(item => item.action === action)!.label;
    const publishing = action === 'push' && needsPublish;
    try {
      const result = await runRemote(action, target);
      setChoosingRemote(false);
      if (result.warning) toast.warning(publishing ? t("分支已推送，请查看仓库状态中的警告") : t("{value1}已完成，请查看仓库状态中的警告", { value1: t(sourceLabel) }));
      else toast.success(publishing ? t("分支发布成功") : t("{value1}完成", { value1: t(sourceLabel) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDialogError(message);
      toast.error(publishing ? t("分支发布失败") : t("{value1}失败", { value1: t(sourceLabel) }), { description: translateMessage(message).slice(0, 120) });
    }
  }

  function start(action: GitRemoteAction) {
    if (action === 'push' && needsPublish && !remote?.defaultRemote) {
      setSelectedRemote(remote?.remotes[0] ?? '');
      setDialogError(null);
      setChoosingRemote(true);
    } else void execute(action);
  }

  return <>
    {actions.map(({ action, label: sourceLabel, icon }) => {
      const publishing = action === 'push' && needsPublish;
      const label = publishing ? t("发布分支") : t(sourceLabel);
      const progressLabel = publishing ? t("发布中…") : t("{value1}中", { value1: label });
      const running = remoteOperation === action;
      const blocked = remoteBlockReason(worktree, action);
      const pending = action === 'push' && count != null && count > 0;
      const ariaLabel = running ? progressLabel : pending ? t("{value1}，{value2} 个待上传提交", { value1: label, value2: count }) : label;
      const description = running
        ? (publishing ? t("发布中，请稍候…") : t("{value1}中，请稍候…", { value1: label }))
        : actionDescription(worktree, action, needsPublish);
      return <Tooltip key={action}>
        <TooltipTrigger asChild><span className="remote-action-trigger"><Button variant="ghost" size="sm" className="remote-action"
          disabled={locked || Boolean(blocked)} aria-label={ariaLabel} aria-busy={running} onClick={() => start(action)}>
          <span className="remote-action-icon"><i className={`codicon codicon-${running ? 'loading' : icon}${running ? ' spin' : ''}`} aria-hidden="true" />
            {pending && <Badge variant="secondary" className="count-badge remote-count" aria-hidden="true">{count}</Badge>}</span>
          {running ? progressLabel : label}
        </Button></span></TooltipTrigger>
        <TooltipContent>{blocked ? translateMessage(blocked) : description}</TooltipContent>
      </Tooltip>;
    })}
    <Dialog open={choosingRemote} onOpenChange={open => { if (!busy) setChoosingRemote(open); }}>
      <DialogContent className="branch-dialog remote-dialog" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{t("发布分支")}</DialogTitle><DialogDescription>{t("选择接收 {branch} 的远程仓库。", { branch: worktree.branch })}</DialogDescription></DialogHeader>
        <form onSubmit={event => { event.preventDefault(); if (!locked && !pushBlocked && remote?.remotes.includes(selectedRemote)) void execute('push', selectedRemote); }}>
          <div className="branch-form-fields">
            <Field><FieldLabel htmlFor="push-remote">{t("远程仓库")}</FieldLabel><select id="push-remote" value={selectedRemote} onChange={event => setSelectedRemote(event.target.value)} disabled={locked} aria-describedby="push-remote-description">
              {remote?.remotes.map(name => <option key={name} value={name}>{name}</option>)}
            </select><FieldDescription id="push-remote-description">{t("发布到 {destination}，并建立上游跟踪。", { destination: `${selectedRemote}/${worktree.branch}` })}</FieldDescription></Field>
            {(dialogError || pushBlocked) && <p className="remote-dialog-error" role="alert">{translateMessage(dialogError ?? pushBlocked ?? '')}</p>}
          </div>
          <div className="branch-form-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => setChoosingRemote(false)}>{t("取消")}</Button><Button type="submit" disabled={locked || Boolean(pushBlocked) || !remote?.remotes.includes(selectedRemote)}>{remoteOperation === 'push' ? t("发布中…") : t("发布分支")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
