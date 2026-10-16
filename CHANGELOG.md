# 更新日志

版本号采用 `主版本.次版本.修订版本`，Git 标签使用 `v` 前缀。首版为预发布版本。

## [Unreleased]

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
