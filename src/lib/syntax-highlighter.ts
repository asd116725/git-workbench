import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import typescript from 'shiki/langs/typescript.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import jsx from 'shiki/langs/jsx.mjs';
import json from 'shiki/langs/json.mjs';
import css from 'shiki/langs/css.mjs';
import scss from 'shiki/langs/scss.mjs';
import html from 'shiki/langs/html.mjs';
import oneDark from '../themes/atom-one-dark.json';

/** 使用 VS Code 原主题的完整作用域规则，避免把导入变量和类型声明混为一种颜色。 */
export const syntaxHighlighter = createHighlighterCoreSync({
  themes: [{ ...oneDark, name: 'workbench-dark', type: 'dark' }],
  langs: [typescript, tsx, javascript, jsx, json, css, scss, html],
  /** 语法和引擎随应用打包，离线使用且不需要放宽 CSP 以执行 WASM。 */
  engine: createJavaScriptRegexEngine({ target: 'ES2018' }),
});

/** TSX／JSX 必须使用各自的语法，否则标签与泛型会被错误识别。 */
export function getEditorLanguage(path: string, language: string): string {
  if (/\.tsx$/i.test(path)) return 'tsx';
  if (/\.jsx$/i.test(path)) return 'jsx';
  return language;
}
