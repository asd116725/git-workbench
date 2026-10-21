import { invoke } from '@tauri-apps/api/core';
import type { ChangeArea, FileSnapshot, GitBranch, GitCheckoutResult, GitFileStatus, Repository, Worktree } from './types';

/** 工作目录元数据不携带文件正文，未选中的目录保持懒加载。 */
export interface NativeWorktree {
  path: string;
  name: string;
  branch: string;
  detached: boolean;
  bare: boolean;
  isMain: boolean;
  locked: string | null;
  prunable: string | null;
  available: boolean;
}

/** 原生命令只返回当前工作目录的状态，同时列出共享仓库的全部 worktree。 */
export interface NativeRepository {
  commonDir: string;
  repositoryName: string;
  worktrees: NativeWorktree[];
  path: string;
  name: string;
  branch: string;
  hasHead: boolean;
  files: Array<GitFileStatus & { path: string }>;
}

/** notice 表示二进制、大文件或冲突等无法直接进行文本比较的原因。 */
interface NativeDiff {
  original: string | null;
  modified: string | null;
  notice: string | null;
}

const languages: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript', json: 'json', css: 'css', scss: 'scss',
  html: 'html', vue: 'html', md: 'markdown', yaml: 'yaml', yml: 'yaml',
  rs: 'rust', py: 'python', java: 'java', sh: 'shell', toml: 'ini',
  c: 'c', h: 'c', cpp: 'cpp', go: 'go', sql: 'sql', xml: 'xml', svg: 'xml',
};

/** 原生文件标识保留完整相对路径，避免同名文件及特殊字符发生碰撞。 */
export function toWorktree(repository: NativeRepository): Worktree {
  const metadata = repository.worktrees.find(worktree => worktree.path === repository.path);
  return {
    ...metadata,
    id: `native:${repository.path}`,
    name: metadata?.name ?? repository.name,
    branch: repository.branch,
    path: repository.path,
    source: 'native',
    hasHead: repository.hasHead,
    commits: [],
    files: repository.files.map(({ path, ...git }): FileSnapshot => ({
      id: path,
      path,
      language: languages[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext',
      head: null,
      index: null,
      working: null,
      git,
    })),
  };
}

/** 以公共 Git 目录归组，刷新元数据时保留兄弟目录已经加载的文件与历史。 */
export function toRepository(result: NativeRepository, previous?: Repository): Repository {
  const current = toWorktree(result);
  return {
    id: `native-repository:${result.commonDir}`,
    name: result.repositoryName,
    worktrees: result.worktrees.map(metadata => {
      if (metadata.path === result.path) return current;
      const cached = previous?.worktrees.find(worktree => worktree.path === metadata.path);
      return {
        files: [],
        commits: [],
        ...cached,
        ...metadata,
        id: `native:${metadata.path}`,
        source: 'native',
      };
    }),
  };
}

/** 只暴露指定 Git 命令，不提供前端拼接 shell 命令的入口。 */
export const nativeGit = {
  /** 当前工作区只保留一个原生监听，null 释放监听资源。 */
  watch: (repoPath: string | null) => invoke<void>('git_watch', { repoPath }),
  open: (path: string) => invoke<NativeRepository>('git_open', { path }),
  status: (repoPath: string) => invoke<NativeRepository>('git_status', { repoPath }),
  branches: (repoPath: string) => invoke<GitBranch[]>('git_branches', { repoPath }),
  checkout: (repoPath: string, fullName: string) => invoke<GitCheckoutResult>('git_checkout', { repoPath, fullName }),
  diff: (repoPath: string, path: string, area: ChangeArea) => invoke<NativeDiff>('git_diff', { repoPath, path, area }),
  stage: (repoPath: string, paths: string[]) => invoke<void>('git_stage', { repoPath, paths }),
  unstage: (repoPath: string, paths: string[]) => invoke<void>('git_unstage', { repoPath, paths }),
  commit: (repoPath: string, summary: string, description: string) => invoke<{ commitId: string }>('git_commit', { repoPath, summary, description }),
};
