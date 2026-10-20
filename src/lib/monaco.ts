import * as monaco from 'monaco-editor';
import { shikiToMonaco, textmateThemeToMonacoTheme } from '@shikijs/monaco';
import { syntaxHighlighter } from './syntax-highlighter';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

/** 编辑器和语言服务由 Vite 本地打包，保证桌面离线启动不访问 CDN。 */
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'json') return new JsonWorker();
    return new EditorWorker();
  },
};

/** JSX 语言单独注册；只读 Diff 也保留与 TS／JS 相同的括号着色。 */
for (const id of ['tsx', 'jsx']) {
  monaco.languages.register({ id });
  monaco.languages.setLanguageConfiguration(id, {
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  });
}

shikiToMonaco(syntaxHighlighter, monaco);
const theme = textmateThemeToMonacoTheme(syntaxHighlighter.getTheme('workbench-dark'));
monaco.editor.defineTheme('workbench-dark', {
  ...theme,
  inherit: true,
  rules: [
    /** 未接入 TextMate 的语言继续使用 Monaco 语法，保留基础数字、类型与标点颜色。 */
    { token: 'number', foreground: 'D19A66' },
    { token: 'type.identifier', foreground: 'E5C07B' },
    { token: 'identifier', foreground: 'ABB2BF' },
    { token: 'delimiter', foreground: 'ABB2BF' },
    { token: 'tag', foreground: 'E06C75' },
    { token: 'attribute.name', foreground: 'D19A66' },
    { token: 'attribute.value', foreground: '98C379' },
    ...theme.rules,
  ],
  colors: {
    ...theme.colors,
    /** 新版 Monaco 的键名兼容映射也引用原主题，保留上游 Diff 透明色与默认行底色。 */
    'editorIndentGuide.background1': theme.colors['editorIndentGuide.background'],
    'editorIndentGuide.activeBackground1': theme.colors['editorIndentGuide.activeBackground'],
    'diffEditor.border': theme.colors['editorGroup.border'],
    'diffEditor.unchangedRegionBackground': theme.colors['sideBar.background'],
    'diffEditor.unchangedRegionForeground': theme.colors['editor.foreground'],
  },
});

export { monaco };
