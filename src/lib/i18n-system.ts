import { getLanguage, t } from './i18n';
import { systemMessages } from './i18n-system-messages';

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 只匹配登记过的完整模板，捕获内容可包含换行和花括号，但不参与再次翻译。 */
const templates = Object.keys(systemMessages).flatMap(source => {
  const parameters = [...source.matchAll(/\{(\w+)\}/g)];
  if (!parameters.length) return [];
  let previous = 0;
  let pattern = '^';
  let greedyPattern = '^';
  for (const parameter of parameters) {
    const literal = escapePattern(source.slice(previous, parameter.index));
    pattern += literal + '([\\s\\S]*?)';
    greedyPattern += literal + '([\\s\\S]*)';
    previous = parameter.index + parameter[0].length;
  }
  pattern += escapePattern(source.slice(previous)) + '$';
  greedyPattern += escapePattern(source.slice(previous)) + '$';
  return [{ source, names: parameters.map(parameter => parameter[1]), pattern: new RegExp(pattern), greedyPattern: new RegExp(greedyPattern) }];
});

/**
 * 按当前语言展示缓存中的应用提示。动态路径、分支、提交内容及 Git 原始输出保持原文；
 * 不拆分错误详情或递归翻译参数，避免将用户内容误判为应用提示。
 */
export function translateMessage(message: string): string {
  if (getLanguage() === 'zh-CN') return message;
  const direct = t(message);
  if (direct !== message) return direct;
  for (const template of templates) {
    const match = template.pattern.exec(message);
    if (!match || match[0] !== message) continue;
    /** 路径可包含模板分隔文字；无法唯一确定参数边界时保留整段原文。 */
    if (template.names.length > 1) {
      const greedy = template.greedyPattern.exec(message)!;
      if (match.some((value, index) => value !== greedy[index])) continue;
    }
    return t(template.source, Object.fromEntries(template.names.map((name, index) => [name, match[index + 1]])));
  }
  return message;
}
