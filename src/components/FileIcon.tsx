import { fileIconUrl, folderIconUrl } from '../lib/file-icons';
import './file-icon.css';

/** 文件名已由所在行朗读，图标只作装饰，避免屏幕阅读器重复报读。 */
export function FileIcon({ path, language, className = '' }: { path: string; language?: string; className?: string }) {
  return <img className={`file-type-icon ${className}`} src={fileIconUrl(path, language)} width={16} height={16} alt="" aria-hidden="true" draggable={false} />;
}

/** 由目录树现有折叠状态切换图标，保持目录导航与图标展示一致。 */
export function FolderIcon({ path, expanded, className = '' }: { path: string; expanded: boolean; className?: string }) {
  return <img className={`file-type-icon ${className}`} src={folderIconUrl(path, expanded)} width={16} height={16} alt="" aria-hidden="true" draggable={false} />;
}
