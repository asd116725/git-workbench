import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveItem, orderedItems } from './sidebar-order';

const storageKey = 'git-workbench.sidebar-order';
const saved = new Map<string, string>();

beforeEach(() => {
  vi.resetModules();
  saved.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { saved.set(key, value); }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('侧栏顺序', () => {
  it('旧 ID 和重复 ID 不生成占位，新发现项目按原始顺序追加', () => {
    const items = [{ id: 'main' }, { id: 'preview' }, { id: 'docs' }, { id: 'new' }];
    expect(orderedItems(items).map(item => item.id)).toEqual(['main', 'preview', 'docs', 'new']);
    expect(orderedItems(items, ['docs', 'removed', 'preview', 'docs']).map(item => item.id)).toEqual(['docs', 'preview', 'main', 'new']);
    expect(items.map(item => item.id)).toEqual(['main', 'preview', 'docs', 'new']);
  });

  it.each([
    ['a', 'c', 'before', ['b', 'a', 'c']],
    ['a', 'c', 'after', ['b', 'c', 'a']],
    ['c', 'a', 'before', ['c', 'a', 'b']],
    ['c', 'a', 'after', ['a', 'c', 'b']],
  ] as const)('将 %s 插入 %s 的 %s 位置', (source, target, edge, expected) => {
    const ids = ['a', 'b', 'c'];
    expect(moveItem(ids, source, target, edge)).toEqual(expected);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('同项、相邻原位置及失效或跨项目 ID 不产生新顺序', () => {
    const ids = ['main', 'linked'];
    expect(moveItem(ids, 'main', 'main', 'after')).toBe(ids);
    expect(moveItem(ids, 'main', 'linked', 'before')).toBe(ids);
    expect(moveItem(ids, 'main', 'foreign-worktree', 'after')).toBe(ids);
    expect(moveItem(ids, 'deleted', 'linked', 'before')).toBe(ids);
  });

  it('项目与各项目工作树独立保存，主工作区可移到末尾并在重启后恢复', async () => {
    saved.set('git-workbench.display-names', '{"main":"主线开发"}');
    const { useSidebarOrder } = await import('./sidebar-order');
    const { move } = useSidebarOrder.getState();
    move(null, ['editor', 'api'], 'api', 'editor', 'before');
    move('editor', ['main', 'preview', 'docs'], 'main', 'docs', 'after');
    move('api', ['api-main', 'api-test'], 'api-test', 'api-main', 'before');
    const expected = { projects: ['api', 'editor'], worktrees: { editor: ['preview', 'docs', 'main'], api: ['api-test', 'api-main'] } };
    expect(useSidebarOrder.getState().order).toEqual(expected);
    vi.resetModules();
    expect((await import('./sidebar-order')).useSidebarOrder.getState().order).toEqual(expected);
    expect(saved.get('git-workbench.display-names')).toBe('{"main":"主线开发"}');
  });

  it('写入失败保持原顺序和磁盘内容，允许重试', async () => {
    const { useSidebarOrder } = await import('./sidebar-order');
    useSidebarOrder.getState().move(null, ['a', 'b'], 'b', 'a', 'before');
    const previous = useSidebarOrder.getState().order;
    const disk = saved.get(storageKey);
    const write = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => { throw new Error('disk full'); });
    expect(() => useSidebarOrder.getState().move(null, ['b', 'a'], 'a', 'b', 'before')).toThrow('disk full');
    expect(useSidebarOrder.getState().order).toBe(previous);
    expect(saved.get(storageKey)).toBe(disk);
    write.mockRestore();
    expect(useSidebarOrder.getState().move(null, ['b', 'a'], 'a', 'b', 'before')).toBe(true);
    expect(useSidebarOrder.getState().order.projects).toEqual(['a', 'b']);
  });

  it('无效拖动和位置未变不写存储', async () => {
    const { useSidebarOrder } = await import('./sidebar-order');
    expect(useSidebarOrder.getState().move('editor', ['main', 'linked'], 'main', 'linked', 'before')).toBe(false);
    expect(useSidebarOrder.getState().move('editor', ['main', 'linked'], 'main', 'other-main', 'after')).toBe(false);
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it.each(['invalid json', 'null', '[]', '{"projects":7,"worktrees":null}'])('损坏的存储 %s 回落原始顺序', async raw => {
    saved.set(storageKey, raw);
    expect((await import('./sidebar-order')).useSidebarOrder.getState().order).toEqual({ projects: [], worktrees: {} });
  });

  it('部分损坏的内容仅保留有效 ID', async () => {
    saved.set(storageKey, JSON.stringify({ projects: ['b', 3, '', 'b', 'a'], worktrees: { editor: ['linked', null, 'main', 'linked'], invalid: false } }));
    expect((await import('./sidebar-order')).useSidebarOrder.getState().order).toEqual({ projects: ['b', 'a'], worktrees: { editor: ['linked', 'main'], invalid: [] } });
  });

  it('Git 元数据刷新与增删工作树后沿用稳定 ID 顺序，不修改名称、路径与分支', async () => {
    const { useSidebarOrder } = await import('./sidebar-order');
    useSidebarOrder.getState().move('editor', ['main', 'removed', 'linked'], 'linked', 'main', 'before');
    const refreshed = [
      { id: 'main', name: 'editor', path: '/editor', branch: 'main' },
      { id: 'linked', name: 'preview', path: '/preview', branch: 'feature/new' },
      { id: 'new', name: 'new', path: '/new', branch: 'feature/new-tree' },
    ];
    const before = structuredClone(refreshed);
    const sorted = orderedItems(refreshed, useSidebarOrder.getState().order.worktrees.editor);
    expect(sorted.map(item => item.id)).toEqual(['linked', 'main', 'new']);
    expect(sorted[0]).toBe(refreshed[1]);
    expect(refreshed).toEqual(before);
  });

  it('先发现 z 再发现 a 时持续追加，Git 路径顺序变化及重载不重排已发现项', async () => {
    const { useSidebarOrder } = await import('./sidebar-order');
    const { move, observe } = useSidebarOrder.getState();
    move(null, ['editor', 'api'], 'api', 'editor', 'before');
    move('editor', ['main', 'original'], 'original', 'main', 'before');
    observe([{ id: 'editor', worktrees: [{ id: 'main' }, { id: 'original' }, { id: 'z' }] }, { id: 'api', worktrees: [] }, { id: 'z-project', worktrees: [] }]);
    const refreshed = [{ id: 'main' }, { id: 'a' }, { id: 'original' }, { id: 'z' }];
    observe([{ id: 'a-project', worktrees: [] }, { id: 'editor', worktrees: refreshed }, { id: 'api', worktrees: [] }, { id: 'z-project', worktrees: [] }]);
    const expected = { projects: ['api', 'editor', 'z-project', 'a-project'], worktrees: { editor: ['original', 'main', 'z', 'a'] } };
    expect(useSidebarOrder.getState().order).toEqual(expected);
    vi.resetModules();
    const restored = (await import('./sidebar-order')).useSidebarOrder.getState().order;
    expect(restored).toEqual(expected);
    expect(orderedItems(refreshed, restored.worktrees.editor).map(item => item.id)).toEqual(['original', 'main', 'z', 'a']);
  });

  it('观察缺席或原始顺序变化时保留记录，只有首次发现 ID 才写盘', async () => {
    const { useSidebarOrder } = await import('./sidebar-order');
    const { observe } = useSidebarOrder.getState();
    observe([{ id: 'editor', worktrees: [{ id: 'main' }, { id: 'linked' }] }, { id: 'api', worktrees: [] }]);
    const previous = useSidebarOrder.getState().order;
    vi.mocked(localStorage.setItem).mockClear();
    observe([{ id: 'editor', worktrees: [{ id: 'linked' }] }]);
    observe([{ id: 'api', worktrees: [] }, { id: 'editor', worktrees: [{ id: 'linked' }, { id: 'main' }] }]);
    expect(useSidebarOrder.getState().order).toBe(previous);
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('观察新增项写入失败不覆盖既存顺序，下次观察可重试', async () => {
    const { useSidebarOrder } = await import('./sidebar-order');
    const { observe, move } = useSidebarOrder.getState();
    move('editor', ['main', 'linked'], 'linked', 'main', 'before');
    const previous = useSidebarOrder.getState().order;
    const disk = saved.get(storageKey);
    const repositories = [{ id: 'editor', worktrees: [{ id: 'a' }, { id: 'linked' }, { id: 'main' }] }];
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => { throw new Error('disk full'); });
    expect(() => observe(repositories)).toThrow('disk full');
    expect(useSidebarOrder.getState().order).toBe(previous);
    expect(saved.get(storageKey)).toBe(disk);
    observe(repositories);
    expect(useSidebarOrder.getState().order).toEqual({ projects: ['editor'], worktrees: { editor: ['linked', 'main', 'a'] } });
  });

  it('调整可见项顺序时仍保留缺席 ID，重新出现后可继续使用', async () => {
    const { useSidebarOrder } = await import('./sidebar-order');
    const { observe, move } = useSidebarOrder.getState();
    observe([{ id: 'editor', worktrees: [{ id: 'main' }, { id: 'missing' }, { id: 'linked' }] }]);
    move('editor', ['main', 'linked'], 'linked', 'main', 'before');
    expect(useSidebarOrder.getState().order.worktrees.editor).toEqual(['linked', 'main', 'missing']);
    const visible = [{ id: 'main' }, { id: 'linked' }];
    expect(orderedItems(visible, useSidebarOrder.getState().order.worktrees.editor).map(item => item.id)).toEqual(['linked', 'main']);
  });
});
