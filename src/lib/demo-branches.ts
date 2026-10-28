import type { GitBranch, GitCheckoutResult, GitCreateBranchResult, GitDeleteBranchPreview, GitDeleteBranchResult, Repository, Worktree } from './types';

interface DemoBranch {
  name: string;
  kind: 'local' | 'remote';
  upstream: string | null;
  commits: string[];
  lastCommit: GitBranch['lastCommit'];
}

/** 浏览器演示仅保存引用和简化的可达提交集合，不模拟或持久化工作文件。 */
export interface DemoBranchState {
  branches: Record<string, DemoBranch>;
  worktrees: Array<Pick<Worktree, 'id' | 'path' | 'branch' | 'detached'>>;
}

function oid(value: string) {
  return value.padEnd(40, '0');
}

/** 演示用独立远程引用表达同步差异，计数随后由可达提交集合计算。 */
function addDemoUpstream(branches: DemoBranchState['branches'], branch: DemoBranch, commits: string[], lastCommit = branch.lastCommit) {
  const upstream = `refs/remotes/origin/${branch.name}`;
  branches[`refs/heads/${branch.name}`] = { ...branch, upstream };
  branches[upstream] = { ...branch, name: `origin/${branch.name}`, kind: 'remote', upstream: null, commits, lastCommit };
}

/** 每个演示仓库独立初始化，提供可普通删除和需强制删除的示例分支。 */
export function createDemoBranchState(repository: Repository): DemoBranchState {
  const branches: DemoBranchState['branches'] = {};
  for (const worktree of repository.worktrees) {
    const commit = worktree.commits[0];
    if (!commit || worktree.hasHead === false || worktree.detached) continue;
    branches[`refs/heads/${worktree.branch}`] = {
      name: worktree.branch, kind: 'local', upstream: null,
      commits: worktree.commits.map(item => oid(item.id)),
      lastCommit: { shortHash: commit.id.slice(0, 7), author: commit.author, subject: commit.message, committedAt: new Date(commit.date).getTime() / 1000 },
    };
  }
  const base = Object.values(branches)[0];
  if (base) {
    const main = branches['refs/heads/main'] ?? {
      ...base, name: 'main', commits: base.commits.slice(-1),
      lastCommit: { ...base.lastCommit, shortHash: base.commits[base.commits.length - 1].slice(0, 7), subject: 'chore: 初始化演示项目', committedAt: base.lastCommit.committedAt - 86_400 },
    };
    addDemoUpstream(branches, main, main.commits);
    branches['refs/heads/feature/search'] ??= {
      ...base, name: 'feature/search', commits: [oid('f1234567'), oid('f2345678'), ...base.commits],
      lastCommit: { ...base.lastCommit, shortHash: 'f123456', subject: 'feat(search): 添加搜索结果筛选（演示）', committedAt: base.lastCommit.committedAt + 60 },
    };
    const search = branches['refs/heads/feature/search'];
    addDemoUpstream(branches, search, [oid('e1234567'), ...base.commits], { ...base.lastCommit, shortHash: 'e123456', subject: 'fix(search): 远程搜索示例更新', committedAt: base.lastCommit.committedAt + 30 });
    if (base.name !== 'main') {
      const remoteCommits = base.commits.slice(-1);
      addDemoUpstream(branches, base, remoteCommits, { ...base.lastCommit, shortHash: remoteCommits[0].slice(0, 7), subject: 'chore: 初始化远程演示分支', committedAt: base.lastCommit.committedAt - 86_400 });
    }
    const preview = branches['refs/heads/feature/preview'];
    if (preview) addDemoUpstream(branches, preview, [oid('e2345678'), ...preview.commits], { ...preview.lastCommit, shortHash: 'e234567', subject: 'fix(preview): 远程预览示例更新', committedAt: preview.lastCommit.committedAt + 30 });
  }
  return { branches, worktrees: repository.worktrees.map(({ id, path, branch, detached }) => ({ id, path, branch, detached })) };
}

/** 与原生计数一样比较分支自身的上游，未配置或已丢失的引用保持未知。 */
function demoSyncCounts(state: DemoBranchState, branch: DemoBranch): Pick<GitBranch, 'ahead' | 'behind'> {
  const upstream = branch.kind === 'local' && branch.upstream ? state.branches[branch.upstream] : undefined;
  if (!upstream) return { ahead: null, behind: null };
  const localCommits = new Set(branch.commits);
  const remoteCommits = new Set(upstream.commits);
  return {
    ahead: [...localCommits].filter(commit => !remoteCommits.has(commit)).length,
    behind: [...remoteCommits].filter(commit => !localCommits.has(commit)).length,
  };
}

/** 当前工作区的实时分支覆盖缓存，其余占用随演示切换同步。 */
function occupiedWorktree(state: DemoBranchState, worktree: Worktree, name: string) {
  return state.worktrees.map(item => item.id === worktree.id ? worktree : item)
    .find(item => !item.detached && item.branch === name);
}

/** 与真实仓库一样按最近提交排序，复用同一分支列表组件。 */
export function listDemoBranches(state: DemoBranchState, worktree: Worktree): GitBranch[] {
  return Object.entries(state.branches).map(([fullName, branch]): GitBranch => ({
    fullName, name: branch.name, kind: branch.kind, upstream: branch.upstream,
    current: branch.kind === 'local' && !worktree.detached && branch.name === worktree.branch,
    worktreePath: branch.kind === 'local' ? occupiedWorktree(state, worktree, branch.name)?.path ?? null : null,
    localName: branch.kind === 'remote' ? branch.name.slice('origin/'.length) : null,
    ...demoSyncCounts(state, branch),
    lastCommit: branch.lastCommit,
  })).sort((left, right) => right.lastCommit.committedAt - left.lastCommit.committedAt || left.name.localeCompare(right.name));
}

/** 演示提交只推进当前引用，沿用该分支祖先，避免把切换前的工作区历史混入。 */
export function recordDemoBranchCommit(state: DemoBranchState, worktree: Worktree): DemoBranchState {
  if (worktree.detached) return state;
  const commit = worktree.commits[0];
  const fullName = `refs/heads/${worktree.branch}`;
  const branch = state.branches[fullName];
  const commitOid = oid(commit.id);
  if (branch?.commits[0] === commitOid) return state;
  return {
    ...state,
    branches: {
      ...state.branches,
      [fullName]: {
        name: worktree.branch, kind: 'local', upstream: branch?.upstream ?? null,
        commits: [commitOid, ...(branch?.commits ?? [])],
        lastCommit: { shortHash: commit.id.slice(0, 7), author: commit.author, subject: commit.message, committedAt: new Date(commit.date).getTime() / 1000 },
      },
    },
  };
}

function ensureOperationAvailable(worktree: Worktree) {
  if (worktree.operation) throw new Error('请先完成或中止当前 Git 操作，再管理分支。');
}

function currentHead(state: DemoBranchState, worktree: Worktree) {
  const headRef = worktree.detached ? null : `refs/heads/${worktree.branch}`;
  const commits = headRef ? state.branches[headRef]?.commits : worktree.commits.map(commit => oid(commit.id));
  if (worktree.hasHead === false || !commits?.length) throw new Error('当前工作区尚无提交，请先完成首次提交。');
  return { headRef, headOid: commits[0], headName: worktree.detached ? `当前 HEAD · ${commits[0].slice(0, 7)}` : worktree.branch, commits };
}

function validateName(state: DemoBranchState, name: string) {
  if (!name || name === 'HEAD' || name.startsWith('-') || name.includes('..') || name.includes('@{') || /[\s~^:?*[\\]/.test(name)
    || [...name].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || name.endsWith('.') || name.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock'))) {
    throw new Error('分支名称不合法，请使用有效的 Git 分支名称。');
  }
  const locals = Object.values(state.branches).filter(branch => branch.kind === 'local');
  if (locals.some(branch => branch.name === name)) throw new Error(`分支 ${name} 已存在。`);
  if (locals.some(branch => branch.name.startsWith(`${name}/`) || name.startsWith(`${branch.name}/`))) {
    throw new Error('分支名称与已有分支的目录层级冲突。');
  }
}

/** 创建引用后按需更新工作区占用，正文与暂存内容由原演示工作区保留。 */
export function createDemoBranch(state: DemoBranchState, worktree: Worktree, name: string, startRef: string, checkout: boolean): { state: DemoBranchState; result: GitCreateBranchResult } {
  ensureOperationAvailable(worktree);
  validateName(state, name);
  const head = startRef === 'HEAD' ? currentHead(state, worktree) : null;
  const source = state.branches[startRef === 'HEAD' ? head?.headRef ?? '' : startRef];
  if (!source && !head) throw new Error('起点分支已不存在，请重新选择。');
  const branch: DemoBranch = source ? { ...source, name, kind: 'local', upstream: source.kind === 'remote' ? startRef : null } : {
    name, kind: 'local', upstream: null, commits: head!.commits,
    lastCommit: { shortHash: head!.headOid.slice(0, 7), author: 'Demo User', subject: '分离 HEAD 的演示提交', committedAt: new Date(worktree.commits[0].date).getTime() / 1000 },
  };
  return {
    state: {
      branches: { ...state.branches, [`refs/heads/${name}`]: branch },
      worktrees: checkout ? state.worktrees.map(item => item.id === worktree.id ? { ...item, branch: name, detached: false } : item) : state.worktrees,
    },
    result: { branch: name, switched: checkout, warning: null },
  };
}

/** 删除预览只比较当前 HEAD，不把远程跟踪状态当作已经合入的依据。 */
export function previewDemoBranchDeletion(state: DemoBranchState, worktree: Worktree, fullName: string): GitDeleteBranchPreview {
  ensureOperationAvailable(worktree);
  const target = state.branches[fullName];
  if (!target || target.kind !== 'local') throw new Error('仅可删除存在的本地分支，请刷新列表后重试。');
  const occupied = occupiedWorktree(state, worktree, target.name);
  if (occupied) throw new Error(occupied.id === worktree.id ? '不能删除当前分支。' : `分支正在其他工作区使用：${occupied.path}`);
  const head = currentHead(state, worktree);
  return {
    targetRef: fullName, targetName: target.name, targetOid: target.commits[0],
    headRef: head.headRef, headOid: head.headOid, headName: head.headName,
    unmergedCommits: target.commits.filter(commit => !head.commits.includes(commit)).length,
  };
}

/** 执行前重读演示快照，过期授权不能删除后来移动的分支。 */
export function deleteDemoBranch(state: DemoBranchState, worktree: Worktree, preview: GitDeleteBranchPreview, force: boolean): { state: DemoBranchState; result: GitDeleteBranchResult } {
  const current = previewDemoBranchDeletion(state, worktree, preview.targetRef);
  if (current.targetOid !== preview.targetOid || current.headRef !== preview.headRef || current.headOid !== preview.headOid || current.unmergedCommits !== preview.unmergedCommits) {
    throw new Error('分支状态已变化，请重新预览并确认删除。');
  }
  if (current.unmergedCommits > 0 && !force) throw new Error('此分支包含未合入的提交，请确认风险后再强制删除。');
  const branches = { ...state.branches };
  delete branches[current.targetRef];
  return { state: { ...state, branches }, result: { branch: current.targetName, warning: null } };
}

/** 演示切换仍校验占用；远程分支创建或复用对应的本地跟踪分支。 */
export function switchDemoBranch(state: DemoBranchState, worktree: Worktree, fullName: string): { state: DemoBranchState; result: GitCheckoutResult } {
  ensureOperationAvailable(worktree);
  const selected = state.branches[fullName];
  if (!selected) throw new Error('分支已不存在，请重新选择。');
  const name = selected.kind === 'local' ? selected.name : selected.name.slice('origin/'.length);
  const target = state.branches[`refs/heads/${name}`];
  if (selected.kind === 'remote' && target && target.upstream !== fullName) throw new Error('同名本地分支已存在，但未跟踪所选远程分支。');
  const occupied = occupiedWorktree(state, worktree, name);
  if (occupied?.id === worktree.id) throw new Error('已经位于当前分支。');
  if (occupied) throw new Error(`分支正在其他工作区使用：${occupied.path}`);
  if (!target) {
    const created = createDemoBranch(state, worktree, name, fullName, true);
    return { state: created.state, result: { branch: name, warning: null } };
  }
  return {
    state: { ...state, worktrees: state.worktrees.map(item => item.id === worktree.id ? { ...item, branch: name, detached: false } : item) },
    result: { branch: name, warning: null },
  };
}
