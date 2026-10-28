import { useI18n } from '../lib/i18n';
import type { GitBranch } from '../lib/types';
import { branchSyncDescription } from './branch-display';

/** 只为已知且存在差异的本地分支显示完整计数；零值方向保留，避免误读箭头含义。 */
export function BranchSyncStatus({ branch }: { branch: GitBranch }) {
  useI18n();
  const description = branchSyncDescription(branch);
  if (!description) return null;
  const changed = branch.ahead != null && branch.behind != null && (branch.ahead > 0 || branch.behind > 0);
  return <>
    <span id={`branch-sync-${branch.fullName}`} className="sr-only">{description}</span>
    {changed && <span className="branch-sync-status" title={description} aria-hidden="true">
      <span><i className="codicon codicon-arrow-down" />{branch.behind}</span>
      <span><i className="codicon codicon-arrow-up" />{branch.ahead}</span>
    </span>}
  </>;
}
