import { describe, expect, it } from 'vitest';
import { fileIconUrl, folderIconUrl } from './file-icons';

describe('文件图标匹配', () => {
  it.each([
    ['src/index.ts', 'typescript'], ['src/types.d.ts', 'typescriptdef'], ['src/App.tsx', 'reactts'],
    ['src/App.jsx', 'reactjs'], ['src/View.vue', 'vue'], ['src/main.js', 'js'], ['styles/theme.scss', 'scss'],
    ['README.md', 'markdown'], ['package.json', 'npm'], ['config/tsconfig.json', 'tsconfig'],
    ['tsconfig.custom.json', 'tsconfig'], ['types/jsconfig.app.json', 'jsconfig'], ['vite.config.ts', 'vite'],
    ['pnpm-lock.yaml', 'pnpm'], ['.gitignore', 'git'], ['.env.production', 'dotenv'], ['Dockerfile.dev', 'docker'],
    ['Cargo.toml', 'cargo'], ['src/main.rs', 'rust'], ['pom.xml', 'maven'], ['src/App.java', 'java'],
    ['main.py', 'python'], ['logo.svg', 'svg'], ['logo.PNG', 'image'], ['data.json', 'json'], ['config.yaml', 'yaml'],
    ['data.zip', 'zip'], ['LICENSE', 'license'],
  ])('%s 使用 %s 图标', (path, icon) => {
    expect(fileIconUrl(path)).toBe(`/file-icons/file_type_${icon}.svg`);
  });

  it('真实扩展名优先于 Diff 语言，特殊文件名优先于通用扩展名', () => {
    expect(fileIconUrl('App.tsx', 'typescript')).toContain('file_type_reactts.svg');
    expect(fileIconUrl('View.vue', 'html')).toContain('file_type_vue.svg');
    expect(fileIconUrl('PACKAGE.JSON', 'json')).toContain('file_type_npm.svg');
    expect(fileIconUrl('src/version.custom', 'rust')).toContain('file_type_rust.svg');
  });

  it('未知文件回退通用图标，不把路径或对象属性当成资源地址', () => {
    for (const path of ['.hidden', 'unknown.custom', 'constructor', '__proto__', 'README-without-extension']) {
      expect(fileIconUrl(path)).toBe('/file-icons/default_file.svg');
    }
    expect(fileIconUrl('src/with spaces/组件.TSX')).toContain('file_type_reactts.svg');
    expect(fileIconUrl('notes.custom', 'plaintext')).toBe('/file-icons/default_file.svg');
  });
});

describe('目录图标', () => {
  it('按目录名匹配，并在展开时使用对应的打开图标', () => {
    expect(folderIconUrl('src/components', false)).toContain('folder_type_component.svg');
    expect(folderIconUrl('src/components', true)).toContain('folder_type_component_opened.svg');
    expect(folderIconUrl('__tests__', true)).toContain('folder_type_test_opened.svg');
    expect(folderIconUrl('unknown', false)).toContain('default_folder.svg');
    expect(folderIconUrl('unknown', true)).toContain('default_folder_opened.svg');
  });
});
