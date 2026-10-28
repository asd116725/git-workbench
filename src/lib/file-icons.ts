import data from './file-icons-data.json';

const names = new Map(Object.entries(data.names));
const extensions = new Map(Object.entries(data.extensions));
const languages = new Map(Object.entries(data.languages));
const folders = new Map(Object.entries(data.folders));
const expandedFolders = new Map(Object.entries(data.foldersExpanded));

function nameOf(path: string) { return path.split('/').pop()!.toLowerCase(); }
function iconUrl(name: string) { return `${import.meta.env.BASE_URL}file-icons/${name}`; }

/** 特殊文件名优先于最长复合后缀，再使用语言或通用图标；不读取文件内容。 */
export function fileIconUrl(path: string, language?: string): string {
  const name = nameOf(path);
  const exact = names.get(name);
  if (exact) return iconUrl(exact);
  if (name.startsWith('.env.')) return iconUrl(names.get('.env')!);
  if (name.startsWith('dockerfile.') || name.startsWith('containerfile.')) return iconUrl(names.get('dockerfile')!);
  if (/^(tsconfig|jsconfig)\..+\.json$/.test(name)) return iconUrl(names.get(`${name.split('.')[0]}.json`)!);
  for (let dot = name.indexOf('.'); dot !== -1; dot = name.indexOf('.', dot + 1)) {
    const icon = extensions.get(name.slice(dot + 1));
    if (icon) return iconUrl(icon);
  }
  return iconUrl((language && language !== 'plaintext' && languages.get(language)) || data.defaults.file);
}

/** 同一目录的展开与收起图标成对匹配，未知目录使用默认文件夹。 */
export function folderIconUrl(path: string, expanded: boolean): string {
  const icons = expanded ? expandedFolders : folders;
  return iconUrl(icons.get(nameOf(path)) ?? (expanded ? data.defaults.folderExpanded : data.defaults.folder));
}
