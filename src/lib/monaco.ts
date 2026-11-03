import * as monaco from 'monaco-editor';
import { shikiToMonaco, textmateThemeToMonacoTheme } from '@shikijs/monaco';
import { syntaxHighlighter } from './syntax-highlighter';
import { editorThemes, useAppearance } from './appearance';
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
/** 两套配色使用同一兼容映射，让原生与 TextMate 语言同时适配主题。 */
function registerEditorTheme(name: string, fallbackRules: monaco.editor.ITokenThemeRule[]) {
  const theme = textmateThemeToMonacoTheme(syntaxHighlighter.getTheme(name));
  monaco.editor.defineTheme(name, {
    ...theme,
    inherit: true,
    rules: [...fallbackRules, ...theme.rules],
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
}

registerEditorTheme(editorThemes.dark, [
  { token: 'number', foreground: 'D19A66' },
  { token: 'type.identifier', foreground: 'E5C07B' },
  { token: 'identifier', foreground: 'ABB2BF' },
  { token: 'delimiter', foreground: 'ABB2BF' },
  { token: 'tag', foreground: 'E06C75' },
  { token: 'attribute.name', foreground: 'D19A66' },
  { token: 'attribute.value', foreground: '98C379' },
]);
registerEditorTheme(editorThemes.light, [
  { token: 'number', foreground: '8F5D12' },
  { token: 'type.identifier', foreground: '916417' },
  { token: 'identifier', foreground: '303745' },
  { token: 'delimiter', foreground: '303745' },
  { token: 'tag', foreground: 'BA4040' },
  { token: 'attribute.name', foreground: '8F5D12' },
  { token: 'attribute.value', foreground: '2D7D46' },
]);
monaco.editor.setTheme(editorThemes[useAppearance.getState().resolvedTheme]);
const stopThemeSync = useAppearance.subscribe((state, previous) => {
  if (state.resolvedTheme !== previous.resolvedTheme) monaco.editor.setTheme(editorThemes[state.resolvedTheme]);
});
import.meta.hot?.dispose(stopThemeSync);

export { monaco };
