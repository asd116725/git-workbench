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

const actions = [
  { action: 'fetch', label: '获取', icon: 'cloud-download' },
  { action: 'pull', label: '拉取', icon: 'arrow-down' },
  { action: 'push', label: '推送', icon: 'arrow-up' },
] as const;

function actionDescription(worktree: Worktree, action: GitRemoteAction) {
  const remote = worktree.remote;
  if (action === 'fetch') return '获取所有远程仓库的最新引用';
  if (action === 'pull') return `从 ${remote?.upstream} 拉取，只允许快进；分叉时请先合并`;
  const destination = remote?.upstream ?? (remote?.defaultRemote ? `${remote.defaultRemote}/${worktree.branch}` : null);
  const count = remote?.ahead;
  const pending = count == null ? '待上传数量未知' : count > 0 ? `${count} 个待上传提交` : '没有待上传提交';
  return [destination ? `推送到 ${destination}` : '选择远程仓库并推送当前分支', pending,
    !remote?.upstream && '首次推送将建立上游跟踪', '数量基于最近获取的远程引用',
  ].filter(Boolean).join('；');
}

/** 远程操作复用工作区互斥锁；只有首次推送目标不明确时才要求选择远程仓库。 */
export function RemoteActions({ worktree }: { worktree: Worktree }) {
  const { busy, refreshing, remoteOperation, runRemote } = useWorkbench();
  const [choosingRemote, setChoosingRemote] = useState(false);
  const [selectedRemote, setSelectedRemote] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const remote = worktree.remote;
  const count = remote?.ahead;
  const pushBlocked = remoteBlockReason(worktree, 'push');
  const locked = busy || refreshing;

  async function execute(action: GitRemoteAction, target?: string) {
    setDialogError(null);
    const label = actions.find(item => item.action === action)!.label;
    try {
      const result = await runRemote(action, target);
      setChoosingRemote(false);
      if (result.warning) toast.warning(`${label}已完成，请查看仓库状态中的警告`);
      else toast.success(`${label}完成`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDialogError(message);
      toast.error(`${label}失败`, { description: message.split('\n')[0].slice(0, 120) });
    }
  }

  function start(action: GitRemoteAction) {
    if (action === 'push' && !remote?.upstream && !remote?.defaultRemote) {
      setSelectedRemote(remote?.remotes[0] ?? '');
      setDialogError(null);
      setChoosingRemote(true);
    } else void execute(action);
  }

  return <>
    {actions.map(({ action, label, icon }) => {
      const running = remoteOperation === action;
      const blocked = remoteBlockReason(worktree, action);
      const pending = action === 'push' && count != null && count > 0;
      const ariaLabel = running ? `${label}中` : pending ? `${label}，${count} 个待上传提交` : label;
      return <Tooltip key={action}>
        <TooltipTrigger asChild><span className="remote-action-trigger"><Button variant="ghost" size="sm" className="remote-action"
          disabled={locked || Boolean(blocked)} aria-label={ariaLabel} aria-busy={running} onClick={() => start(action)}>
          <span className="remote-action-icon"><i className={`codicon codicon-${running ? 'loading' : icon}${running ? ' spin' : ''}`} aria-hidden="true" />
            {pending && <Badge variant="secondary" className="count-badge remote-count" aria-hidden="true">{count}</Badge>}</span>
          {running ? `${label}中` : label}
        </Button></span></TooltipTrigger>
        <TooltipContent>{blocked ?? (running ? `${label}中，请稍候…` : actionDescription(worktree, action))}</TooltipContent>
      </Tooltip>;
    })}
    <Dialog open={choosingRemote} onOpenChange={open => { if (!busy) setChoosingRemote(open); }}>
      <DialogContent className="branch-dialog remote-dialog" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>推送当前分支</DialogTitle><DialogDescription>选择接收 {worktree.branch} 的远程仓库。</DialogDescription></DialogHeader>
        <form onSubmit={event => { event.preventDefault(); if (!locked && !pushBlocked && remote?.remotes.includes(selectedRemote)) void execute('push', selectedRemote); }}>
          <div className="branch-form-fields">
            <Field><FieldLabel htmlFor="push-remote">远程仓库</FieldLabel><select id="push-remote" value={selectedRemote} onChange={event => setSelectedRemote(event.target.value)} disabled={locked} aria-describedby="push-remote-description">
              {remote?.remotes.map(name => <option key={name} value={name}>{name}</option>)}
            </select><FieldDescription id="push-remote-description">推送到 {selectedRemote}/{worktree.branch} 并设置为上游分支。</FieldDescription></Field>
            {(dialogError || pushBlocked) && <p className="remote-dialog-error" role="alert">{dialogError ?? pushBlocked}</p>}
          </div>
          <div className="branch-form-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => setChoosingRemote(false)}>取消</Button><Button type="submit" disabled={locked || Boolean(pushBlocked) || !remote?.remotes.includes(selectedRemote)}>{remoteOperation === 'push' ? '推送中…' : '推送并设置上游'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
