# macOS 安装说明

[English](../installation.md) | **简体中文**

## 下载和校验

当前正式版本 `1.6.0` 为 Apple Silicon（M 系列芯片）构建，文件名为 `GitWorkbench_1.6.0_macos_arm64.dmg`。可在「关于本机」查看芯片类型；此安装包不支持 Intel Mac。

从 [v1.6.0 Release](https://github.com/asd116725/git-workbench/releases/tag/v1.6.0) 下载 DMG 和 `SHA256SUMS.txt`，不要混用不同版本的校验文件。在安装包和对应校验文件所在目录打开终端：

```sh
shasum -a 256 -c SHA256SUMS.txt
```

输出 `GitWorkbench_1.6.0_macos_arm64.dmg: OK` 后继续。如校验失败，请重新下载同一 Release 的安装包和校验文件，不要使用损坏的文件。

## 安装

1. 双击 DMG。
2. 将「代码管理」拖入右侧的 Applications。
3. 等待复制完成，推出磁盘映像。
4. 从 Applications 打开「代码管理」。请勿一直从 DMG 内运行应用。

应用使用系统 Git。在终端运行 `git --version`；如果提示安装开发工具，按系统提示安装 Xcode Command Line Tools。源码构建需要完整的 Node.js、pnpm 和 Rust 环境，普通安装用户不需要这些工具。

## 首次打开

此安装包使用 **ad-hoc 签名**，用于本地可执行文件的完整性封装。它不包含 Apple Developer ID 身份签名，也未经过 Apple 公证，不能消除 Gatekeeper 的来源确认提示。`1.6.0` 的正式版本号不代表 Apple 签名或公证状态。

如果 macOS 提示无法验证开发者：

1. 先核对下载来源和 SHA-256。
2. 尝试打开应用一次，然后前往「系统设置 → 隐私与安全性」。
3. 在系统为该应用提供的提示处点击「仍要打开」，按系统提示确认。

不同 macOS 版本的提示文字和入口可能不同。公司管理的电脑若禁止未公证软件，需要由设备管理员允许。无需关闭系统的整体安全保护。

如果仍提示“已损坏”或无法打开，重新下载并校验，再附上 macOS 版本、芯片类型和完整提示到 [Issues](https://github.com/asd116725/git-workbench/issues)。不要提交仓库源码或敏感路径。

## 更新和卸载

升级前先保存未提交的草稿，再用 `⌘Q` 完全退出应用；关闭窗口只会隐藏，进程仍会运行。从 [Releases](https://github.com/asd116725/git-workbench/releases) 下载新版本，校验后拖入 Applications 并选择替换。当前版本没有应用内自动更新。

卸载时退出应用，将 Applications 中的「代码管理」移入废纸篓。仓库文件由用户自行管理，应用卸载不会删除仓库。字号与布局等偏好可能留在 WebView 的本地数据中。

## 兼容范围

最低系统构建配置为 macOS 12，当前版本提供 arm64 包。自动化测试覆盖真实临时 Git 仓库操作；1.6.0 的原生界面交互尚待补验。旧版 macOS 的兼容性尚未全面验证，遇到兼容性问题请反馈系统版本与复现步骤。

更多操作见[中文操作手册](user-manual.md)。签名机制可参考 [Tauri 官方 macOS 签名文档](https://v2.tauri.app/distribute/sign/macos/)。
