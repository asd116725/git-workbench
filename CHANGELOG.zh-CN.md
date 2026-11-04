# 更新日志

[English](CHANGELOG.md) | **简体中文**

版本号采用 `主版本.次版本.修订版本`，Git 标签使用 `v` 前缀。`0.1.x` 为预发布版本，`1.0.0` 为首个正式版本。

## [Unreleased]

## [1.8.2] - 2026-11-04

- AI 提交信息取材支持 Git 索引内各子目录中的标准 commitlint 配置，以及 Rush 的 `common/autoinstallers/rush-commitlint/` 目录。
- 补充读取字面量 `extends` 数组引用的本地文件与已安装配置包，让正文行长等继承约束和本地覆盖规则一同进入生成上下文；优先读取索引版本，不执行配置脚本或安装依赖。
- 保留规则大小限制，处理循环继承，排除仓库外的目录链接；补充回归测试和配置支持范围说明。

规则用于指导 AI 生成，本次未新增生成结果的确定性校验或自动换行。候选文案仍需检查，并由项目原有提交检查验证。

此版本提供 macOS Apple Silicon（arm64）安装包，采用 ad-hoc 签名，未进行 Developer ID 签名及 Apple 公证。详见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。

升级前请保存提交草稿，并用 `⌘Q` 完全退出旧版。请使用同一 Release 的 `SHA256SUMS.txt` 校验 `GitWorkbench_1.8.2_macos_arm64.dmg` 后安装。

## [1.8.1] - 2026-11-03

- AI 提交信息跟随当前界面语言生成，支持简体中文、繁体中文和英文；每次生成或重新生成都读取最新选择，切换语言不改写已有草稿或候选文案。
- 接受英文 Conventional Commit 标题；界面语言选择优先于现有 Skill 和仓库规范中的语言示例，应用候选前仍会核验暂存内容。
- 更新 AI 弹窗、README 和操作手册，说明提交文案的语言选择方式。

此版本提供 macOS Apple Silicon（arm64）安装包，采用 ad-hoc 签名，未进行 Developer ID 签名及 Apple 公证。详见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。

升级前请保存提交草稿，并用 `⌘Q` 完全退出旧版。请使用同一 Release 的 `SHA256SUMS.txt` 校验 `GitWorkbench_1.8.1_macos_arm64.dmg` 后安装。

## [1.8.0] - 2026-11-03

- 在设置中增加「浅色 / 深色 / 跟随系统」三种外观，选择后立即应用并独立保存；原有用户默认保留熟悉的深色主题。
- 浅色配色覆盖仓库分组、工作树、历史、输入框、弹窗及通知；代码区采用适配后的 One Light 语法配色，使用清晰文字与柔和的红绿 Diff 背景。
- 同步原生窗口主题与背景，在主窗口显示前恢复外观偏好；系统模式跟随系统的实际外观变化。
- 切换主题保留当前工作区、提交草稿及 Diff 模型；恢复默认布局不清除主题选择。
- 补齐简体中文、繁体中文与英文文案，更新操作说明，并在安装包中附带浅色主题来源和 MIT 许可。

此版本提供 macOS Apple Silicon（arm64）安装包，采用 ad-hoc 签名，未进行 Developer ID 签名及 Apple 公证。详见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。

升级前请保存提交草稿，并用 `⌘Q` 完全退出旧版。请使用同一 Release 的 `SHA256SUMS.txt` 校验 `GitWorkbench_1.8.0_macos_arm64.dmg` 后安装。

## [1.7.1] - 2026-11-02

- 分离仓库展开与选择：箭头只展开或收起工作树列表，仓库名称和工作树行只选择操作目标，选择时保留各项目的展开状态；箭头支持 Enter 和空格。
- 项目采用独立边框分组、文件夹图标及工作树数量；主工作区与关联工作树通过图标和「关联」标签区分，当前工作树以蓝色选中态和「当前」标记展示，收起项目后保留当前项目提示。
- 侧栏支持在 240–360 px 范围内调整宽度，窄布局保留同步数量；补齐简体中文、繁体中文和英文文案，更新侧栏使用说明。

此版本提供 macOS Apple Silicon（arm64）安装包，采用 ad-hoc 签名，未进行 Developer ID 签名及 Apple 公证。详见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。

升级前请保存提交草稿，并用 `⌘Q` 完全退出旧版。请使用同一 Release 的 `SHA256SUMS.txt` 校验 `GitWorkbench_1.7.1_macos_arm64.dmg` 后安装。

## [1.7.0] - 2026-11-02

- 接入 DeepSeek，按既有 `staged-commit-message-zh` 规则为暂存区生成中文 Conventional Commit；预览编辑后明确填入提交草稿，不自动提交或推送。
- 仅由原生进程读取 `DEEPSEEK_API_KEY`，兼容 macOS Finder/Dock 启动时的登录 Shell 环境；密钥不进入前端、偏好设置或发行包，未安装本机 Skill 时使用内置规则。
- 生成、取消、重试及失败保留已有草稿；应用文案前核验索引内容、HEAD 与分支，拒绝过期结果，隔离不同工作区的请求。
- 为缺少密钥、API 失败和输入过大提供明确提示，不静默截断暂存差异；保留手写提交流程，补齐简体中文、繁体中文和英文界面文案。
- 更新应用图标为已选定的 Git 分支合并设计，同步各平台与前端图标资源。

AI 生成会将暂存差异和必要仓库上下文发送至 DeepSeek，需要配置账户与网络。详见 [AI 使用说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/user-manual.md#ai-生成提交信息170)。

此版本提供 macOS Apple Silicon（arm64）安装包，采用 ad-hoc 签名，未进行 Developer ID 签名及 Apple 公证。升级前请保存提交草稿，并用 `⌘Q` 完全退出旧版。请使用同一 Release 的 `SHA256SUMS.txt` 校验 `GitWorkbench_1.7.0_macos_arm64.dmg` 后安装。

## [1.6.2] - 2026-11-02

- 切换分支后检查已配置的远程上游并自动快进拉取，包含此前尚未获取的新提交；同步失败时保留已完成的切换并提示原因。
- 在「拉取」按钮旁显示待拉取数量，与待推送数量同时展示；数量为零、未知或未设置上游时隐藏角标。
- 保留本地修改，分支分叉时不自动变基或暂存；切换进度及待拉取文案支持简体中文、繁体中文和英文。

此版本提供 macOS Apple Silicon（arm64）安装包，采用 ad-hoc 签名，未进行 Developer ID 签名及 Apple 公证。详见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。

升级前请保存提交草稿，并用 `⌘Q` 完全退出旧版。请使用同一 Release 的 `SHA256SUMS.txt` 校验 `GitWorkbench_1.6.2_macos_arm64.dmg` 后安装。

## [1.6.1] - 2026-10-30

- 当前分支未配置上游时显示「发布分支」，建立上游跟踪前隐藏待推送数量。
- 移除没有比较引用时将分支全部历史计为待推送的逻辑；已跟踪分支继续按本地已获取的上游引用计算领先提交数。
- 首次发布时，若提交已推送到远程但上游跟踪设置未能保存，明确提示后续设置未完成，避免误报整个发布操作成功。
- 发布入口及说明提供简体中文、繁体中文和英文，保留现有远程选择与首次推送建立跟踪的流程。

此版本提供 macOS Apple Silicon（arm64）安装包，采用 ad-hoc 签名，未进行 Developer ID 签名及 Apple 公证。详见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。

升级前请保存提交草稿，并用 `⌘Q` 完全退出旧版。请使用同一 Release 的 `SHA256SUMS.txt` 校验 `GitWorkbench_1.6.1_macos_arm64.dmg` 后安装。

## [1.6.0] - 2026-10-29

- 提交历史为尚未包含在所选本地分支上游中的记录添加绿色上箭头及「待推送」标识；按本地已获取引用判断，搜索、分页及上游更新后保持对应关系。
- 使用 Git 可达性判断待推送记录，兼容合并提交，保留现有提交及合并图标、选中样式和历史 Diff。无上游、上游不可用、选择远程分支或分离 HEAD 时隐藏标识。
- 同步说明支持简体中文、繁体中文和英文，窄提交列表保持标签完整可见；读取历史不自动获取远程或修改仓库。

此版本提供 macOS Apple Silicon（arm64）安装包，采用 ad-hoc 签名，未进行 Developer ID 签名及 Apple 公证。详见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。浏览器界面流程和真实临时 Git 仓库操作已验证，原生窗口交互仍待补验。

升级前请保存提交草稿，并用 `⌘Q` 完全退出旧版。请使用同一 Release 的 `SHA256SUMS.txt` 校验 `GitWorkbench_1.6.0_macos_arm64.dmg` 后安装。

## [1.5.0] - 2026-10-29

- 在仓库侧栏各工作区的分支名右侧显示待拉取、待推送提交数，悬停查看上游说明，并适配窄侧栏。
- 各分支与自身上游比较，兼容工作区独立配置及条件 Git 配置；数量基于本地已获取引用，显示本身不自动获取远程。已同步、无上游或未知时隐藏数字，刷新失败时清除过期计数。
- 窄侧栏保留完整计数并省略长分支名，同步说明支持简体中文、繁体中文和英文；说明浮层不会阻挡相邻工作区的点击。
- 移除提交按钮下方重复的分支名和快捷键提示行。

此版本提供 macOS Apple Silicon（arm64）安装包，采用 ad-hoc 签名，未进行 Developer ID 签名及 Apple 公证。详见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。浏览器界面流程和真实临时 Git 仓库操作已验证，原生窗口交互仍待补验。

升级前请保存提交草稿，并用 `⌘Q` 完全退出旧版。请使用同一 Release 的 `SHA256SUMS.txt` 校验 `GitWorkbench_1.5.0_macos_arm64.dmg` 后安装。

## [1.4.0] - 2026-10-28

- 在分支列表中显示各本地分支相对自身上游的待拉取、待推送提交数；使用本地已获取引用，打开列表不自动获取远程。
- 新增中文简体、中文繁體和 English 界面语言选项，在设置中即时切换并保存；保留仓库会话、提交草稿与阅读偏好。
- 本地化工作台、分支与合并操作、远程操作、历史和 Diff 提示；仓库内容及 Git 原始输出保持原文。
- 公开文档改为英文优先，为 README 和链接的各项指南提供完整简体中文版及语言切换链接。

此版本提供 macOS Apple Silicon（arm64）安装包，采用 ad-hoc 签名，未进行 Developer ID 签名及 Apple 公证。详见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。

升级前请保存提交草稿，并用 `⌘Q` 完全退出旧版。请使用同一 Release 的 `SHA256SUMS.txt` 校验 `GitWorkbench_1.4.0_macos_arm64.dmg` 后安装。

## [1.3.0] - 2026-10-28

- 新增获取、拉取与推送：获取全部已配置远程的引用，按上游快进拉取，只推送当前分支；首次推送可建立上游跟踪。
- 在推送箭头旁显示待上传提交数，提交、切换分支和远程操作后更新；计数基于本地已获取的远程引用，未知或为零时不显示。
- 远程操作提供执行进度、错误及后续刷新警告，复用本机 Git 凭据和 SSH 配置；保留非快进、未完成操作及过期预览检查，不自动强推、变基或 stash。
- 接入 vscode-icons 的 116 个原始 SVG，文件列表、目录树、提交历史和 Diff 标签页按文件名、复合后缀及语言显示对应图标，目录展开与收起使用配套图标。
- 图标随应用离线打包，保留来源、图标 CC BY-SA 4.0 及关联数据 MIT 许可；更新安装说明与操作手册。

此版本提供 Apple Silicon（arm64）macOS 正式安装包，采用 ad-hoc 签名，尚未进行 Developer ID 签名及 Apple 公证。安装与系统提示处理见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。

升级前请保存提交草稿，并用 `⌘Q` 完全退出旧版。安装包：`GitWorkbench_1.3.0_macos_arm64.dmg`；请使用同一 Release 的 `SHA256SUMS.txt` 校验后安装。

## [1.2.0] - 2026-10-26

- 将分支切换弹窗扩展为分支管理，增加本地分支创建、可选创建后切换，以及悬停或键盘聚焦时的删除入口。
- 支持从本地分支、已获取的远程分支或当前 HEAD 创建；远程起点建立跟踪关系，切换失败时保留已创建分支并提示实际结果。
- 删除前检查当前分支、全部 Worktree 占用及未完成的 Git 操作；按当前 HEAD 统计未合入提交，强制删除需单独确认，过期预览需重新检查。
- 仅修改其他分支引用时保留 Diff、历史阅读状态与提交草稿，浏览器演示同步提供创建、切换及普通/强制删除流程。

此版本提供 Apple Silicon（arm64）macOS 正式安装包，采用 ad-hoc 签名，尚未进行 Developer ID 签名及 Apple 公证。安装与系统提示处理见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。

升级前请保存提交草稿，并用 `⌘Q` 完全退出旧版。安装包：`GitWorkbench_1.2.0_macos_arm64.dmg`；请使用同一 Release 的 `SHA256SUMS.txt` 校验后安装。

## [1.1.0] - 2026-10-22

- 新增合并分支入口，支持本地及已获取的远程分支、快进优先与始终创建合并提交，确认前展示合并方向和待合入提交数。
- 新增合并冲突分组、独立合并提交草稿、完成合并与中止合并；重启或外部 Git 操作后从磁盘恢复合并状态，支持零文件差异的合并提交。
- 合并前校验工作区、未完成操作及分支引用；保留 Git hooks 和签名检查，失败后展示实际状态供继续处理。
- 新增真实仓库的只读提交历史，以提交列表、变更文件树和 Diff 三栏浏览；支持完整提交说明、完整 Hash 复制、独立栏宽和历史 Diff 模式。
- 支持当前分支、本地分支及已获取远程分支的历史筛选，不执行分支切换；按 Git `--date-order` 排序，每页 50 条并固定分页快照，搜索覆盖提交说明、作者和 Hash 的完整可达历史。
- 支持首次提交与空版本比较、合并提交切换父提交，以及新增、删除、重命名和权限变更；历史正文只读取 Git 对象，二进制、大文件和子模块展示说明。
- 按 worktree 在会话内保留历史浏览状态；检测到引用变化时提示刷新，保留当前 Diff，读取失败可重试，不影响本地更改选择和提交草稿。

此版本为正式版本，提供 Apple Silicon（arm64）macOS 安装包，采用 ad-hoc 签名，尚未进行 Developer ID 签名及 Apple 公证。安装与系统提示处理见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。

升级前请保存提交草稿，并用 `⌘Q` 完全退出旧版。安装包：`GitWorkbench_1.1.0_macos_arm64.dmg`；请使用同一 Release 的 `SHA256SUMS.txt` 校验后安装。

## [1.0.0] - 2026-10-21

- 合并提交标题和详细说明为一个多行输入框，保留完整草稿与换行，提交时按首行和后续正文生成 Git 提交信息。
- 新增当前工作区的原生文件监听，支持 linked worktree 公共 Git 元数据；采用 1 秒防抖、前台空闲门控及自动刷新完成后 5 秒冷却，无固定状态轮询。
- 后台变化合并到返回前台后处理，静默更新保留当前 Diff、阅读位置和提交草稿；读取失败保留上次结果并提示。
- 忽略无关文件及 Git 锁/对象噪声，状态读取禁用可选索引写入，避免刷新触发自身监听。

此版本发布为正式版本，仅提供 Apple Silicon（arm64）macOS 安装包。安装包继续使用 ad-hoc 签名，尚未进行 Developer ID 签名及 Apple 公证；正式版本标记不改变签名状态。首次打开提示的处理方式见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。

升级前请保存提交草稿，再用 `⌘Q` 完全退出旧版。安装包：`GitWorkbench_1.0.0_macos_arm64.dmg`；请使用同一 Release 的 `SHA256SUMS.txt` 校验后安装。

## [0.1.2] - 2026-10-21

- 优化文件树引导线：默认隐藏层级竖线，选中文件时仅显示最近父级的引导线，鼠标进入文件树区域时显示全部层级关系。
- 切换文件、暂存分组或折叠目录时同步更新引导线，避免其他分组或祖先目录残留高亮。
- 更新应用图标为石墨底色与蓝色立体 Git 分支标识，同步桌面图标及网页 favicon。
- 调整图标源图为背景铺满的不透明画布，移除预置留白与外框。

此版本仅提供 Apple Silicon（arm64）macOS 安装包，继续使用 ad-hoc 签名，尚未进行 Developer ID 签名及 Apple 公证。首次打开提示的处理方式见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。

升级前请保存提交草稿，再用 `⌘Q` 完全退出旧版。安装包：`GitWorkbench_0.1.2_macos_arm64.dmg`；请使用同一 Release 的 `SHA256SUMS.txt` 校验后安装。

## [0.1.1] - 2026-10-20

- 对齐 Atom One Dark 上游的控件、列表、徽标与 Diff 配色，统一系统界面字体和文件树行高。
- 保存已打开的本地仓库及当前 worktree，重启后恢复并读取最新 Git 状态；单个路径失效不影响其他仓库恢复。
- macOS 关闭主窗口时隐藏并保留工作区、Diff 和提交草稿，点击 Dock 图标恢复窗口，`⌘Q` 正常退出。
- 修复 macOS 从 Finder/Dock 启动后 hooks 找不到 Node、npm、npx 的问题；缓存登录 Shell PATH，并保留提交检查及失败后的暂存内容。

此版本仅提供 Apple Silicon（arm64）macOS 安装包，继续使用 ad-hoc 签名，尚未进行 Developer ID 签名及 Apple 公证。首次打开提示的处理方式见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。

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

签名说明：此包使用 ad-hoc 签名，尚未进行 Developer ID 签名及 Apple 公证。首次打开可能需要在「系统设置 → 隐私与安全性」中确认，详见[安装说明](https://github.com/asd116725/git-workbench/blob/main/docs/zh-CN/installation.md)。

安装包：`GitWorkbench_0.1.0_macos_arm64.dmg`。请与同一 Release 的 `SHA256SUMS.txt` 校验后安装。
