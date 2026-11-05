import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeRepository, NativeWorktree } from './native-git';

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/core', () => native);
const storageKey = 'git-workbench.display-names';
const saved = new Map<string, string>();
const main: NativeWorktree = {
  path: '/test/editor', name: 'editor', branch: 'main', detached: false,
  bare: false, isMain: true, locked: null, prunable: null, available: true,
};
const linked: NativeWorktree = { ...main, path: '/test/editor-preview', name: 'preview', branch: 'feature/preview', isMain: false };
const repositoryId = 'native-repository:/test/editor/.git';
const mainId = `native:${main.path}`;
const linkedId = `native:${linked.path}`;

beforeEach(() => {
  vi.resetModules();
  saved.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  });
  native.invoke.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('本机显示名称', () => {
  it('三类名称独立保存，重启恢复别名并保留已有偏好', async () => {
    saved.set('git-workbench.preferences', 'existing preferences');
    const { useDisplayNames } = await import('./display-names');
    useDisplayNames.getState().setName(repositoryId, '  项目工作台  ');
    useDisplayNames.getState().setName(mainId, '主线开发');
    useDisplayNames.getState().setName(linkedId, '界面迭代');
    const expected = { [repositoryId]: '项目工作台', [mainId]: '主线开发', [linkedId]: '界面迭代' };
    expect(useDisplayNames.getState().names).toEqual(expected);

    vi.resetModules();
    expect((await import('./display-names')).useDisplayNames.getState().names).toEqual(expected);
    expect(saved.get('git-workbench.preferences')).toBe('existing preferences');
  });

  it('保存和恢复默认写盘失败时，都不发布新的显示状态', async () => {
    const { useDisplayNames } = await import('./display-names');
    useDisplayNames.getState().setName(mainId, '原名称');
    const names = useDisplayNames.getState().names;
    const disk = saved.get(storageKey);
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('disk full'); });
    for (const next of ['新名称', null]) {
      expect(() => useDisplayNames.getState().setName(mainId, next)).toThrow('disk full');
      expect(useDisplayNames.getState().names).toBe(names);
      expect(saved.get(storageKey)).toBe(disk);
    }
    write.mockRestore();
    useDisplayNames.getState().setName(mainId, '重试名称');
    expect(useDisplayNames.getState().names[mainId]).toBe('重试名称');
  });

  it('恢复默认删除别名，主工作区随界面语言变化而自定义名称保持原文', async () => {
    const { useDisplayNames } = await import('./display-names');
    const { worktreeLabel } = await import('../components/branch-display');
    const { setLanguage } = await import('./i18n');
    const worktree = { ...main, id: mainId, files: [], commits: [] };
    useDisplayNames.getState().setName(mainId, '主线开发');
    setLanguage('en');
    expect(worktreeLabel(worktree, useDisplayNames.getState().names[mainId])).toBe('主线开发');
    useDisplayNames.getState().setName(mainId, null);
    expect(worktreeLabel(worktree, useDisplayNames.getState().names[mainId])).toBe('Main worktree');
    setLanguage('zh-CN');
    expect(worktreeLabel(worktree, useDisplayNames.getState().names[mainId])).toBe('主工作区');
    expect(JSON.parse(saved.get(storageKey)!)).not.toHaveProperty(mainId);
  });

  it('允许重名和长名称，拒绝空白且不写盘', async () => {
    const { useDisplayNames } = await import('./display-names');
    const long = '共同显示名称'.repeat(80);
    useDisplayNames.getState().setName(mainId, long);
    useDisplayNames.getState().setName(linkedId, long);
    const disk = saved.get(storageKey);
    expect(() => useDisplayNames.getState().setName(mainId, ' \n ')).toThrow('名称不能为空');
    expect(useDisplayNames.getState().names).toEqual({ [mainId]: long, [linkedId]: long });
    expect(saved.get(storageKey)).toBe(disk);
  });

  it.each(['invalid json', 'null', '[]', '{"valid":"可用名称","empty":" ","bad":42}'])('兼容不可用存储内容 %s', async raw => {
    saved.set(storageKey, raw);
    const { useDisplayNames } = await import('./display-names');
    expect(useDisplayNames.getState().names).toEqual(raw.includes('可用名称') ? { valid: '可用名称' } : {});
  });

  it('Git 刷新、切换工作区与重启恢复均不覆盖别名或修改路径、分支和草稿', async () => {
    let linkedBranch = linked.branch;
    native.invoke.mockImplementation(async (command: string, args: { path?: string; repoPath?: string }) => {
      if (command === 'git_diff') return { original: '', modified: '', notice: null };
      const current = args.path === linked.path || args.repoPath === linked.path ? { ...linked, branch: linkedBranch } : main;
      const result: NativeRepository = {
        commonDir: '/test/editor/.git', repositoryName: 'editor', worktrees: [main, { ...linked, branch: linkedBranch }],
        path: current.path, name: current.name, branch: current.branch, hasHead: true, operation: null, files: [],
        remote: { remotes: [], upstream: null, upstreamRemote: null, upstreamBranch: null, defaultRemote: null, ahead: null, behind: null },
      };
      return result;
    });
    const { useWorkbench } = await import('./store');
    const { useDisplayNames } = await import('./display-names');
    await useWorkbench.getState().openRepository(main.path);
    useWorkbench.getState().setDraft({ message: '保留的提交草稿' });
    useDisplayNames.getState().setName(repositoryId, '项目工作台');
    useDisplayNames.getState().setName(mainId, '主线开发');
    useDisplayNames.getState().setName(linkedId, '界面迭代');
    const aliases = useDisplayNames.getState().names;
    await useWorkbench.getState().refresh();
    expect(useWorkbench.getState().activeWorktreeId).toBe(mainId);
    expect(useWorkbench.getState().drafts[mainId].message).toBe('保留的提交草稿');
    useWorkbench.getState().selectWorktree(linkedId);
    await vi.waitFor(() => expect(useWorkbench.getState().refreshing).toBe(false));
    linkedBranch = 'feature/new-branch';
    await useWorkbench.getState().refresh();
    expect(useDisplayNames.getState().names).toEqual(aliases);
    expect(useWorkbench.getState().repositories[0].name).toBe('editor');
    expect(useWorkbench.getState().repositories[0].worktrees[1]).toMatchObject({ name: 'preview', path: linked.path, branch: linkedBranch });

    vi.resetModules();
    const reopened = (await import('./store')).useWorkbench;
    await reopened.getState().restoreSession();
    expect(reopened.getState().activeWorktreeId).toBe(linkedId);
    expect((await import('./display-names')).useDisplayNames.getState().names).toEqual(aliases);
  });
});
