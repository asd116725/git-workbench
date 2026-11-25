import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { t, useI18n } from '../lib/i18n';
import { translateMessage } from '../lib/i18n-system';
import { useWorkbench } from '../lib/store';

/** 记录打开弹窗时的仓库登记与入口，避免活动工作树切换后作用于其他仓库。 */
export interface RemoveRepositoryTarget {
  id: string;
  name: string;
  path: string;
  worktreeCount: number;
  trigger: HTMLButtonElement;
}

/** 只移除应用内登记；保存失败时保留确认内容以便重试。 */
export function RemoveRepositoryDialog({ target, onClose, onRestoreFocus }: {
  target: RemoveRepositoryTarget;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  useI18n();
  const disabled = useWorkbench(state => state.busy || state.restoring || Boolean(state.pushes[target.id]) || state.backgroundFetchingRepositoryIds.includes(target.id));
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  function confirm() {
    try {
      useWorkbench.getState().removeRepository(target.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    toast.success(t('已移除 {name}', { name: target.name }));
    onClose();
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="removal-confirmation-dialog" overlayClassName="removal-confirmation-overlay" showCloseButton={false}
      onOpenAutoFocus={event => { event.preventDefault(); cancel.current?.focus(); }}
      onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}>
      <DialogTitle>{t('从列表移除仓库？')}</DialogTitle>
      <DialogDescription asChild><div className="removal-confirmation-description">
        <div className="removal-confirmation-target"><strong>{target.name}</strong><span dir="auto">{target.path}</span></div>
        <p>{t('此仓库的全部 {count} 个工作树（包括关联工作树）都将从列表移除。', { count: target.worktreeCount })}</p>
        <p>{t('本地文件、Git 历史和未提交改动将保留。之后可通过「打开仓库」重新添加。')}</p>
      </div></DialogDescription>
      {error && <p role="alert" className="inline-error">{translateMessage(error)}</p>}
      <div className="removal-confirmation-actions">
        <Button ref={cancel} variant="outline" onClick={onClose}>{t('取消')}</Button>
        <Button variant="destructive" disabled={disabled} onClick={confirm}>{t('移除仓库')}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
