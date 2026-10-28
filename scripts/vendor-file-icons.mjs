import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.argv[2];
if (!source) throw new Error('请传入解压后的官方 vscode-icons 13.0.0 扩展目录。');
const pkg = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8'));
if (pkg.name !== 'vscode-icons' || pkg.publisher !== 'vscode-icons-team' || pkg.version !== '13.0.0') {
  throw new Error('仅导入已核对的官方 vscode-icons 13.0.0 资源。');
}
const manifestPath = resolve(source, 'dist/src/vsicons-icon-theme.json');
const manifestText = readFileSync(manifestPath, 'utf8');
const theme = JSON.parse(manifestText);

/** 仅打包工作台常见文件与目录；映射沿用上游，避免复制整个编辑器扩展。 */
const fileTypes = `typescript typescriptdef reactts js reactjs vue html css scss less sass json json5 yaml toml markdown text
git npm pnpm yarn tsconfig jsconfig vite vitest jest eslint prettier docker cargo rust python java c cpp csharp go go_package
ruby php kotlin swift shell sql xml svg image pdf zip font video audio wasm binary license dotenv config editorconfig bun
webpack rollup babel svelte astro tailwind gradle maven cmake powershell bat graphql`.split(/\s+/);
const folderTypes = `src component style test docs public asset images config git github vscode node dist script library typings tools api hook view`.split(/\s+/);
const selected = new Set(['_file', '_folder', '_folder_open', ...fileTypes.map(type => `_f_${type}`),
  ...folderTypes.flatMap(type => [`_fd_${type}`, `_fd_${type}_open`])]);
const icons = Object.fromEntries([...selected].map(id => {
  const definition = theme.iconDefinitions[id];
  if (!definition) throw new Error(`上游图标不存在：${id}`);
  return [id, basename(definition.iconPath)];
}));

function associations(values) {
  return Object.fromEntries(Object.entries(values).filter(([, id]) => selected.has(id))
    .map(([name, id]) => [name.toLowerCase(), icons[id]]).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

/** VS Code 自身负责语言识别；独立应用补足这些没有出现在主题扩展名表中的关联。 */
const languageExtensions = {
  typescript: ['ts', 'mts', 'cts'], typescriptreact: ['tsx'], javascript: ['js', 'mjs', 'cjs'], javascriptreact: ['jsx'],
  vue: ['vue'], html: ['html', 'htm'], css: ['css'], scss: ['scss'], less: ['less'], sass: ['sass'],
  json: ['json', 'jsonc'], json5: ['json5'], yaml: ['yaml', 'yml'], toml: ['toml'], markdown: ['md', 'markdown', 'mdx'],
  plaintext: ['txt'], rust: ['rs'], python: ['py', 'pyw', 'pyi'], java: ['java'], c: ['c', 'h'], cpp: ['cpp', 'cc', 'cxx', 'hpp', 'hxx'],
  csharp: ['cs'], go: ['go'], ruby: ['rb'], php: ['php'], kotlin: ['kt', 'kts'], swift: ['swift'], shellscript: ['sh', 'bash', 'zsh', 'fish'],
  sql: ['sql'], xml: ['xml', 'xsd', 'xsl'], dockerfile: ['dockerfile'], powershell: ['ps1'], bat: ['bat', 'cmd'],
  svelte: ['svelte'], astro: ['astro'], graphql: ['graphql', 'gql'],
};
const languages = associations(theme.languageIds);
const extensions = associations(theme.fileExtensions);
for (const [language, suffixes] of Object.entries(languageExtensions)) {
  if (!languages[language]) throw new Error(`缺少语言图标：${language}`);
  for (const suffix of suffixes) extensions[suffix] ??= languages[language];
}
const names = associations(theme.fileNames);
Object.assign(names, { dockerfile: icons._f_docker, containerfile: icons._f_docker, makefile: icons._f_config,
  '.env': icons._f_dotenv, 'readme': icons._f_markdown });
const data = {
  source: { repository: 'https://github.com/vscode-icons/vscode-icons', version: pkg.version,
    manifestSha256: createHash('sha256').update(manifestText).digest('hex') },
  defaults: { file: icons._file, folder: icons._folder, folderExpanded: icons._folder_open },
  names, extensions, languages, folders: associations(theme.folderNames), foldersExpanded: associations(theme.folderNamesExpanded),
};
const destination = resolve(root, 'public/file-icons');
mkdirSync(destination, { recursive: true });
for (const [id, name] of Object.entries(icons)) {
  copyFileSync(resolve(source, 'dist/src', theme.iconDefinitions[id].iconPath), resolve(destination, name));
}
writeFileSync(resolve(root, 'src/lib/file-icons-data.json'), `${JSON.stringify(data, null, 2)}\n`);
copyFileSync(resolve(source, 'LICENSE.txt'), resolve(root, 'docs/licenses/vscode-icons-code.txt'));
console.log(`已导入 vscode-icons ${pkg.version}：${selected.size} 个原始 SVG。`);
