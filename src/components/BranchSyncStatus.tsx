import { useI18n } from '../lib/i18n';
import type { GitBranch, GitBranchSync } from '../lib/types';
import { branchSyncDescription } from './branch-display';

/** 只为已知且存在差异的本地分支显示完整计数；零值方向保留，避免误读箭头含义。 */
export function BranchSyncStatus({ branch }: { branch: GitBranch }) {
  useI18n();
  const description = branchSyncDescription(branch);
  if (!description) return null;
  return <>
    <span id={`branch-sync-${branch.fullName}`} className="sr-only">{description}</span>
    <BranchSyncCounts sync={branch} description={description} />
  </>;
}

/** 共享数量展示不生成 DOM ID，由各入口提供自己的可访问说明。 */
export function BranchSyncCounts({ sync, description }: { sync?: GitBranchSync | null; description?: string }) {
  if (!sync?.upstream || sync.ahead == null || sync.behind == null || (!sync.ahead && !sync.behind)) return null;
  return <span className="branch-sync-status" title={description} aria-hidden="true">
    <span><i className="codicon codicon-arrow-down" />{sync.behind}</span>
    <span><i className="codicon codicon-arrow-up" />{sync.ahead}</span>
  </span>;
}
