# 维护者发布指南

[English](../releasing.md) | **简体中文**

## 版本约定

`package.json` 是版本号来源，Tauri 的 `version` 直接引用它。Rust 包和锁文件的根包版本由脚本同步。Git 标签采用 `vX.Y.Z`，日志使用 `## [X.Y.Z] - YYYY-MM-DD`。

```sh
pnpm release:version 1.6.0
# 手动将本次变化写入 CHANGELOG.md 的 [1.6.0] 节，保留空的 [Unreleased]
pnpm release:check --tag v1.6.0
```

脚本拒绝无效格式和版本回退，保留第三方依赖版本，不创建提交或标签。预发布状态由 GitHub Release 标记控制，版本仍使用 `x.y.z`。

中英文文档应同步维护，包括 `CHANGELOG.md` 和 `CHANGELOG.zh-CN.md`。发布说明从英文 `CHANGELOG.md` 提取；两个文件均应保留既有版本标题格式。

## 本地检查及构建

应用图标原图保存在 `src-tauri/icons/app-icon-source.png`，使用不透明、背景铺满的正方形画布，不预先添加透明留白、圆角底板或外框，避免新版 macOS 自动适配时出现灰色底板。替换原图后，执行 `pnpm tauri icon src-tauri/icons/app-icon-source.png --output src-tauri/icons` 生成各平台尺寸，并将生成的 `src-tauri/icons/128x128.png` 同步为 `public/app-icon.png`。构建后须在 Finder 和 Dock 中检查系统实际显示效果，不能只检查 PNG 预览。

1. 使用干净的 `main`，确认更新日志、下载链接、手册和截图适用于本次版本。
2. 执行 README 中全部检查。版本脚本的测试覆盖不同步、标签错误、日志缺失和无效升级。
3. 新增/升级依赖时执行 `pnpm release:licenses`，提交生成的 `docs/licenses/dependencies.txt`，检查许可文本没有遗漏。
4. 在 macOS 执行 `pnpm desktop:package`，得到：

```text
release-artifacts/
  GitWorkbench_1.6.0_macos_arm64.dmg
  SHA256SUMS.txt
  release-notes.md
```

生成文件名随版本变化。该命令只构建 arm64 DMG，不执行提交、推送或上传。`pnpm desktop:build` 继续只生成默认架构的 `.app`。

5. 用 `shasum -a 256 -c SHA256SUMS.txt` 核对，挂载 DMG，检查应用与 Applications 拖入布局。
6. 将应用复制到独立临时目录，核对 `Contents/Info.plist` 版本、`file`/`lipo` 架构及 `codesign --verify --deep --strict`。
7. 启动包内应用，在临时测试仓库验证 Diff、目录暂存、取消暂存及多行提交信息。检查提交只包含暂存内容，工作区其他内容保持不变。
8. 外部修改当前工作区，验证 1 秒防抖、刷新完成后 5 秒冷却，以及后台变化返回前台后再刷新。确认同一 Diff 的滚动位置和提交草稿保留，没有变化时切换窗口不会刷新。
9. 填写提交草稿后点击 macOS 红色关闭按钮，确认进程仍运行；点击 Dock 图标，确认工作区、Diff 和草稿保留；最后用 `⌘Q` 确认进程正常退出。

## 推送与草稿 Release

首次需要通过 GitHub CLI 的官方 `gh auth login --web` 登录维护者账号。不要把令牌写进仓库或工作流。

```sh
git add <本次发布文件>
git commit -m "chore: 发布 1.6.0 正式版本"
git tag -a v1.6.0 -m "Git Workbench 1.6.0"
git push --atomic origin main v1.6.0
```

基础 CI 检查 `main`、Pull Request 和 `v*` 标签。标签任务先检查版本/标签、类型、lint、前端构建和前后端测试，再在 `macos-15` 构建 arm64 DMG；只有发布任务拥有 `contents: write`。

工作流用 GitHub 自带的短期令牌创建**草稿、预发布** Release，上传 DMG、校验文件及当前版本日志。失败时在 Actions 查看具体步骤，修复后重新运行；不要为了重试移动已公开版本标签。已发布版本不允许被工作流覆盖。

## 发布前核对

1. 确认标签工作流所有任务成功，Release 目标提交与标签一致。
2. 下载草稿附件，核对其 SHA-256，再检查 DMG 版本、架构与启动。
3. 复核更新说明、ad-hoc 签名提示、安装手册链接及附件命名。
4. `1.6.0` 在核对完成后发布为正式版本，并设为最新版本。执行：

```sh
gh release edit v1.6.0 --repo asd116725/git-workbench --draft=false --prerelease=false --latest
```

5. 从公开链接重新下载 DMG 和校验文件，检查 README 的下载链接与操作手册可访问。

正式版本与安装包签名是两回事：当前安装包只采用 ad-hoc 签名，没有 Developer ID 签名和 Apple 公证。不得将其描述为已经公证的安装包。今后若增加签名、公证或更新服务，应另行配置凭据与验证流程。

参考：[Tauri DMG](https://v2.tauri.app/distribute/dmg/)、[macOS 签名](https://v2.tauri.app/distribute/sign/macos/)、[Tauri GitHub 发布流程](https://github.com/tauri-apps/tauri-action)。
