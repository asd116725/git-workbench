import type { FileSnapshot } from './types';

/** 文件节点保留原始快照，目录只负责分组，不改变 Git 操作的目标路径。 */
export type ChangeTreeNode =
  | { kind: 'file'; name: string; path: string; file: FileSnapshot }
  | { kind: 'directory'; name: string; path: string; children: ChangeTreeNode[]; fileCount: number };

const names = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/** Git 路径使用正斜线；文件和同名目录可同时存在于删除、新增的变更列表中。 */
export function buildChangeTree(files: FileSnapshot[]): ChangeTreeNode[] {
  const root: ChangeTreeNode[] = [];
  const directories = new Map<string, Extract<ChangeTreeNode, { kind: 'directory' }>>();
  for (const file of files) {
    const parts = file.path.split('/');
    let children = root;
    let path = '';
    for (const name of parts.slice(0, -1)) {
      path = path ? `${path}/${name}` : name;
      let directory = directories.get(path);
      if (!directory) {
        directory = { kind: 'directory', name, path, children: [], fileCount: 0 };
        directories.set(path, directory);
        children.push(directory);
      }
      directory.fileCount++;
      children = directory.children;
    }
    children.push({ kind: 'file', name: parts[parts.length - 1], path: file.path, file });
  }
  function sort(nodes: ChangeTreeNode[]) {
    nodes.sort((a, b) => a.kind !== b.kind ? (a.kind === 'directory' ? -1 : 1) : names.compare(a.name, b.name) || a.name.localeCompare(b.name));
    for (const node of nodes) if (node.kind === 'directory') sort(node.children);
  }
  sort(root);
  return root;
}
