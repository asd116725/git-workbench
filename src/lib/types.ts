/** 文件差异的来源，决定比较的两份快照。 */
export type ChangeArea = 'unstaged' | 'staged';

/** Git 状态独立于文本，重命名、权限变更和二进制文件也必须出现在列表中。 */
export interface GitFileStatus {
  statusIndex: string;
  statusWorktree: string;
  originalPath: string | null;
  conflicted: boolean;
}

/** null 表示该版本不存在；原生列表未加载正文时也为 null，不能据此推导 Git 状态。 */
export interface FileSnapshot {
  id: string;
  path: string;
  language: string;
  head: string | null;
  index: string | null;
  working: string | null;
  git?: GitFileStatus;
}

/** files 保留提交前后内容，可按 staged 方式展示该次提交差异。 */
export interface Commit {
  id: string;
  message: string;
  description: string;
  author: string;
  date: string;
  files: FileSnapshot[];
}

/** 每个 worktree 拥有独立暂存区和当前分支。 */
export interface Worktree {
  id: string;
  name: string;
  branch: string;
  path: string;
  files: FileSnapshot[];
  commits: Commit[];
  source?: 'native';
  hasHead?: boolean;
  isMain?: boolean;
  detached?: boolean;
  bare?: boolean;
  available?: boolean;
  locked?: string | null;
  prunable?: string | null;
  operation?: GitOperation | null;
  remote?: GitRemoteStatus;
}

/** 计数来自本地已获取的远程引用；null 表示当前无法确定，不能按零展示。 */
export interface GitRemoteStatus {
  remotes: string[];
  upstream: string | null;
  upstreamRemote: string | null;
  upstreamBranch: string | null;
  defaultRemote: string | null;
  ahead: number | null;
  behind: number | null;
}

/** 拉取只允许快进，推送只处理当前分支。 */
export type GitRemoteAction = 'fetch' | 'pull' | 'push';

/** 远程写入已完成后发生的附带问题保留为警告，避免诱导重复操作。 */
export interface GitRemoteResult { warning: string | null }

/** 将共享 Git 仓库的多个工作目录归为一组。 */
export interface Repository {
  id: string;
  name: string;
  worktrees: Worktree[];
}

/** fullName 是原生命令的精确引用；远程分支切换后创建对应的本地跟踪分支。 */
export interface GitBranch {
  fullName: string;
  name: string;
  kind: 'local' | 'remote';
  current: boolean;
  worktreePath: string | null;
  upstream: string | null;
  localName: string | null;
  lastCommit: {
    shortHash: string;
    author: string;
    subject: string;
    /** Git 提交者时间，单位为 Unix 秒；排序与相对时间展示使用同一时间。 */
    committedAt: number;
  };
}

/** 分支已切换成功时，hook 后续失败仅作为警告返回，避免误报为未切换。 */
export interface GitCheckoutResult {
  branch: string;
  warning: string | null;
}

/** 返回结果即表示分支已创建；切换失败只返回警告，不回滚新分支。 */
export interface GitCreateBranchResult extends GitCheckoutResult {
  switched: boolean;
}

/** 删除确认绑定目标和当前 HEAD，引用变化后必须重新预览并确认。 */
export interface GitDeleteBranchPreview {
  targetRef: string;
  targetName: string;
  targetOid: string;
  headRef: string | null;
  headOid: string;
  headName: string;
  unmergedCommits: number;
}

/** 分支已删除后的配置清理或刷新问题只作为警告，不诱导重复删除。 */
export interface GitDeleteBranchResult {
  branch: string;
  warning: string | null;
}

/** Git 在工作目录中记录的未完成操作，重启后仍以磁盘状态为准。 */
export interface GitOperation {
  kind: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'am';
  head: string;
  mergeHeads: string[];
  message: string;
  source: string | null;
}

/** 预览固定双方引用与提交，执行时由后端核验，防止期间分支移动。 */
export interface GitMergePreview {
  targetRef: string;
  targetBranch: string;
  targetOid: string;
  sourceRef: string;
  sourceName: string;
  sourceOid: string;
  incomingCommits: number;
  fastForward: boolean;
  upToDate: boolean;
}

/** 冲突和等待提交属于可恢复状态；hook 警告不覆盖已经完成的合并结果。 */
export interface GitMergeResult {
  outcome: 'upToDate' | 'fastForward' | 'merged' | 'conflicts' | 'pending' | 'aborted';
  commitId: string | null;
  warning: string | null;
}
