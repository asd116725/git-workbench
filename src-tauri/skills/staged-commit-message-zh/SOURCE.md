此文件夹的 SKILL.md 是发行包内置规则快照，使用 include_str! 编译入原生程序。

- 来源：本机 Codex Skill `~/.codex/skills/staged-commit-message-zh/SKILL.md`
- 同步日期：2026-11-02
- SHA-256：`74708f89c43aa5cb8ca524d129b48da630858c4db0a07fef51b8452bdb30d20c`

运行时优先使用 `$CODEX_HOME/skills/staged-commit-message-zh/SKILL.md`；未设置 CODEX_HOME 时使用用户主目录下的 `.codex`。本机文件不存在时才使用本快照，其他读取或内容错误明确报错。

应用按 Skill 取材与写作，不执行其中的 Shell 示例。首版完整读取预算内的暂存 diff，超限拒绝生成；不运行 commitlint、仓库配置脚本、提交钩子或模型工具。
