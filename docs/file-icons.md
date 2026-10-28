# File and folder icons

**English** | [简体中文](zh-CN/file-icons.md)

The file list, folder tree, commit history, and diff tabs share vscode-icons assets. They come from version **13.0.0** of the official `vscode-icons-team.vscode-icons` extension, maintained by vscode-icons Contributors at <https://github.com/vscode-icons/vscode-icons>. The app bundles 116 original SVG files for common source, configuration, document, media, and folder types, totaling approximately 265 KiB. No network connection or local VS Code installation is required at runtime.

Matching takes precedence in this order: special filenames, the longest compound extension, language, then the generic file icon. For example, `package.json` uses the npm icon, `types.d.ts` uses the type declaration icon, and `.tsx` uses the React TypeScript icon. Filename and extension matching is case-insensitive, with dedicated associations for variants such as `.env.*`, `Dockerfile.*`, and `tsconfig.*.json`. Common folders have matching expanded and collapsed icons; unrecognized files and folders use generic icons.

The SVG assets are copied without modification and remain under **CC BY-SA 4.0**. Brand icons retain the rights and license conditions of their respective owners. The app bundles the upstream MIT notice for code and association data, along with the full artwork license; see [third-party notices](../THIRD-PARTY-NOTICES.md). This project is not endorsed by vscode-icons or the brand owners.

Maintainers can regenerate the assets from an unpacked official extension:

```sh
node scripts/vendor-file-icons.mjs /path/to/unpacked/vscode-icons-extension
```

The script does not execute extension code. It reads the theme JSON and copies selected SVG files and the original MIT notice. Output is written to `public/file-icons/` and `src/lib/file-icons-data.json`; the latter records the SHA-256 of the upstream theme manifest. When upgrading, review the licenses, icon selection, and matching tests together. Normal builds use the checked-in assets and do not need to run this script.
