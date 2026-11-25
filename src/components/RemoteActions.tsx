import { translateMessage } from '../lib/i18n-system';
import { t, useI18n } from '../lib/i18n';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDisplayNames } from '../lib/display-names';
import { mergeStartBlockReason } from '../lib/merge-view';
import { remoteBlockReason, remoteCheckFor, remoteIntegration } from '../lib/remote-view';
import { isActiveWorktreeBusy, pushForWorktree, useWorkbench } from '../lib/store';
import type { GitRemoteAction, Worktree } from '../lib/types';
import type { MergeSource } from './MergeBranchDialog';

/** 保留原始文案键，渲染和异步完成时再按当前语言翻译。 */
const actions = [
  { action: 'fetch', label: "获取", icon: 'cloud-download' },
  { action: 'pull', label: "拉取", icon: 'arrow-down' },
  { action: 'push', label: "推送", icon: 'arrow-up' },
] as const;

/** 发布只说明目标与跟踪关系，已有上游时展示拉取或推送的提交差异。 */
function actionDescription(worktree: Worktree, action: GitRemoteAction, needsPublish: boolean, checked: boolean) {
  const remote = worktree.remote;
  if (action === 'fetch') return t("获取所有远程仓库的最新引用");
  if (action === 'pull') {
    const count = remote?.upstream ? remote.behind : null;
    const pending = count == null || (!checked && count === 0) ? t("待拉取数量未知") : count > 0 ? t("{value1} 个待拉取提交", { value1: count }) : t("没有待拉取提交");
    return [t("从 {value1} 拉取，只允许快进；分叉时请先合并", { value1: remote?.upstream ?? '' }), pending, t("数量基于最近获取的远程引用")].join(' · ');
  }
  const destination = remote?.upstream ?? (remote?.defaultRemote ? `${remote.defaultRemote}/${worktree.branch}` : null);
  if (needsPublish) return destination
    ? t("发布到 {destination}，并建立上游跟踪。", { destination })
    : t("选择远程仓库发布当前分支，并建立上游跟踪。");
  const count = remote?.upstream ? remote.ahead : null;
  const pending = count == null || (!checked && count === 0) ? t("待推送数量未知") : count > 0 ? t("{value1} 个待推送提交", { value1: count }) : t("没有待推送提交");
  return [destination ? t("推送到 {value1}", { value1: destination }) : t("选择远程仓库并推送当前分支"), pending,
    t("数量基于最近获取的远程引用"),
  ].join(' · ');
}

/** 获取和拉取沿用前台互斥；推送状态归发起工作树，首次发布确认后立即关闭弹窗。 */
export function RemoteActions({ worktree }: { worktree: Worktree }) {
  useI18n();
  const state = useWorkbench();
  const { busy, refreshing, remoteOperation, remoteCheck, runRemote } = state;
  const push = pushForWorktree(state, worktree.id);
  const [choosingRemote, setChoosingRemote] = useState(false);
  const [selectedRemote, setSelectedRemote] = useState('');
  const remote = worktree.remote;
  const check = remoteCheckFor(worktree, remoteCheck);
  const integration = remoteIntegration(worktree, check);
  /** 残缺的上游配置仍由推送流程报错，不能当作首次发布。 */
  const needsPublish = Boolean(remote && !remote.upstream && !remote.upstreamRemote);
  const pushBlocked = remoteBlockReason(worktree, 'push');
  const locked = busy || refreshing || Boolean(push);

  async function execute(action: GitRemoteAction, target?: string) {
    const sourceLabel = actions.find(item => item.action === action)!.label;
    const publishing = action === 'push' && needsPublish;
    let context: string | undefined;
    if (action === 'push') {
      const repository = state.repositories.find(item => item.worktrees.some(tree => tree.id === worktree.id));
      const name = (repository && (useDisplayNames.getState().names[repository.id] ?? repository.name)) ?? worktree.name;
      context = `${name} / ${worktree.branch}`;
      setChoosingRemote(false);
    }
    try {
      const result = await runRemote(action, target);
      if (result.warning) toast.warning(publishing ? t("分支已推送，请查看仓库状态中的警告") : t("{value1}已完成，请查看仓库状态中的警告", { value1: t(sourceLabel) }), { description: context });
      else toast.success(publishing ? t("分支发布成功") : t("{value1}完成", { value1: t(sourceLabel) }), { description: context });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(publishing ? t("分支发布失败") : t("{value1}失败", { value1: t(sourceLabel) }), {
        description: [context, translateMessage(message).slice(0, 120)].filter(Boolean).join(' · '),
      });
    }
  }

  function start(action: GitRemoteAction) {
    if (action === 'push' && needsPublish && !remote?.defaultRemote) {
      setSelectedRemote(remote?.remotes[0] ?? '');
      setChoosingRemote(true);
    } else void execute(action);
  }

  return <>
    {actions.map(({ action, label: sourceLabel, icon }) => {
      const publishing = action === 'push' && needsPublish;
      const label = publishing ? t("发布分支") : t(sourceLabel);
      const progressLabel = publishing ? t("发布中…") : t("{value1}中", { value1: label });
      const running = action === 'push' ? push?.worktreeId === worktree.id : remoteOperation === action;
      /** 推送目标可能不同于拉取上游，由原生命令核验实际目标。 */
      const blocked = remoteBlockReason(worktree, action) ?? (action === 'pull' && integration?.fresh && integration.ahead > 0
        ? '当前分支与远端已分叉，请先合并。' : null);
      const checking = action === 'fetch' && Boolean(check?.checking);
      const count = remote?.upstream ? action === 'pull' ? remote.behind : action === 'push' ? remote.ahead : null : null;
      const pending = count != null && count > 0;
      const ariaLabel = running ? progressLabel : pending
        ? t(action === 'pull' ? "{value1}，{value2} 个待拉取提交" : "{value1}，{value2} 个待推送提交", { value1: label, value2: count }) : label;
      const description = running
        ? (publishing ? t("发布中，请稍候…") : t("{value1}中，请稍候…", { value1: label }))
        : actionDescription(worktree, action, needsPublish, Boolean(check && !check.checking && !check.error));
      return <Tooltip key={action}>
        <TooltipTrigger asChild><span className="remote-action-trigger"><Button variant="ghost" size="sm" className="remote-action"
          disabled={locked || Boolean(blocked)} aria-label={ariaLabel} aria-busy={running || checking} onClick={() => start(action)}>
          <span className="remote-action-icon"><i className={`codicon codicon-${running || checking ? 'loading spin' : icon}`} aria-hidden="true" />
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
            {pushBlocked && <p className="remote-dialog-error" role="alert">{translateMessage(pushBlocked)}</p>}
          </div>
          <div className="branch-form-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => setChoosingRemote(false)}>{t("取消")}</Button><Button type="submit" disabled={locked || Boolean(pushBlocked) || !remote?.remotes.includes(selectedRemote)}>{t("发布分支")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}

/** 远端检查在状态栏单独提示，获取按钮可随时发起手动重试。 */
export function RemoteCheckIndicator({ worktree }: { worktree: Worktree }) {
  useI18n();
  const { remoteCheck } = useWorkbench();
  if (worktree.source !== 'native' || !worktree.remote?.remotes.length) return null;
  const check = remoteCheckFor(worktree, remoteCheck);
  const error = check?.error;
  const message = check?.checking ? t('正在检查远程…') : error ? t('远程检查失败，计数可能过期') : !check ? t('尚未检查远程，计数可能过期') : '';
  return <span className="remote-check-status" role="status">
    {message && <Tooltip><TooltipTrigger asChild><span className="remote-check-label" tabIndex={error ? 0 : undefined}>
      <i className={`codicon codicon-${check?.checking ? 'cloud-download' : error ? 'warning' : 'info'}`} aria-hidden="true" />{message}
    </span></TooltipTrigger><TooltipContent className="remote-check-tooltip">{error ? <>{t('点击「获取」可重试。')}<br />{translateMessage(error)}</> : message}</TooltipContent></Tooltip>}
  </span>;
}

/** 已确认落后时建议拉取，分叉时复用合并预览供用户确认。 */
export function RemoteIntegrationNotice({ worktree, onMerge }: { worktree: Worktree; onMerge: (source: MergeSource) => void }) {
  useI18n();
  const state = useWorkbench();
  const { refreshing, remoteCheck } = state;
  const busy = isActiveWorktreeBusy(state);
  const integration = remoteIntegration(worktree, remoteCheck);
  if (!integration) return null;
  const { ahead, behind, source, fresh } = integration;
  if (!fresh && !(ahead > 0 && source)) return null;
  const mergeBlocked = mergeStartBlockReason(worktree);
  const guidance = !fresh ? t('按最近获取的引用：本地领先 {ahead} / 远端领先 {behind}。', { ahead, behind })
    : ahead > 0 ? t('本地领先 {ahead} / 远端领先 {behind}，请先合并。', { ahead, behind })
    : t('远端领先 {behind} 个提交，请先拉取。', { behind });
  return <div className="remote-integration">
    <i className={`codicon codicon-${ahead > 0 ? 'git-merge' : 'arrow-down'}`} aria-hidden="true" />
    <span role="status">{guidance}</span>
    {ahead > 0 && source && <Tooltip><TooltipTrigger asChild><span className="remote-action-trigger"><Button size="sm" variant="outline" disabled={busy || refreshing || Boolean(mergeBlocked)} onClick={() => onMerge(source)}>{t('合并上游')}</Button></span></TooltipTrigger>
      <TooltipContent>{mergeBlocked ? translateMessage(mergeBlocked) : source.name}</TooltipContent></Tooltip>}
  </div>;
}
