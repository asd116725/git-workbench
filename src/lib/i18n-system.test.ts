import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from './i18n';
import { translateMessage } from './i18n-system';

beforeEach(() => setLanguage('en'));
afterEach(() => setLanguage('zh-CN'));

describe('应用业务提示国际化', () => {
  it('保存的简体错误在三种语言间双向切换，不修改源消息', () => {
    const saved = '当前分支尚未设置上游，请先推送并建立跟踪关系。';
    expect(translateMessage(saved)).toBe('The current branch has no upstream. Push it and set up tracking first.');
    setLanguage('zh-TW');
    expect(translateMessage(saved)).toBe('目前分支尚未設定上游，請先推送並建立追蹤關係。');
    setLanguage('zh-CN');
    expect(translateMessage(saved)).toBe(saved);
    setLanguage('en');
    expect(translateMessage(saved)).toBe('The current branch has no upstream. Push it and set up tracking first.');
  });

  it('分支名称含中文、花括号及替换字符时保持原文', () => {
    const name = '功能/今天-{name}-$&-尚无提交';
    expect(translateMessage(`本地分支“${name}”已存在，请使用其他名称。`)).toBe(`Local branch “${name}” already exists. Use another name.`);
    setLanguage('zh-TW');
    expect(translateMessage(`本地分支“${name}”已存在，请使用其他名称。`)).toBe(`本機分支「${name}」已存在，請使用其他名稱。`);
  });

  it('双路径和换行文件名均原样保留', () => {
    const restored = '目录/文件\n今天 {error}.ts';
    const indexed = '目录/[旧文件] (1).ts';
    expect(translateMessage(`路径“${restored}”与索引中的“${indexed}”冲突。请先处理对应文件的暂存状态，再重试。`))
      .toBe(`Path “${restored}” conflicts with “${indexed}” in the index. Resolve their staging state before retrying.`);
  });

  it('文件名包含模板分隔文字导致边界不唯一时保留整段原文', () => {
    const message = '路径“文件”与索引中的“目录/今天”与索引中的“旧文件”冲突。请先处理对应文件的暂存状态，再重试。';
    expect(translateMessage(message)).toBe(message);
  });

  it('应用错误前缀后的 Git 原始 stderr 整体保留，包含类似应用提示的文本也不再翻译', () => {
    const stderr = 'fatal: 分支“今天”失败\n尚无提交\n无法打开文件：用户提交内容\n{error} $&\n';
    expect(translateMessage(`无法运行 Git：${stderr}`)).toBe(`Unable to run Git: ${stderr}`);
    expect(translateMessage(`分支已更新，但拉取的后续步骤失败：\n${stderr}`)).toBe(`The branch was updated, but subsequent pull steps failed:\n${stderr}`);
  });

  it('只翻译完整应用提示，不扫描或改写未知 Git 输出里的中文片段', () => {
    for (const raw of ['fatal: 已经位于当前分支。', '尚无提交\n用户内容', '已经位于当前分支。\n', 'commit: 今天\n请填写提交说明。']) {
      expect(translateMessage(raw)).toBe(raw);
    }
  });

  it.each(['今天', '请填写提交信息。', '  文件/今天 {error}\n请填写提交信息。\n'])('Git 原始输出与应用文案同名时保留来源和详情：%s', detail => {
    const message = `Git:\n${detail}`;
    for (const language of ['en', 'zh-TW', 'zh-CN'] as const) {
      setLanguage(language);
      expect(translateMessage(message)).toBe(message);
    }
    setLanguage('en');
    expect(translateMessage(`分支已更新，但拉取的后续步骤失败：\n${message}`))
      .toBe(`The branch was updated, but subsequent pull steps failed:\n${message}`);
  });

  it('繁体系统术语与界面统一使用儲存庫，插值中的仓库名称不受影响', () => {
    setLanguage('zh-TW');
    expect(translateMessage('裸仓库')).toBe('裸儲存庫');
    expect(translateMessage('仓库文件监听异常：倉庫/文件')).toBe('儲存庫檔案監聽異常：倉庫/文件');
  });

  it('二进制、超大文件以及属性差异提示支持本地和历史 Diff', () => {
    expect(translateMessage('二进制文件暂不支持文本 Diff，可直接暂存和提交。')).toBe('Text diff is unavailable for binary files. You can still stage and commit them.');
    expect(translateMessage('文件超过 2 MiB，已跳过文本 Diff。')).toBe('This file exceeds 2 MiB, so text diff was skipped.');
    const details = 'diff --git a/今天.txt b/昨天.txt\nold mode 100644\nnew mode 100755';
    expect(translateMessage(`文本内容未变化，仅文件属性或路径发生变化。\n${details}`)).toBe(`The text is unchanged; only file attributes or the path changed.\n${details}`);
    expect(translateMessage('文本内容未变化，文件模式从 100644 变为 100755。')).toBe('The text is unchanged; file mode changed from 100644 to 100755.');
  });

  it.each([
    ['合并', 'merge'], ['变基', 'rebase'], ['拣选提交', 'cherry-pick'], ['还原提交', 'revert'],
  ])('翻译%s操作的动态阻止原因', (operation, english) => {
    expect(translateMessage(`请先完成当前${operation}操作。`)).toBe(`Complete the current ${english} first.`);
    expect(translateMessage(`请先在外部工具中完成${operation}操作。`)).toBe(`Complete the ${english} in an external tool first.`);
  });

  it('刷新与监听失败只翻译应用上下文，保留嵌套原始详情', () => {
    const details = 'ENOENT /用户/尚无提交/{error}';
    expect(translateMessage(`自动刷新失败，可点击「刷新」重试：${details}`)).toBe(`Automatic refresh failed. Click “Refresh” to retry: ${details}`);
    expect(translateMessage(`仓库文件监听异常：${details}`)).toBe(`Repository file watcher error: ${details}`);
  });
});
