import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const cargoVersion = /(\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m;
const lockVersion = /(\[\[package\]\]\nname = "git-workbench"\nversion = ")([^"]+)(")/;

function readVersions(directory) {
  const read = path => readFileSync(resolve(directory, path), 'utf8');
  const packageText = read('package.json');
  const manifest = read('src-tauri/Cargo.toml');
  const lock = read('src-tauri/Cargo.lock');
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  const pkg = JSON.parse(packageText);
  if (!versionPattern.test(pkg.version)) throw new Error('版本号必须采用 x.y.z 格式');
  if (config.version !== '../package.json') throw new Error('Tauri version 必须引用 ../package.json');
  if (manifest.match(cargoVersion)?.[2] !== pkg.version || lock.match(lockVersion)?.[2] !== pkg.version) {
    throw new Error('package.json、Cargo.toml 和 Cargo.lock 版本不一致');
  }
  return { pkg, manifest, lock };
}

/** 只提取当前版本的日志，避免将历史版本或未发布内容上传到 Release。 */
export function releaseNotes(directory = root) {
  const { version } = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  const changelog = readFileSync(resolve(directory, 'CHANGELOG.md'), 'utf8');
  const sections = changelog.split(/^## /m).slice(1);
  const section = sections.find(value => value.startsWith(`[${version}]\n`) || value.startsWith(`[${version}] - `));
  const [, ...body] = section?.split('\n') ?? [];
  const notes = body.join('\n').trim();
  if (!notes) throw new Error(`请在 CHANGELOG.md 补全 [${version}] 更新日志`);
  return `${notes}\n`;
}

/** 发布前校验单一版本来源、Rust 锁文件、更新日志及可选 Git 标签。 */
export function checkRelease(directory = root, tag) {
  const { pkg } = readVersions(directory);
  if (tag !== undefined && tag !== `v${pkg.version}`) throw new Error(`发布标签必须为 v${pkg.version}，收到 ${tag}`);
  releaseNotes(directory);
  return pkg.version;
}

/** 同步应用和 Rust 包版本；依赖版本不变，更新日志由维护者填写。 */
export function setVersion(directory = root, next) {
  if (!versionPattern.test(next ?? '')) throw new Error('版本号必须采用 x.y.z 格式，不带 v 或预发布后缀');
  const { pkg, manifest, lock } = readVersions(directory);
  const previousParts = pkg.version.split('.').map(Number);
  const nextParts = next.split('.').map(Number);
  const firstChange = nextParts.findIndex((part, index) => part !== previousParts[index]);
  if (firstChange >= 0 && nextParts[firstChange] < previousParts[firstChange]) throw new Error('版本号不能回退');
  pkg.version = next;
  writeFileSync(resolve(directory, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(resolve(directory, 'src-tauri/Cargo.toml'), manifest.replace(cargoVersion, (_match, before, ...groups) => `${before}${next}${groups[1]}`));
  writeFileSync(resolve(directory, 'src-tauri/Cargo.lock'), lock.replace(lockVersion, (_match, before, ...groups) => `${before}${next}${groups[1]}`));
  return next;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'version' && args.length === 1) {
      console.log(`版本已同步为 ${setVersion(root, args[0])}，请补全 CHANGELOG.md 后运行 pnpm release:check。`);
    } else if (command === 'check' && (args.length === 0 || (args[0] === '--tag' && args.length === 2))) {
      console.log(`发布检查通过：${checkRelease(root, args[1])}`);
    } else if (command === 'notes' && args.length === 0) {
      process.stdout.write(releaseNotes(root));
    } else {
      throw new Error('用法：release.mjs version <x.y.z> | check [--tag vX.Y.Z] | notes');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
