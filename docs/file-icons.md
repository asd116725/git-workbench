# 文件与目录图标

文件列表、目录树、提交历史及 Diff 标签页共用 vscode-icons 图标。资源来自官方 `vscode-icons-team.vscode-icons` 扩展包 **13.0.0**，上游仓库为 <https://github.com/vscode-icons/vscode-icons>，作者为 vscode-icons Contributors。这里只打包常见代码、配置、文档、媒体文件和目录所需的 116 个原始 SVG，合计约 265 KiB；运行时不连接网络，也不需要本机安装 VS Code。

匹配优先级为特殊文件名、最长复合后缀、语言、通用文件图标。例如 `package.json` 使用 npm 图标，`types.d.ts` 使用类型声明图标，`.tsx` 使用 React TypeScript 图标。文件名与后缀匹配不区分大小写；`.env.*`、`Dockerfile.*`、`tsconfig.*.json` 等配置变体有专门关联。常见目录使用对应图标，展开与收起分别显示；未收录的文件或目录使用通用图标。

图标按原始内容复制，未修改 SVG；继续遵循 **CC BY-SA 4.0**，品牌图标保留各自权利人的权利与许可。上游代码及关联数据的 MIT 声明和图标许可全文随应用打包，见[第三方许可说明](../THIRD-PARTY-NOTICES.md)。本项目与 vscode-icons 及品牌权利人不存在背书关系。

维护者可从解压的官方扩展包重新生成资源：

```sh
node scripts/vendor-file-icons.mjs /path/to/unpacked/vscode-icons-extension
```

脚本不执行扩展代码，只读取主题 JSON、复制选定 SVG 和原始 MIT 声明。输出位于 `public/file-icons/` 与 `src/lib/file-icons-data.json`，后者记录上游主题清单的 SHA-256。更新版本时需要同步核对许可、图标选择及匹配测试；普通构建直接使用已纳入源码的资源，无需执行此脚本。
