/* eslint-disable no-control-regex -- 仅匹配终端控制字符，保留日志正文。 */

/** 转为可显示和复制的同一份纯文本。终端字符串指令只在单行内消除，以免截断的指令吞掉后续正文。 */
export function cleanErrorLog(message: string): string {
  return message
    .replace(/(?:\x1b\]|\x9d)[^\r\n\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)/g, '')
    .replace(/(?:\x1b[P^_X]|[\x90\x98\x9e\x9f])[^\r\n\x1b\x9c]*(?:\x1b\\|\x9c)/g, '')
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|\x1b[ -/]*[0-~]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\ufeff|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
}
