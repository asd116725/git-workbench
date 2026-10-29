import type { FileSnapshot } from './types';

/** 提交列表只携带摘要；完整说明和文件正文按选择另行读取。 */
export interface HistoryCommitSummary {
  oid: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  committedAt: number;
  parents: string[];
}

/** 变更路径指向提交树，oldPath 用于重命名前的父提交内容。 */
export interface HistoryChangedFile {
  path: string;
  oldPath: string | null;
  status: string;
  oldMode: string;
  newMode: string;
}

/** parentIndex 从零开始；根提交的 parentOid 为 null。 */
export interface HistoryCommitDetail {
  commit: HistoryCommitSummary;
  message: string;
  parentOid: string | null;
  parentIndex: number;
  files: HistoryChangedFile[];
}

/** 游标只对同一提交快照和搜索条件有效。 */
export interface HistoryPage {
  commits: HistoryCommitSummary[];
  nextCursor: string | null;
}

/** 固定分支与上游 tip 后求得的待推送集合，不按列表位置或搜索结果猜测。 */
export interface HistoryOutgoing {
  upstream: string;
  oids: string[];
}

/** 引用与同步状态一起读取；outgoing 为 null 时不能判定任何记录待推送。 */
export interface HistoryReference {
  oid: string | null;
  outgoing: HistoryOutgoing | null;
}

export interface HistoryDiff {
  original: string | null;
  modified: string | null;
  notice: string | null;
}

/** 会话缓存与暂存业务隔离，文件正文只驻留内存。 */
export interface HistorySession {
  initialized: boolean;
  reference: string | null;
  /** 输入即时记忆，query 仅在防抖结束后代表已请求的条件。 */
  searchInput: string;
  query: string;
  snapshot: string | null;
  outgoing: HistoryOutgoing | null;
  commits: HistoryCommitSummary[];
  nextCursor: string | null;
  selectedOid: string | null;
  parentIndex: number;
  selectedPath: string | null;
  detail: HistoryCommitDetail | null;
  diff: { file: FileSnapshot | null; notice: string | null; error: string | null; loading: boolean };
  loading: boolean;
  loadingMore: boolean;
  detailLoading: boolean;
  error: string | null;
  detailError: string | null;
  updated: boolean;
  checkError: string | null;
}
