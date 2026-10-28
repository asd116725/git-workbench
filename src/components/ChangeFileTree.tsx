import { t, useI18n } from '../lib/i18n';
import type { CSSProperties, ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ChangeTreeNode } from '../lib/change-tree';
import type { FileSnapshot } from '../lib/types';
import { FolderIcon } from './FileIcon';

/** 目录展开状态由稳定路径保留，文件选择和暂存操作复用列表视图的同一行。 */
export function ChangeFileTree({ nodes, selectedFileId, renderFile, renderDirectoryAction }: {
  nodes: ChangeTreeNode[];
  selectedFileId: string | null;
  renderFile: (file: FileSnapshot, depth: number) => ReactNode;
  renderDirectoryAction?: (path: string) => ReactNode;
}) {
  useI18n();
  function renderNodes(items: ChangeTreeNode[], depth: number): ReactNode {
    return items.map(node => {
      if (node.kind === 'file') return <li key={`file:${node.path}`}>{renderFile(node.file, depth)}</li>;
      /** 只点亮选中文件的直接父级，不沿祖先目录逐层点亮。 */
      const hasSelectedFile = node.children.some(child => child.kind === 'file' && child.file.id === selectedFileId);
      return <li key={`directory:${node.path}`} style={{ '--file-depth': depth } as CSSProperties}>
        <Collapsible defaultOpen className="change-directory">
          <div className="change-directory-heading"><CollapsibleTrigger className="change-directory-row" title={t("{value1} · {value2} 个变更文件", { value1: node.path, value2: node.fileCount })} aria-label={t("文件夹 {value1}", { value1: node.path })}>
            <i className="codicon codicon-chevron-down directory-chevron" aria-hidden="true" />
            <FolderIcon path={node.path} expanded={false} className="directory-icon-closed" />
            <FolderIcon path={node.path} expanded className="directory-icon-open" />
            <span>{node.name}</span><small>{node.fileCount}</small>
          </CollapsibleTrigger>{renderDirectoryAction?.(node.path)}</div>
          <CollapsibleContent><ul className={`change-tree-children${hasSelectedFile ? ' active-indent-guide' : ''}`}>{renderNodes(node.children, depth + 1)}</ul></CollapsibleContent>
        </Collapsible>
      </li>;
    });
  }
  return <ul className="change-tree">{renderNodes(nodes, 0)}</ul>;
}
