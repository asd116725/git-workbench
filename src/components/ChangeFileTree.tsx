import type { CSSProperties, ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ChangeTreeNode } from '../lib/change-tree';
import type { FileSnapshot } from '../lib/types';

/** 目录展开状态由稳定路径保留，文件选择和暂存操作复用列表视图的同一行。 */
export function ChangeFileTree({ nodes, renderFile, renderDirectoryAction }: {
  nodes: ChangeTreeNode[];
  renderFile: (file: FileSnapshot, depth: number) => ReactNode;
  renderDirectoryAction: (path: string) => ReactNode;
}) {
  function renderNodes(items: ChangeTreeNode[], depth: number): ReactNode {
    return items.map(node => node.kind === 'file'
      ? <li key={`file:${node.path}`}>{renderFile(node.file, depth)}</li>
      : <li key={`directory:${node.path}`} style={{ '--file-depth': depth } as CSSProperties}>
        <Collapsible defaultOpen className="change-directory">
          <div className="change-directory-heading"><CollapsibleTrigger className="change-directory-row" title={`${node.path} · ${node.fileCount} 个变更文件`} aria-label={`文件夹 ${node.path}`}>
            <i className="codicon codicon-chevron-down directory-chevron" aria-hidden="true" />
            <i className="codicon codicon-folder directory-icon-closed" aria-hidden="true" />
            <i className="codicon codicon-folder-opened directory-icon-open" aria-hidden="true" />
            <span>{node.name}</span><small>{node.fileCount}</small>
          </CollapsibleTrigger>{renderDirectoryAction(node.path)}</div>
          <CollapsibleContent><ul className="change-tree-children">{renderNodes(node.children, depth + 1)}</ul></CollapsibleContent>
        </Collapsible>
      </li>);
  }
  return <ul className="change-tree">{renderNodes(nodes, 0)}</ul>;
}
