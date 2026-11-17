/** 冲突块采用工作区文件的 1 起始行号，base 仅存在于 diff3 / zdiff3 格式。 */
export interface ConflictBlock {
  start: number;
  base: number | null;
  separator: number;
  end: number;
}

/** 只识别完整 Git 冲突块，避免把普通源码中的相似文本当作冲突。 */
export function findConflictBlocks(text: string, markerSize: number): ConflictBlock[] {
  const marker = new RegExp(`^(<{${markerSize}}|\\|{${markerSize}}|={${markerSize}}|>{${markerSize}})(?: |$)`);
  const blocks: ConflictBlock[] = [];
  let pending: Omit<ConflictBlock, 'end'> | null = null;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const kind = marker.exec(line)?.[1][0];
    const lineNumber = index + 1;
    if (kind === '<') pending = { start: lineNumber, base: null, separator: 0 };
    else if (pending && kind === '|' && !pending.separator) pending.base = lineNumber;
    else if (pending && kind === '=' && !pending.separator) pending.separator = lineNumber;
    else if (pending && kind === '>') {
      if (pending.separator) blocks.push({ ...pending, end: lineNumber });
      pending = null;
    }
  }
  return blocks;
}
