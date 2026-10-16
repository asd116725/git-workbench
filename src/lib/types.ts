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
}

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
