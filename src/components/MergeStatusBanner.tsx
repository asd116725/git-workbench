import { translateMessage } from '../lib/i18n-system';
import { t, useI18n } from '../lib/i18n';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWorkbench } from '../lib/store';
import { operationNames } from '../lib/merge-view';
import type { Worktree } from '../lib/types';

/** 从 Git 的实际操作状态展示恢复入口，中止仅针对尚未完成的合并。 */
export function MergeStatusBanner({ worktree }: { worktree: Worktree }) {
  useI18n();
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
      if (result.warning) toast.warning(t("合并已中止"), { description: translateMessage(result.warning) });
      else toast.success(t("合并已中止"), { description: t("当前分支仍为 {value1}", { value1: worktree.branch }) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return <>
    <div className="merge-status-banner" role="status">
      <i className={`codicon codicon-${merging ? 'git-merge' : 'warning'}`} aria-hidden="true" />
      <div className="merge-status-copy"><strong>{merging ? t("正在合并 {value1} → {value2}", { value1: source, value2: worktree.branch }) : t("正在{value1}", { value1: t(operationNames[operation.kind]) })}</strong>
        <span>{!merging ? t("请在外部工具中完成或中止该操作，应用会自动更新状态。") : conflicts ? t("{value1} 个文件存在冲突。请在编辑器中解决后暂存，再完成合并。", { value1: conflicts }) : t("检查暂存内容和合并提交信息，点击“完成合并”结束本次操作。")}</span>
      </div>
      {merging && <Button variant="outline" size="sm" disabled={busy || refreshing} onClick={() => setConfirmOpen(true)}>{t("中止合并")}</Button>}
    </div>
    <Dialog open={confirmOpen} onOpenChange={open => { if (!busy) setConfirmOpen(open); }}>
      <DialogContent className="abort-merge-dialog" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{t("中止当前合并？")}</DialogTitle><DialogDescription>{t("将中止 {source} → {target}，撤销此次合并及冲突解决过程中的修改。需要保留的内容请先另行保存。", { source, target: worktree.branch })}</DialogDescription></DialogHeader>
        {error && <pre className="inline-error" role="alert">{translateMessage(error)}</pre>}
        <div className="merge-confirm-actions"><Button variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}>{t("继续处理")}</Button><Button variant="destructive" disabled={busy || refreshing} onClick={() => void abort()}>{busy ? t("正在中止…") : t("确认中止合并")}</Button></div>
      </DialogContent>
    </Dialog>
  </>;
}
