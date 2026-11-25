import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { t, useI18n } from '../lib/i18n';
import { translateMessage } from '../lib/i18n-system';
import type { WorktreeRemovalMode } from '../lib/native-git';
import { useWorkbench } from '../lib/store';
import type { Worktree } from '../lib/types';
import { branchLabel } from './branch-display';

/** 确认内容固定在菜单所在行，避免对其他工作树执行删除。 */
export interface RemoveWorktreeTarget {
  repositoryId: string;
  worktree: Worktree;
  name: string;
  mode: WorktreeRemovalMode;
  trigger: HTMLButtonElement;
}

/** 进行中的删除不可关闭，失败时保留确认对象和 Git 错误。 */
export function RemoveWorktreeDialog({ target, onClose, onRestoreFocus }: {
  target: RemoveWorktreeTarget;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  useI18n();
  const { repositoryId, worktree, name, mode } = target;
  const disabled = useWorkbench(state => state.busy || state.restoring || Boolean(state.pushes[repositoryId]) || state.backgroundFetchingRepositoryIds.includes(repositoryId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const missing = mode === 'cleanMissing';

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const { warning } = await useWorkbench.getState().removeWorktree(repositoryId, worktree.id, mode);
      const message = t(missing ? '已清理 {name} 的失效记录' : '已删除工作树 {name}', { name });
      if (warning) toast.warning(message, { description: translateMessage(warning) });
      else toast.success(message);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setPending(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <DialogContent className="removal-confirmation-dialog" overlayClassName="removal-confirmation-overlay" showCloseButton={false}
      onOpenAutoFocus={event => { event.preventDefault(); cancel.current?.focus(); }}
      onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}>
      <DialogTitle>{t(missing ? '清理失效记录？' : '删除工作树？')}</DialogTitle>
      <DialogDescription asChild><div className="removal-confirmation-description">
        <div className="removal-confirmation-target"><strong>{name}</strong><span dir="auto">{worktree.path}</span><span dir="auto">{branchLabel(worktree)}</span></div>
        <p>{t(missing
          ? '将清理这条工作树记录，保留本地分支。'
          : '将删除工作目录及 Git 忽略的文件，保留本地分支。')}</p>
        {!missing && worktree.detached && <p>{t('当前处于分离 HEAD。若要保留仅此工作树引用的提交，请先创建分支。')}</p>}
      </div></DialogDescription>
      {error && <p role="alert" className="inline-error">{translateMessage(error)}</p>}
      <div className="removal-confirmation-actions">
        <Button ref={cancel} variant="outline" disabled={pending} onClick={onClose}>{t('取消')}</Button>
        <Button variant="destructive" disabled={disabled || pending} onClick={() => void confirm()}>
          {missing ? t(pending ? '正在清理…' : '清理记录') : t(pending ? '正在删除…' : '删除工作树')}
        </Button>
      </div>
    </DialogContent>
  </Dialog>;
}
