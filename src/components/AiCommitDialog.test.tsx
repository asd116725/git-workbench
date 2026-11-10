import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiCommitDialog } from './AiCommitDialog';
import type { AiCommitState } from '../lib/ai-commit-session';
import { aiCommitErrors } from '../lib/native-ai-commit';
import { setLanguage, t } from '../lib/i18n';
import { usePreferences } from '../lib/store';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children, className }: { children: ReactNode; className: string }) => <div role="dialog" className={className}>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

/** 静态渲染读取当前偏好，避免订阅钩子固定使用服务端初始快照。 */
vi.mock('../lib/store', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/store')>();
  return { ...actual, usePreferences: Object.assign(
    (selector: (state: ReturnType<typeof actual.usePreferences.getState>) => unknown) => selector(actual.usePreferences.getState()),
    actual.usePreferences,
  ) };
});

const result = { message: 'fix(core): 中文文案', snapshotId: 'snapshot', files: ['src/中文文件.ts', '换行\n文件.ts'] };

function render(patch: Partial<AiCommitState> = {}, hasDraft = true) {
  const state: AiCommitState = {
    phase: 'preview', result, candidate: result.message, error: null, validating: false, draftChanged: false,
    open: vi.fn(), checkKey: vi.fn(), generate: vi.fn(), close: vi.fn(), edit: vi.fn(), apply: vi.fn(), connect: vi.fn(), ...patch,
  };
  return renderToStaticMarkup(<AiCommitDialog state={state} stagedCount={2} hasDraft={hasDraft} blocked={false} onApply={vi.fn()} onCloseFocus={vi.fn()} />);
}

beforeEach(() => usePreferences.setState({ aiCommitMode: 'concise' }));
afterEach(() => setLanguage('zh-CN'));

describe('AI 提交预览', () => {
  it('显示当前模式和重新生成提示，生成与校验期间禁用模式切换', () => {
    const concise = render();
    expect(concise).toMatch(/<button[^>]*aria-pressed="true"[^>]*>简洁<\/button>/);
    expect(concise).toContain('简短标题，必要时补充 1–3 条要点');
    expect(concise).toContain('切换模式后，点击');
    usePreferences.setState({ aiCommitMode: 'detailed' });
    expect(render()).toMatch(/<button[^>]*aria-pressed="true"[^>]*>详细（Skill）<\/button>/);
    expect(render()).toContain('按 Skill 生成概述和详细要点');
    for (const patch of [{ phase: 'generating' as const, result: null }, { validating: true }]) {
      const html = render(patch);
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>简洁<\/button>/);
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>详细（Skill）<\/button>/);
    }
  });

  it('明确替换已有草稿，无草稿使用文案，结果和路径保持原文', () => {
    const html = render();
    expect(html).toContain('替换草稿');
    expect(html).toContain('已有手写草稿');
    expect(html).toContain('fix(core): 中文文案');
    expect(html).toContain('src/中文文件.ts');
    expect(html).not.toContain('readOnly=""');
    expect(render({}, false)).toContain('使用此文案');
    expect(render({}, false)).not.toContain('替换草稿');
  });

  it('空候选和核验期间禁用应用，失效结果只读且仅允许重新生成', () => {
    expect(render({ candidate: '  ' })).toMatch(/<button[^>]*disabled=""[^>]*>替换草稿<\/button>/);
    expect(render({ validating: true })).toMatch(/<button[^>]*disabled=""[^>]*>替换草稿<\/button>/);
    const stale = render({ phase: 'stale', error: 'stale_snapshot' });
    expect(stale).toContain('readOnly=""');
    expect(stale).toContain('暂存内容或当前提交已变化');
    expect(stale).not.toMatch(/<button[^>]*>替换草稿<\/button>/);
    expect(stale).toMatch(/<button[^>]*>重新生成<\/button>/);
  });

  it('缺密钥只提供检测操作，检测成功只提供开始生成', () => {
    const missing = render({ phase: 'error', result: null, error: 'missing_key' });
    expect(missing).toContain('DEEPSEEK_API_KEY');
    expect(missing).toContain('重新检测');
    expect(missing).not.toContain('<input');
    expect(missing).not.toContain('开始生成');
    const ready = render({ phase: 'ready', result: null });
    expect(ready).toContain('已检测到 API Key');
    expect(ready).toContain('不代表已通过服务鉴权');
    expect(ready).toContain('开始生成');
  });

  it.each([
    ['zh-CN', 'AI 生成提交信息', '替换草稿', '简洁', '详细（Skill）', '重试'],
    ['zh-TW', 'AI 產生提交訊息', '取代草稿', '簡潔', '詳細（Skill）', '重試'],
    ['en', 'Generate commit message with AI', 'Replace draft', 'Concise', 'Detailed (Skill)', 'Retry'],
  ] as const)('%s 翻译界面并保留已有候选和文件路径原文', (language, title, action, concise, detailed, retry) => {
    setLanguage(language);
    const html = render();
    expect(html).toContain(title);
    expect(html).toContain(action);
    expect(html).toContain(concise);
    expect(html).toContain(detailed);
    expect(render({ phase: 'error', result: null, error: 'input_too_large' })).toContain(`>${retry}</button>`);
    expect(html).toContain('fix(core): 中文文案');
    expect(html).toContain('src/中文文件.ts');
    if (language === 'en') for (const source of Object.values(aiCommitErrors)) expect(t(source)).not.toBe(source);
  });

  it('加载可取消，草稿变化有明确的再次确认提示', () => {
    const loading = render({ phase: 'generating', result: null });
    expect(loading).toContain('正在生成提交文案');
    expect(loading).toContain('取消生成');
    expect(loading).not.toContain('<textarea');
    expect(render({ draftChanged: true })).toContain('草稿已发生变化');
  });
});
