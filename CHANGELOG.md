# 更新日志

版本号采用 `主版本.次版本.修订版本`，Git 标签使用 `v` 前缀。`0.1.x` 为预发布版本，`1.0.0` 为首个正式版本。

## [Unreleased]

## [1.0.0] - 2026-10-21

- 合并提交标题和详细说明为一个多行输入框，保留完整草稿与换行，提交时按首行和后续正文生成 Git 提交信息。
- 新增当前工作区的原生文件监听，支持 linked worktree 公共 Git 元数据；采用 1 秒防抖、前台空闲门控及自动刷新完成后 5 秒冷却，无固定状态轮询。
- 后台变化合并到返回前台后处理，静默更新保留当前 Diff、阅读位置和提交草稿；读取失败保留上次结果并提示。
- 忽略无关文件及 Git 锁/对象噪声，状态读取禁用可选索引写入，避免刷新触发自身监听。

此版本发布为正式版本，仅提供 Apple Silicon（arm64）macOS 安装包。安装包继续使用 ad-hoc 签名，尚未进行 Developer ID 签名及 Apple 公证；正式版本标记不改变签名状态。首次打开提示的处理方式见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/installation.md)。

升级前请保存提交草稿，再用 `⌘Q` 完全退出旧版。安装包：`GitWorkbench_1.0.0_macos_arm64.dmg`；请使用同一 Release 的 `SHA256SUMS.txt` 校验后安装。

## [0.1.2] - 2026-10-21

- 优化文件树引导线：默认隐藏层级竖线，选中文件时仅显示最近父级的引导线，鼠标进入文件树区域时显示全部层级关系。
- 切换文件、暂存分组或折叠目录时同步更新引导线，避免其他分组或祖先目录残留高亮。
- 更新应用图标为石墨底色与蓝色立体 Git 分支标识，同步桌面图标及网页 favicon。
- 调整图标源图为背景铺满的不透明画布，移除预置留白与外框。

此版本仅提供 Apple Silicon（arm64）macOS 安装包，继续使用 ad-hoc 签名，尚未进行 Developer ID 签名及 Apple 公证。首次打开提示的处理方式见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/installation.md)。

升级前请保存提交草稿，再用 `⌘Q` 完全退出旧版。安装包：`GitWorkbench_0.1.2_macos_arm64.dmg`；请使用同一 Release 的 `SHA256SUMS.txt` 校验后安装。

## [0.1.1] - 2026-10-20

- 对齐 Atom One Dark 上游的控件、列表、徽标与 Diff 配色，统一系统界面字体和文件树行高。
- 保存已打开的本地仓库及当前 worktree，重启后恢复并读取最新 Git 状态；单个路径失效不影响其他仓库恢复。
- macOS 关闭主窗口时隐藏并保留工作区、Diff 和提交草稿，点击 Dock 图标恢复窗口，`⌘Q` 正常退出。
- 修复 macOS 从 Finder/Dock 启动后 hooks 找不到 Node、npm、npx 的问题；缓存登录 Shell PATH，并保留提交检查及失败后的暂存内容。

此版本仅提供 Apple Silicon（arm64）macOS 安装包，继续使用 ad-hoc 签名，尚未进行 Developer ID 签名及 Apple 公证。首次打开提示的处理方式见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/installation.md)。

升级前请保存提交草稿，再用 `⌘Q` 完全退出旧版。安装包：`GitWorkbench_0.1.1_macos_arm64.dmg`；请使用同一 Release 的 `SHA256SUMS.txt` 校验后安装。

## [0.1.0] - 2026-10-16

- 首次开源，提供 Apple Silicon（arm64）macOS DMG。
- 打开本地 Git 仓库，发现并切换关联 worktree。
- 搜索本地及已获取的远程分支，按最新提交排序并显示提交摘要。
- 以目录树或列表查看已暂存、未暂存文件，支持并排及内联 Diff。
- 按文件、目录或整组批量暂存与取消暂存；提交暂存区内容。
- Atom One Dark 配色、代码字号与分栏布局偏好；设置中显示应用版本。
- 提供中文安装说明、操作手册及版本发布流程。

首版范围：仅提供 arm64 安装包；使用系统 Git；真实仓库的历史视图、Fetch、Pull、Push、按块暂存和冲突编辑尚未提供。仓库内容发生外部变化后请手动刷新。

签名说明：此包使用 ad-hoc 签名，尚未进行 Developer ID 签名及 Apple 公证。首次打开可能需要在「系统设置 → 隐私与安全性」中确认，详见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/installation.md)。

安装包：`GitWorkbench_0.1.0_macos_arm64.dmg`。请与同一 Release 的 `SHA256SUMS.txt` 校验后安装。
