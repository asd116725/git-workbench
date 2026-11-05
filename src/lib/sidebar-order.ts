import { create } from 'zustand';

/** null 表示项目列表；仓库 ID 表示该项目内部的工作树列表。 */
export type SortScope = string | null;
export type SortEdge = 'before' | 'after';

interface SidebarOrder {
  projects: string[];
  worktrees: Record<string, string[]>;
}

interface SidebarOrderState {
  order: SidebarOrder;
  /** 首次发现的 ID 按观察顺序追加；暂时缺席的项目和工作树保留已有位置。 */
  observe: (repositories: { id: string; worktrees: { id: string }[] }[]) => void;
  /** 仅对当前列表中的 ID 排序，不允许把工作树移入其他项目。 */
  move: (scope: SortScope, ids: string[], source: string, target: string, edge: SortEdge) => boolean;
}

const storageKey = 'git-workbench.sidebar-order';

function readIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))] : [];
}

function appendIds(current: string[], ids: string[]): string[] {
  const next = [...new Set([...current, ...ids])];
  return next.length === current.length ? current : next;
}

function readOrder(): SidebarOrder {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    const worktrees = saved?.worktrees;
    return {
      projects: readIds(saved?.projects),
      worktrees: worktrees && typeof worktrees === 'object' && !Array.isArray(worktrees)
        ? Object.fromEntries(Object.entries(worktrees).map(([id, order]) => [id, readIds(order)])) : {},
    };
  } catch { return { projects: [], worktrees: {} }; }
}

/** 忽略已删除的 ID，新发现的项目或工作树按原顺序追加，不修改 Git 元数据。 */
export function orderedItems<T extends { id: string }>(items: T[], order: string[] = []): T[] {
  const remaining = new Map(items.map(item => [item.id, item]));
  const result: T[] = [];
  for (const id of order) {
    const item = remaining.get(id);
    if (item) {
      result.push(item);
      remaining.delete(id);
    }
  }
  return [...result, ...remaining.values()];
}

/** 按目标的前后位置插入；失效目标、同项和位置未变化时保留原数组。 */
export function moveItem(ids: string[], source: string, target: string, edge: SortEdge): string[] {
  if (source === target || !ids.includes(source) || !ids.includes(target)) return ids;
  const next = ids.filter(id => id !== source);
  next.splice(next.indexOf(target) + (edge === 'after' ? 1 : 0), 0, source);
  return next.every((id, index) => id === ids[index]) ? ids : next;
}

/** 先持久化再发布顺序，保存失败时界面保留原位置。 */
export const useSidebarOrder = create<SidebarOrderState>((set, get) => ({
  order: readOrder(),
  observe: repositories => {
    const current = get().order;
    const projects = appendIds(current.projects, repositories.map(item => item.id));
    const worktrees = { ...current.worktrees };
    let changed = projects !== current.projects;
    for (const repository of repositories) {
      const previous = worktrees[repository.id] ?? [];
      const next = appendIds(previous, repository.worktrees.map(item => item.id));
      if (next !== previous) {
        worktrees[repository.id] = next;
        changed = true;
      }
    }
    if (!changed) return;
    const order = { projects, worktrees };
    localStorage.setItem(storageKey, JSON.stringify(order));
    set({ order });
  },
  move: (scope, ids, source, target, edge) => {
    if (moveItem(ids, source, target, edge) === ids) return false;
    const current = get().order;
    const previous = scope === null ? current.projects : current.worktrees[scope] ?? [];
    const next = moveItem(appendIds(previous, ids), source, target, edge);
    const order = scope === null
      ? { ...current, projects: next }
      : { ...current, worktrees: { ...current.worktrees, [scope]: next } };
    localStorage.setItem(storageKey, JSON.stringify(order));
    set({ order });
    return true;
  },
}));
