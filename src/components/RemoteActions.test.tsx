import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RemoteActions } from './RemoteActions';
import { setLanguage } from '../lib/i18n';
import { remoteBlockReason } from '../lib/remote-view';
import type { Worktree } from '../lib/types';

const hooks = vi.hoisted(() => ({ workbench: vi.fn() }));
vi.mock('../lib/store', () => ({ useWorkbench: hooks.workbench }));

const worktree: Worktree = {
  id: 'current', name: 'remote', path: '/test/remote', branch: 'main', source: 'native', hasHead: true,
  files: [], commits: [], remote: { remotes: ['origin'], upstream: 'origin/main', upstreamRemote: 'origin', upstreamBranch: 'main', defaultRemote: 'origin', ahead: 3, behind: 0 },
};

const unpublished: Worktree = {
  ...worktree,
  remote: { ...worktree.remote!, upstream: null, upstreamRemote: null, upstreamBranch: null },
};

function render(target = worktree) { return renderToStaticMarkup(<TooltipProvider><RemoteActions worktree={target} /></TooltipProvider>); }

beforeEach(() => { hooks.workbench.mockReturnValue({ busy: false, refreshing: false, remoteOperation: null, runRemote: vi.fn() }); });

afterEach(() => setLanguage('zh-CN'));

describe('远程工具栏', () => {
  it.each([['en', 'Fetch', 'Pull', 'Push, commits to push: 3'], ['zh-TW', '擷取', '拉取', '推送，3 個待上傳提交']] as const)('%s 更新三个操作及动态数量的无障碍名称', (language, fetch, pull, push) => {
    setLanguage(language);
    const html = render();
    expect(html).toContain(`aria-label="${fetch}"`);
    expect(html).toContain(`aria-label="${pull}"`);
    expect(html).toContain(`aria-label="${push}"`);
    expect(html).toMatch(/remote-count[^]*?>3<\/span>/);
  });

  it('三个按钮可操作，待上传数字紧邻推送图标并提供可读名称', () => {
    const html = render();
    expect(html).toContain('aria-label="获取"');
    expect(html).toContain('aria-label="拉取"');
    expect(html).toContain('aria-label="推送，3 个待上传提交"');
    expect(html).toMatch(/codicon-arrow-up[^]*?remote-count[^]*?>3<\/span><\/span>推送/);
    expect(html).not.toContain('disabled=""');
  });

  it.each([0, null])('待上传数量为 %s 时不显示数字', ahead => {
    const html = render({ ...worktree, remote: { ...worktree.remote!, ahead } });
    expect(html).not.toContain('remote-count');
    expect(html).toContain('aria-label="推送"');
  });

  it.each([null, 0, 3, 842])('无上游时显示发布分支，不把 %s 当作待上传数', ahead => {
    const html = render({ ...unpublished, remote: { ...unpublished.remote!, ahead } });
    expect(html).toContain('aria-label="发布分支"');
    expect(html).not.toContain('remote-count');
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });

  it.each([
    ['zh-CN', '发布分支', '发布中…'],
    ['zh-TW', '發佈分支', '發佈中…'],
    ['en', 'Publish branch', 'Publishing…'],
  ] as const)('%s 的发布入口和运行态使用对应文案', (language, label, progress) => {
    setLanguage(language);
    expect(render(unpublished)).toContain(`aria-label="${label}"`);
    hooks.workbench.mockReturnValue({ busy: true, refreshing: false, remoteOperation: 'push', runRemote: vi.fn() });
    const html = render(unpublished);
    expect(html).toContain(`aria-label="${progress}"`);
    expect(html.match(/codicon-loading spin/g)).toHaveLength(1);
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).not.toContain('remote-count');
  });

  it('上游配置不完整时保留推送，不误判为首次发布', () => {
    const html = render({ ...worktree, remote: { ...worktree.remote!, upstream: null, upstreamBranch: null, ahead: 842 } });
    expect(html).toContain('aria-label="推送"');
    expect(html).not.toContain('发布分支');
    expect(html).not.toContain('remote-count');
  });

  it('执行中只有当前图标旋转，所有远程按钮禁用', () => {
    hooks.workbench.mockReturnValue({ busy: true, refreshing: false, remoteOperation: 'push', runRemote: vi.fn() });
    const html = render();
    expect(html).toContain('aria-label="推送中"');
    expect(html.match(/codicon-loading spin/g)).toHaveLength(1);
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });

  it('演示模式和无远程禁用全部操作，无上游只禁用拉取', () => {
    expect(render({ ...worktree, source: undefined }).match(/disabled=""/g)).toHaveLength(3);
    expect(render({ ...worktree, remote: { ...worktree.remote!, remotes: [] } }).match(/disabled=""/g)).toHaveLength(3);
    expect(render({ ...worktree, remote: { ...worktree.remote!, upstream: null, upstreamRemote: null, upstreamBranch: null } }).match(/disabled=""/g)).toHaveLength(1);
  });

  it('分离 HEAD 和未完成合并阻止写分支，仍允许获取', () => {
    for (const target of [{ ...worktree, detached: true }, { ...worktree, operation: { kind: 'merge' as const, head: 'a', mergeHeads: ['b'], message: 'merge', source: 'topic' } }]) {
      expect(remoteBlockReason(target, 'fetch')).toBeNull();
      expect(remoteBlockReason(target, 'pull')).not.toBeNull();
      expect(remoteBlockReason(target, 'push')).not.toBeNull();
    }
    expect(remoteBlockReason({ ...worktree, remote: { ...worktree.remote!, upstreamRemote: '.' } }, 'push')).toContain('本地分支');
  });
});
