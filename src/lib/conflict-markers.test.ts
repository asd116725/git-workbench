import { describe, expect, it } from 'vitest';
import { findConflictBlocks } from './conflict-markers';

describe('工作区冲突标记定位', () => {
  it('保留真实行号并区分多个冲突块', () => {
    const text = 'context\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> incoming\nkeep\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> other\n';
    expect(findConflictBlocks(text, 7)).toEqual([
      { start: 2, base: null, separator: 4, end: 6 },
      { start: 8, base: null, separator: 10, end: 12 },
    ]);
  });

  it('支持 diff3 / zdiff3 的祖先段、CRLF 和自定义标记长度', () => {
    expect(findConflictBlocks('<<<<< ours\r\nleft\r\n||||| base\r\nbase\r\n=====\r\nright\r\n>>>>> theirs\r\n', 5)).toEqual([
      { start: 1, base: 3, separator: 5, end: 7 },
    ]);
  });

  it('不把残缺标记、行内文本和更长的相似符号当成完整冲突', () => {
    expect(findConflictBlocks('const text = "<<<<<<<";\n<<<<<<<< not-a-marker\n=======\n>>>>>>> theirs\n<<<<<<< ours\nunfinished', 7)).toEqual([]);
  });

  it('空侧和已编辑解决的工作区均可识别', () => {
    expect(findConflictBlocks('<<<<<<< HEAD\n=======\n>>>>>>> other', 7)).toEqual([{ start: 1, base: null, separator: 2, end: 3 }]);
    expect(findConflictBlocks('resolved\n', 7)).toEqual([]);
  });
});
