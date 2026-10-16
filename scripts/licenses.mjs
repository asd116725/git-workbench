import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = JSON.parse(execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { cwd: root, maxBuffer: 8 * 1024 * 1024 }));
const cargo = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', 'aarch64-apple-darwin', '--manifest-path', 'src-tauri/Cargo.toml'], { cwd: root, maxBuffer: 16 * 1024 * 1024 }));
const sections = ['Git Workbench 第三方依赖许可\n\n由 pnpm release:licenses 生成。包含前端生产依赖及 arm64 Rust 依赖图（含构建和测试工具）的原始许可文本。各依赖继续遵循下述许可，不因本项目采用 MIT 而变更。\n'];

/** 只记录原始许可和公开包信息，不将本机安装路径写入公开文件。 */
function appendLicense(name, version, license, directory, homepage) {
  const files = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^(licen[cs]es?|copying|notices?|third[-_ ]?party[-_ ]?(?:licen[cs]es?|notices?))([._-]|$)/i.test(entry.name))
    .map(entry => entry.name).sort();
  const texts = files.map(file => `--- ${file} ---\n${readFileSync(resolve(directory, file), 'utf8').trim()}`);
  const supplementalName = name.startsWith('micromark-util-') ? 'micromark-MIT' : name.replace('Rust: ', 'rust-');
  const supplemental = resolve(root, 'docs/licenses/supplemental', `${supplementalName}.txt`);
  if (texts.length === 0 && existsSync(supplemental)) texts.push(readFileSync(supplemental, 'utf8').trim());
  // 少量 npm 发布包省略许可文件，但在 README 中保留了许可与作者声明。
  if (texts.length === 0) {
    const readme = readdirSync(directory).find(file => /^readme\.md$/i.test(file));
    if (readme) {
      const text = readFileSync(resolve(directory, readme), 'utf8');
      const position = text.search(/^#+ License\s*$/im);
      if (position >= 0) texts.push(`--- README 许可声明 ---\n${text.slice(position).trim()}`);
    }
  }
  if (texts.length === 0) throw new Error(`缺少 ${name}@${version} 的许可文本，请补全后再发布`);
  sections.push(`\n${'='.repeat(72)}\n${name}@${version}\nLicense: ${license}\n${homepage || ''}\n\n${texts.join('\n\n')}\n`);
}

const packages = Object.values(npm).flat().sort((a, b) => a.name.localeCompare(b.name));
for (const pkg of packages) {
  for (const path of pkg.paths) {
    const data = JSON.parse(readFileSync(resolve(path, 'package.json'), 'utf8'));
    // 原生编译器绑定只供构建使用，许可随同主包发布。
    const directory = pkg.name.startsWith('@rolldown/binding-')
      ? packages.find(item => item.name === 'rolldown').paths[0] : path;
    appendLicense(data.name, data.version, pkg.license, directory, `https://www.npmjs.com/package/${data.name}/v/${data.version}`);
  }
}
const resolved = new Set(cargo.resolve.nodes.map(node => node.id));
for (const pkg of cargo.packages.filter(pkg => pkg.source && resolved.has(pkg.id)).sort((a, b) => a.name.localeCompare(b.name))) {
  appendLicense(`Rust: ${pkg.name}`, pkg.version, pkg.license, dirname(pkg.manifest_path), `https://crates.io/crates/${pkg.name}/${pkg.version}`);
}
writeFileSync(resolve(root, 'docs/licenses/dependencies.txt'), `${sections.join('')}\n`.replace(/\r\n/g, '\n'));
console.log('已更新 docs/licenses/dependencies.txt；发布前请检查许可和作者声明。');
