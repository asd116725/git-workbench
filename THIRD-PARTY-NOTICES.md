# 第三方许可说明

Git Workbench 自有代码采用 MIT 许可证。以下素材、字体和软件继续保留原作者版权及各自许可证；本项目不主张对它们重新授权。

| 内容 | 来源与作者 | 许可证与本地副本 | 使用及修改说明 |
| --- | --- | --- | --- |
| Codicons 界面图标及应用图标参考 | [Microsoft vscode-codicons](https://github.com/microsoft/vscode-codicons) | CC BY 4.0，[全文](docs/licenses/codicons.txt) | 界面使用 Codicons 字体；应用图标以 `git-branch.svg` 为参考，通过图像生成重新设计配色、立体质感和背景，并导出各尺寸，保留来源与许可声明 |
| 文件与目录图标 | [vscode-icons Contributors / vscode-icons 13.0.0](https://github.com/vscode-icons/vscode-icons) | 图标采用 CC BY-SA 4.0，[全文](docs/licenses/vscode-icons-artwork.txt)；代码与关联数据采用 MIT，[原始声明](docs/licenses/vscode-icons-code.txt)；品牌图标继续受各自权利人的许可约束 | 从官方扩展包选择 116 个 SVG，未修改图形、配色或 SVG 内容；文件名、扩展名及目录关联取自上游，并补充独立应用的语言匹配，详见[资源说明](docs/file-icons.md) |
| Geist 字体 | [The Geist Project Authors](https://github.com/vercel/geist-font) / Fontsource | SIL OFL 1.1，[全文](docs/licenses/geist.txt) | 本地打包 Geist Variable 字体，未修改字体文件 |
| Atom One Dark Theme | [Mahmoud Ali](https://github.com/akamud/vscode-theme-onedark) | MIT，[全文](docs/licenses/atom-one-dark.txt) | 使用 2.3.0 色板及 TextMate 主题，通过 Shiki 适配 Monaco |
| Monaco、Shiki、React 等前端依赖 | 各包的原作者 | [依赖许可汇编](docs/licenses/dependencies.txt) | 随前端资源打包；语言定义和主题按相应包许可使用 |
| Tauri、Rust crates 及打包工具依赖 | 各项目的原作者 | [依赖许可汇编](docs/licenses/dependencies.txt) | 汇编包含 arm64 Rust 依赖图及部分仅用于构建/测试的依赖 |

依赖汇编由 `pnpm release:licenses` 根据当前锁文件和已安装软件包生成，包含公开包名、版本、许可和原始声明。升级依赖后应重新生成并检查；源码仓库中的锁文件记录精确版本。

macOS 安装包在 `代码管理.app/Contents/Resources/licenses/` 中附带项目 MIT、本文及第三方许可全文。系统 Git 不随应用分发，应用调用用户已安装的 Git。

主题配色核对基准为 Atom One Dark 2.3.0 的 [OneDark.json（a8be970）](https://github.com/akamud/vscode-theme-onedark/blob/a8be970644982221f9b61fb1c4b3da74b4beab79/themes/OneDark.json)。本地 `src/themes/atom-one-dark.json` 保留原始主题；应用界面的背景、控件、列表、徽标及滚动条按原主题的对应颜色使用，Monaco 颜色覆盖仅适配键名与应用分栏边界。

Codicons 采用知识共享署名许可。来源、修改内容及完整许可如上；项目与 Microsoft、字体/主题原作者不存在背书关系。
