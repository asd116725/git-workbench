import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RemoteActions, RemoteCheckIndicator, RemoteIntegrationNotice } from './RemoteActions';
import { setLanguage } from '../lib/i18n';
import { remoteBlockReason } from '../lib/remote-view';
import type { useWorkbench } from '../lib/store';
import type { Worktree } from '../lib/types';

const hooks = vi.hoisted(() => ({ workbench: vi.fn() }));
vi.mock('../lib/store', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/store')>(), useWorkbench: hooks.workbench,
}));

const worktree: Worktree = {
  id: 'current', name: 'remote', path: '/test/remote', branch: 'main', source: 'native', hasHead: true,
  files: [], commits: [], remote: { remotes: ['origin'], upstream: 'origin/main', upstreamRemote: 'origin', upstreamBranch: 'main', defaultRemote: 'origin', ahead: 3, behind: 0 },
};

const unpublished: Worktree = {
  ...worktree,
  remote: { ...worktree.remote!, upstream: null, upstreamRemote: null, upstreamBranch: null },
};

const sibling = { ...worktree, id: 'sibling', path: '/test/sibling' };
const independent = { ...worktree, id: 'independent', path: '/test/independent' };
const workspace = [{ id: 'repo', name: 'remote', worktrees: [worktree, sibling] }, { id: 'different', name: 'other', worktrees: [independent] }];
const pushing = { repo: { worktreeId: worktree.id, branch: worktree.branch } };

function mockWorkbench(overrides: Partial<ReturnType<typeof useWorkbench.getState>> = {}) {
  hooks.workbench.mockReturnValue({
    repositories: workspace, activeWorktreeId: worktree.id, pushes: {}, busy: false,
    refreshing: false, remoteOperation: null, remoteCheck: null, runRemote: vi.fn(), ...overrides,
  });
}

function render(target = worktree) { return renderToStaticMarkup(<TooltipProvider><RemoteActions worktree={target} /></TooltipProvider>); }

function renderStatus(target = worktree) {
  return renderToStaticMarkup(<TooltipProvider><RemoteCheckIndicator worktree={target} /><RemoteIntegrationNotice worktree={target} onMerge={vi.fn()} /></TooltipProvider>);
}

beforeEach(() => mockWorkbench());

afterEach(() => setLanguage('zh-CN'));

describe('远程工具栏', () => {
  it.each([
    ['zh-CN', '拉取，24 个待拉取提交'],
    ['en', 'Pull, commits to pull: 24'],
    ['zh-TW', '拉取，24 個待拉取提交'],
  ] as const)('%s 同时显示拉取和推送各自的提交数量', (language, label) => {
    setLanguage(language);
    const html = render({ ...worktree, remote: { ...worktree.remote!, behind: 24 } });
    expect(html).toContain(`aria-label="${label}"`);
    expect(html).toMatch(/codicon-arrow-down[^]*?remote-count[^]*?>24<\/span>/);
    expect(html).toMatch(/codicon-arrow-up[^]*?remote-count[^]*?>3<\/span>/);
  });

  it.each([0, null])('待拉取数量为 %s 时隐藏角标', behind => {
    const html = render({ ...worktree, remote: { ...worktree.remote!, ahead: 0, behind } });
    expect(html).not.toContain('remote-count');
    expect(html).toContain('aria-label="拉取"');
  });

  it('没有上游时不将同名远程的差异显示为待拉取数量', () => {
    const html = render({ ...unpublished, remote: { ...unpublished.remote!, behind: 24 } });
    expect(html).not.toContain('remote-count');
    expect(html).toContain('aria-label="发布分支"');
  });
  it.each([['en', 'Fetch', 'Pull', 'Push, commits to push: 3'], ['zh-TW', '擷取', '拉取', '推送，3 個待推送提交']] as const)('%s 更新三个操作及动态数量的无障碍名称', (language, fetch, pull, push) => {
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
    expect(html).toContain('aria-label="推送，3 个待推送提交"');
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
    mockWorkbench({ pushes: pushing });
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

  it('后台推送只在发起工作树显示进度，同仓库只读，独立仓库可操作', () => {
    mockWorkbench({ pushes: pushing });
    const html = render();
    expect(html).toContain('aria-label="推送中"');
    expect(html.match(/codicon-loading spin/g)).toHaveLength(1);
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(render(sibling)).not.toContain('aria-label="推送中"');
    expect(render(sibling).match(/disabled=""/g)).toHaveLength(3);
    expect(render(independent)).not.toContain('disabled=""');
  });

  it('确认分叉后提示合并并限制快进拉取，仍可向可能不同的推送目标发起预检', () => {
    const target = { ...worktree, remote: { ...worktree.remote!, behind: 9, upstreamRef: 'refs/remotes/cache/custom-main' } };
    mockWorkbench({ remoteCheck: { worktreeId: target.id, checking: false, error: null } });
    expect(renderStatus(target)).toContain('本地领先 3 / 远端领先 9');
    expect(renderStatus(target)).toContain('合并上游');
    expect(render(target).match(/disabled=""/g)).toHaveLength(1);
    const push = render(target).match(/<button[^>]*aria-label="推送[^>]*>/)?.[0];
    expect(push).toBeTruthy();
    expect(push).not.toContain('disabled=""');
    expect(render(target).match(/remote-count/g)).toHaveLength(2);
  });

  it('仅落后时引导拉取，过期数字不会禁用推送或触发合并引导', () => {
    const target = { ...worktree, remote: { ...worktree.remote!, ahead: 0, behind: 9 } };
    const check = { worktreeId: target.id, checking: false, error: null };
    mockWorkbench({ remoteCheck: check });
    expect(renderStatus(target)).toContain('远端领先 9 个提交，请先拉取。');
    expect(render(target)).not.toContain('disabled=""');
    mockWorkbench({ remoteCheck: { ...check, error: '无网络' } });
    expect(renderStatus(target)).toContain('远程检查失败，计数可能过期');
    expect(renderStatus(target)).not.toContain('请先拉取');
    expect(render(target)).not.toContain('disabled=""');
  });

  it('尚未通过后台检查时，已有分叉引用也能打开合并，但数量明确来自上次获取', () => {
    const target = { ...worktree, remote: { ...worktree.remote!, behind: 2, upstreamRef: 'refs/remotes/cache/custom-main' } };
    mockWorkbench({ remoteCheck: { worktreeId: target.id, checking: false, error: '无网络' } });
    const html = renderStatus(target);
    expect(html).toContain('远程检查失败，计数可能过期');
    expect(html).toContain('按最近获取的引用：本地领先 3 / 远端领先 2。');
    expect(html).toContain('合并上游');
    expect(html).not.toContain('请先合并');
  });

  it('尚未检查和检查中均有状态，不凭上次的零计数声称已同步', () => {
    const target = { ...worktree, remote: { ...worktree.remote!, ahead: 0 } };
    mockWorkbench({ remoteCheck: { worktreeId: 'old', checking: false, error: '无网络' } });
    expect(renderStatus(target)).toContain('尚未检查远程，计数可能过期');
    mockWorkbench({ remoteCheck: { worktreeId: target.id, checking: true, error: null } });
    expect(renderStatus(target)).toContain('正在检查远程…');
    expect(render(target)).not.toContain('disabled=""');
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
