import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWorkbench } from '../lib/store';
import { operationNames } from '../lib/merge-view';
import type { Worktree } from '../lib/types';

/** 从 Git 的实际操作状态展示恢复入口，中止仅针对尚未完成的合并。 */
export function MergeStatusBanner({ worktree }: { worktree: Worktree }) {
  const { busy, refreshing, abortMerge } = useWorkbench();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = worktree.operation;
  if (!operation) return null;
  const merging = operation.kind === 'merge';
  const conflicts = worktree.files.filter(file => file.git?.conflicted).length;
  const source = operation.source ?? operation.mergeHeads.map(head => head.slice(0, 7)).join('、');

  async function abort() {
    setError(null);
    try {
      const result = await abortMerge();
      setConfirmOpen(false);
      if (result.warning) toast.warning('合并已中止', { description: result.warning });
      else toast.success('合并已中止', { description: `当前分支仍为 ${worktree.branch}` });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return <>
    <div className="merge-status-banner" role="status">
      <i className={`codicon codicon-${merging ? 'git-merge' : 'warning'}`} aria-hidden="true" />
      <div className="merge-status-copy"><strong>{merging ? `正在合并 ${source} → ${worktree.branch}` : `正在${operationNames[operation.kind]}`}</strong>
        <span>{!merging ? '请在外部工具中完成或中止该操作，应用会自动更新状态。' : conflicts ? `${conflicts} 个文件存在冲突。请在编辑器中解决后暂存，再完成合并。` : '检查暂存内容和合并提交信息，点击“完成合并”结束本次操作。'}</span>
      </div>
      {merging && <Button variant="outline" size="sm" disabled={busy || refreshing} onClick={() => setConfirmOpen(true)}>中止合并</Button>}
    </div>
    <Dialog open={confirmOpen} onOpenChange={open => { if (!busy) setConfirmOpen(open); }}>
      <DialogContent className="abort-merge-dialog" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>中止当前合并？</DialogTitle><DialogDescription>将中止 {source} → {worktree.branch}，撤销此次合并及冲突解决过程中的修改。需要保留的内容请先另行保存。</DialogDescription></DialogHeader>
        {error && <pre className="inline-error" role="alert">{error}</pre>}
        <div className="merge-confirm-actions"><Button variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}>继续处理</Button><Button variant="destructive" disabled={busy || refreshing} onClick={() => void abort()}>{busy ? '正在中止…' : '确认中止合并'}</Button></div>
      </DialogContent>
    </Dialog>
  </>;
}
