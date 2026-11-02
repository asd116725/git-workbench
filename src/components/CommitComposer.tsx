import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { aiCommitBlockReason, createAiCommitSession } from '../lib/ai-commit-session';
import { getChanges } from '../lib/demo-git';
import { t, useI18n } from '../lib/i18n';
import { translateMessage } from '../lib/i18n-system';
import { commitBlockReason } from '../lib/merge-view';
import { getMergeMessage, useWorkbench } from '../lib/store';
import type { Worktree } from '../lib/types';
import { AiCommitDialog } from './AiCommitDialog';

/** 保留原提交流程，AI 仅通过独立会话更新当前工作区的普通提交草稿。 */
export function CommitComposer({ worktree, busy, onCommit }: { worktree: Worktree; busy: boolean; onCommit: () => Promise<void> }) {
  useI18n();
  const { drafts, setDraft, mergeDrafts, setMergeMessage } = useWorkbench();
  const [session] = useState(() => createAiCommitSession(worktree));
  const ai = useStore(session);
  const input = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const applied = useRef(false);
  const merging = worktree.operation?.kind === 'merge';
  const message = merging ? getMergeMessage(worktree, mergeDrafts) : drafts[worktree.id]?.message ?? '';
  const stagedCount = getChanges(worktree, 'staged').length;
  const blocked = commitBlockReason(worktree, message);
  const aiBlocked = aiCommitBlockReason(worktree);
  const ready = !busy && !blocked;

  useEffect(() => session.getState().connect(), [session]);

  async function applyCandidate() {
    if (await session.getState().apply()) {
      applied.current = true;
      toast.success(t('已填入提交文案，请检查后提交。'));
    }
  }

  return <>
    <form className="commit-composer" onSubmit={event => { event.preventDefault(); if (ready && ai.phase === 'closed') void onCommit(); }}>
      <FieldGroup className="commit-fields"><Field>
        <div className="commit-label-row"><FieldLabel htmlFor="commit-message">{merging ? t('合并提交信息') : t('提交信息')}</FieldLabel>
          <Tooltip><TooltipTrigger asChild><span><Button ref={trigger} type="button" variant="ghost" size="sm" className="ai-commit-trigger" disabled={busy || Boolean(aiBlocked)} onClick={() => void ai.open()} aria-label={t('AI 生成提交信息')}><i className="codicon codicon-sparkle" aria-hidden="true" />{t('AI 生成')}</Button></span></TooltipTrigger><TooltipContent>{aiBlocked ? t(aiBlocked) : t('将暂存差异和必要提交规范发送至 DeepSeek')}</TooltipContent></Tooltip>
        </div>
        <Textarea ref={input} id="commit-message" placeholder={t('简要说明这次更改\n\n添加详细说明（可选）')} value={message} disabled={busy || Boolean(worktree.operation && !merging)} autoComplete="off" onChange={event => merging ? setMergeMessage(event.target.value) : setDraft({ message: event.target.value })} />
      </Field></FieldGroup>
      {blocked && (worktree.operation || worktree.files.some(file => file.git?.conflicted)) && <p className="commit-warning">{translateMessage(blocked)}</p>}
      <Button type="submit" className="commit-button" disabled={!ready} title={blocked ? translateMessage(blocked) : undefined}><i className={`codicon codicon-${busy ? 'loading' : merging ? 'git-merge' : 'check'} ${busy ? 'spin' : ''}`} aria-hidden="true" />{busy ? t('正在处理…') : merging ? t('完成合并') : t('提交 {value1} 个文件', { value1: stagedCount })}</Button>
    </form>
    <AiCommitDialog state={ai} stagedCount={stagedCount} hasDraft={Boolean(message.trim())} blocked={busy || Boolean(aiBlocked)} onApply={() => void applyCandidate()} onCloseFocus={() => {
      (applied.current ? input : trigger).current?.focus();
      applied.current = false;
    }} />
  </>;
}
