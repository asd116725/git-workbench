# Git Workbench · 代码管理

[English](README.md) | **简体中文**

一个面向本地仓库的 Git 桌面工具。使用 Tauri 2、React 和 TypeScript 构建，将 worktree、分支、文件变更与 Diff 放在同一个窗口中。

[下载 v1.6.0 安装包](https://github.com/asd116725/git-workbench/releases/tag/v1.6.0) · [中文操作手册](docs/zh-CN/user-manual.md) · [安装说明](docs/zh-CN/installation.md) · [更新日志](CHANGELOG.zh-CN.md)

当前正式版本为 **1.6.0**，提供 `GitWorkbench_1.6.0_macos_arm64.dmg` 和同一 Release 的 `SHA256SUMS.txt`，请校验后安装。

![Git Workbench 本地变更界面，使用虚构示例数据](docs/screenshots/workbench.png)

## 可以做什么

- 打开已有的本地 Git 仓库，自动列出关联 worktree，并在工作区之间切换。
- 搜索本地和已获取的远程分支，按最近提交排序，查看作者、短哈希和提交摘要。
- 获取远程更新、快进拉取和推送当前分支，推送图标旁显示待上传提交数，首次推送可建立上游跟踪。
- 1.2.0 支持创建与删除本地分支，可选创建后切换；删除前核对未合入提交和 Worktree 占用，详见[分支管理](docs/zh-CN/user-manual.md#42-创建与删除本地分支)。
- 用目录树或列表查看文件变更，阅读只读的并排或内联 Diff。
- 文件与目录使用 vscode-icons 图标，列表、历史和 Diff 标签页按文件名与类型一致匹配，离线可用。
- 将单个文件、整个目录或整组变更加入暂存区，或取消暂存。
- 在同一个多行输入框填写提交信息，首行作为标题、后续内容作为说明；提交暂存区内容，保留未暂存修改。
- 监听当前工作区变化，自动更新文件列表和 Diff，保留阅读位置与本次会话的提交草稿。
- 以提交列表、变更文件树、Diff 三栏浏览真实历史，筛选分支、搜索完整历史，并切换合并提交的比较父提交。
- 调整分栏宽度、代码字号和 Diff 模式；使用 Atom One Dark 配色。
- 支持中文简体、中文繁體和 English 界面语言，在设置中即时切换并保存选择（1.4.0）。
- 在各本地分支旁显示相对自身上游的待拉取（`↓`）和待推送（`↑`）提交数（1.4.0）；基于本地最近获取的引用，打开列表不自动获取远程。
- 侧栏显示各工作区自身分支的待拉取、待推送数量，悬停查看完整同步说明，并适配窄侧栏（1.5.0）。
- 提交历史使用绿色上箭头及「待推送」标签标出尚未包含在所选分支上游中的记录，搜索和分页保持对应（1.6.0）。

截图中的仓库、路径、作者和提交记录均为虚构演示数据。

`v1.1.0` 新增了**合并分支、冲突后的完成合并和中止合并，以及只读提交历史**。操作步骤见[合并分支](docs/zh-CN/user-manual.md#41-合并分支)和[提交历史](docs/zh-CN/user-manual.md#81-提交历史)。

![提交列表、变更文件树与历史 Diff，使用虚构示例数据](docs/screenshots/history.png)

## 安装与快速上手

当前版本提供 **macOS Apple Silicon（arm64）** 安装包。Intel Mac、Windows、Linux 暂无官方构建。

1. 从 [v1.6.0 Release](https://github.com/asd116725/git-workbench/releases/tag/v1.6.0) 下载 [DMG](https://github.com/asd116725/git-workbench/releases/download/v1.6.0/GitWorkbench_1.6.0_macos_arm64.dmg) 和 `SHA256SUMS.txt`。
2. 按[安装说明](docs/zh-CN/installation.md)校验文件，将「代码管理」拖入 Applications 后打开。
3. 点击「打开本地仓库」，选择已有仓库的目录。应用使用本机 Git，请先确认 `git --version` 可以运行。
4. 选择文件阅读 Diff，在行末点击 `+` 暂存；在提交框中填写信息，点击提交按钮。

v1.6.0 为正式版本，安装包仍采用 **ad-hoc 签名，未进行 Developer ID 签名及 Apple 公证**。正式版本标记不代表已经获得 Apple 身份签名或公证。macOS 可能要求确认来源；处理方式见[首次打开](docs/zh-CN/installation.md#首次打开)。

## 支持范围与限制

| 功能 | 桌面应用 | 浏览器演示 |
| --- | --- | --- |
| 本地仓库、worktree、分支切换 | 支持 | 虚构数据 |
| 创建与删除本地分支（1.2.0） | 支持真实 Git | 仅内存演示 |
| 文件 Diff、文件/目录/整组暂存和提交 | 支持真实 Git | 仅内存演示 |
| 提交历史、分支历史筛选及历史 Diff | 支持真实 Git | 虚构数据 |
| 合并分支、完成及中止合并 | 支持真实 Git | 暂未提供 |
| 按变更块暂存 | 暂未提供 | 仅演示 |
| Fetch、Pull、Push（1.3.0） | 支持真实 Git | 暂未提供 |
| 冲突编辑 | 暂未提供 | 暂未提供 |

- 当前工作区通过文件监听自动刷新：最后一次变化后等待 1 秒，前台空闲时读取；每次自动刷新结束后至少间隔 5 秒。后台变化回到前台后合并处理，没有变化时不刷新。仍可点击「刷新」立即读取。
- 已打开的本地仓库与上次选中的工作区会自动保存，重启后恢复并读取最新 Git 状态；不可用路径会提示错误，其余仓库继续恢复。提交草稿仅保留在当前会话中；字号和布局偏好会保存。
- 二进制文件、非 UTF-8 文本、超过 2 MiB 的文件、子模块或未解决冲突可能只显示说明，不能作为普通文本 Diff 展示。
- 分支列表仅包含本地已有引用；点击「获取」更新远程分支。远程操作及首次推送说明见[操作手册](docs/zh-CN/user-manual.md#43-获取拉取与推送)。
- 历史视图只读取 Git 提交对象，不修改工作区；分支筛选不执行切换。每页 50 条，搜索覆盖所选分支的完整可达历史。检测到新提交时提示手动刷新，保留正在阅读的 Diff。
- 构建配置最低系统为 macOS 12，当前版本仅在维护者当前的 arm64 macOS 环境验收，旧系统兼容性仍需反馈。
- 更新方式为手动下载 GitHub Release，应用不包含自动更新服务。

## 源码启动

需要 Node.js **22.14+**（同一主版本）、pnpm **11.17.0**、Rust **1.99.0**（仓库工具链文件自动选择）及系统 Git。macOS 桌面构建还需要 Xcode Command Line Tools：`xcode-select --install`。

```sh
git clone https://github.com/asd116725/git-workbench.git
cd git-workbench
pnpm install --frozen-lockfile
pnpm desktop
```

只看界面可运行 `pnpm dev`，访问终端给出的本地地址。浏览器使用独立的演示数据，不会操作本机仓库。

## 检查与构建

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
pnpm release:check --tag v1.6.0
```

```sh
# 只生成 .app，保持原有构建方式
pnpm desktop:build

# 生成 arm64 DMG、SHA-256 校验文件和发布说明（需要 macOS）
pnpm desktop:package
```

`.app` 位于 `src-tauri/target/release/bundle/macos/`；标准化发布文件位于 `release-artifacts/`。版本维护及 GitHub Actions 发布步骤见[维护者发布指南](docs/zh-CN/releasing.md)。

## 文档与参与

- [操作手册](docs/zh-CN/user-manual.md)：仓库、worktree、分支、Diff、暂存、提交、合并及历史浏览。
- [安装说明与常见系统提示](docs/zh-CN/installation.md)。
- [贡献指南](CONTRIBUTING.zh-CN.md)和[问题反馈](https://github.com/asd116725/git-workbench/issues)。
- [版本更新日志](CHANGELOG.zh-CN.md)与[发布指南](docs/zh-CN/releasing.md)。

项目代码采用 [MIT](LICENSE) 许可证。Codicons、vscode-icons 图标、Geist 字体、Atom One Dark 主题及第三方软件保留各自许可证，详见 [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES.zh-CN.md)。应用包中附带许可副本。
