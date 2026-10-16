import { describe, expect, it } from 'vitest';
import { getEditorLanguage, syntaxHighlighter } from './syntax-highlighter';

function tokenize(code: string, path = 'example.tsx') {
  return syntaxHighlighter.codeToTokensBase(code, {
    lang: getEditorLanguage(path, 'typescript'), theme: 'workbench-dark',
  });
}

describe('VS Code TextMate 主题适配', () => {
  it('同一名称在导入和类型声明中使用不同颜色，函数名不再退化为普通文本', () => {
    const lines = tokenize("import {BaseSchema} from 'example';\ninterface Schema extends BaseSchema {}\nfunction formatValue(input: number) { return input; }");
    expect(lines[0].find(token => token.content === 'BaseSchema')?.color).toBe('#E06C75');
    expect(lines[1].find(token => token.content === 'BaseSchema')?.color).toBe('#E5C07B');
    expect(lines[2].find(token => token.content === 'formatValue')?.color).toBe('#61AFEF');
  });

  it('跨行保留注释作用域，结束注释后正确识别 JSX 属性和表达式', () => {
    const lines = tokenize('/**\n * import fake from "fake";\n */\nconst view = <span title="hello">{formatValue(1)}</span>;');
    expect(lines[1].every(token => token.color === '#5C6370')).toBe(true);
    expect(lines[3].find(token => token.content === 'title')?.color).toBe('#D19A66');
    expect(lines[3].find(token => token.content === '"hello"')?.color).toBe('#98C379');
    expect(lines[3].find(token => token.content === 'formatValue')?.color).toBe('#61AFEF');
  });

  it('普通 TS 的泛型与 TSX／JSX 分开处理，保留其他语言', () => {
    const lines = tokenize('const value = <Item>input;', 'example.ts');
    expect(lines[0].find(token => token.content === 'Item')?.color).toBe('#E5C07B');
    expect(getEditorLanguage('view.JSX', 'javascript')).toBe('jsx');
    expect(getEditorLanguage('style.scss', 'scss')).toBe('scss');
  });
});
