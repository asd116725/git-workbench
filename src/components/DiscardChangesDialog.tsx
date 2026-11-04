import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileIcon } from './FileIcon';
import { t, useI18n } from '../lib/i18n';
import { translateMessage } from '../lib/i18n-system';
import { findWorktree, useWorkbench } from '../lib/store';
import { getChanges } from '../lib/demo-git';
import type { GitDiscardPreview } from '../lib/types';
import './discard-dialog.css';

/** 每次打开重新预览；失败后消费旧确认，必须重新读取后才能再次执行。 */
export function DiscardChangesDialog({ fileIds, bulk, onClose }: {
  fileIds: string[];
  bulk: boolean;
  onClose: () => void;
}) {
  useI18n();
  const { previewDiscard, discard, busy, refreshing } = useWorkbench();
  const [preview, setPreview] = useState<GitDiscardPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [requestIds, setRequestIds] = useState(fileIds);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    void previewDiscard(requestIds).then(value => {
      if (active) setPreview(value);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [requestIds, previewDiscard]);

  const files = preview?.files ?? [];
  const untrackedCount = files.filter(file => file.untracked).length;
  const selected = files.filter(file => includeUntracked || !file.untracked);
  const onlyUntracked = files.length > 0 && files.every(file => file.untracked);
  const singleTrash = !bulk && onlyUntracked;

  /** 部分成功后只重新预览原选择中仍未暂存的文件，避免反复请求已撤销项。 */
  function retry() {
    const state = useWorkbench.getState();
    const worktree = findWorktree(state.repositories, state.activeWorktreeId);
    const remaining = worktree ? getChanges(worktree, 'unstaged').filter(file => fileIds.includes(file.id)).map(file => file.id) : [];
    if (!remaining.length) { onClose(); return; }
    setError(null);
    setLoading(true);
    setRequestIds(remaining);
  }

  async function confirm() {
    if (!preview) return;
    setError(null);
    try {
      const count = await discard(preview, includeUntracked);
      toast.success(t('已撤销 {count} 个文件的未暂存修改', { count }));
      onClose();
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="discard-dialog" showCloseButton={!busy} onOpenAutoFocus={event => { event.preventDefault(); cancelRef.current?.focus(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle><i className={`codicon codicon-${singleTrash ? 'trash' : 'discard'}`} aria-hidden="true" />{t(singleTrash ? '移到废纸篓？' : bulk ? '撤销全部未暂存修改？' : '撤销未暂存修改？')}</DialogTitle></DialogHeader>
      {loading && <p role="status">{t('正在读取文件…')}</p>}
      {preview && <>
        <ul className="discard-file-list" aria-label={t('待撤销文件')}>
          {files.map(file => <li key={file.path} className={file.untracked && !includeUntracked ? 'discard-file-excluded' : ''}><FileIcon path={file.path} /><span title={file.path}>{file.path}</span></li>)}
        </ul>
        {bulk && untrackedCount > 0 && <label className="discard-include-new"><input type="checkbox" checked={includeUntracked} disabled={busy} onChange={event => setIncludeUntracked(event.target.checked)} />{t('包含 {count} 个新增文件（移到废纸篓）', { count: untrackedCount })}</label>}
      </>}
      <DialogDescription className="discard-warning"><i className={`codicon codicon-${onlyUntracked ? 'info' : 'warning'}`} aria-hidden="true" />{t(onlyUntracked ? '新增文件将移到废纸篓。' : '未暂存内容将丢失，无法通过 Git 恢复。')}</DialogDescription>
      {error && <div className="discard-error"><pre className="inline-error" role="alert">{translateMessage(error)}</pre><Button variant="outline" size="sm" disabled={busy || refreshing} onClick={retry}>{t('重新读取')}</Button></div>}
      <div className="discard-actions"><Button ref={cancelRef} variant="outline" disabled={busy} onClick={onClose}>{t('取消')}</Button><Button variant="destructive" disabled={busy || refreshing || loading || !preview || selected.length === 0} onClick={() => void confirm()}>{busy ? t('正在撤销…') : singleTrash ? t('移到废纸篓') : bulk ? t('撤销 {count} 个文件', { count: selected.length }) : t('撤销修改')}</Button></div>
    </DialogContent>
  </Dialog>;
}
