# 贡献指南

欢迎通过 Issue 提交问题和建议，或通过 Pull Request 改进代码、文档及测试。开始较大的功能前，建议先描述使用场景和预期行为。

## 本地开发

按 [README](README.md#源码启动)安装依赖和启动桌面应用。`src/` 为 React 界面、状态与浏览器演示，`src-tauri/src/` 为真实 Git 操作；两种数据源应保持隔离。

## 编码与验证

- 优先使用已有组件，保持逻辑清晰，避免仅为减少几行代码而抽象。
- 公共接口及含业务约束的复杂函数添加简短中文说明；注释重点解释原因。
- Git 命令使用参数数组，避免 shell 拼接；保留用户未暂存内容和外部 Git 锁。
- 修改 Git 行为时，在独立临时仓库验证新增、删除、重命名及部分暂存等相关情形。不要使用自己的业务仓库做写入测试。
- 新功能、复杂修复应有针对行为的测试；文案、样式等小改动使用适当的人工验证即可。

提交前执行：

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
pnpm release:check
```

UI 变更请附使用虚构数据的截图和实际验证结果。新增生产依赖或修改锁文件后，执行 `pnpm release:licenses` 并检查第三方许可文件。

## 提交与 Pull Request

提交信息使用中文说明，例如 `fix: 保留取消暂存后的文件选择`。PR 请说明具体问题、最终行为、测试方式和未验证的范围，不要把未执行的检查写成通过。

不要提交凭据、个人绝对路径、业务仓库数据、依赖目录、构建产物或演示时的真实提交记录。示例数据必须虚构。

贡献以本项目 [MIT](LICENSE) 许可证提供，第三方素材与依赖继续遵循原有许可。
