# Contributing

**English** | [简体中文](CONTRIBUTING.zh-CN.md)

Issues for bugs and suggestions, and pull requests for code, documentation, and tests are welcome. Before starting a larger feature, describe the use case and expected behavior in an issue.

## Local development

Follow the [README](README.md#run-from-source) to install dependencies and run the desktop app. `src/` contains the React interface, state, and browser demo; `src-tauri/src/` handles real Git operations. Keep these two data sources separate.

## Coding and validation

- Reuse existing components, keep logic clear, and avoid abstractions that only save a few lines.
- Add concise Chinese comments to public interfaces and complex functions with business constraints, focusing on why the behavior is needed.
- Pass Git arguments as arrays rather than building shell commands. Preserve unstaged user changes and locks owned by external Git operations.
- When changing Git behavior, use independent temporary repositories to verify relevant cases such as additions, deletions, renames, and partially staged files. Do not run write tests against your working business repositories.
- Add behavior-focused tests for new features and complex fixes. Use appropriate manual validation for small wording or styling changes.

Before submitting, run:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
pnpm release:check
```

For UI changes, include screenshots using fictional data and the results of checks you actually ran. After adding a production dependency or changing a lockfile, run `pnpm release:licenses` and review the third-party license files.

## Commits and pull requests

Write commit messages in Chinese, for example `fix: 保留取消暂存后的文件选择`. Describe the concrete problem, final behavior, validation, and anything left unverified in the pull request. Do not report a check as passing if you did not run it.

Do not commit credentials, personal absolute paths, private repository data, dependency directories, build artifacts, or real commit records used during a demo. Example data must be fictional.

Contributions are provided under this project's [MIT license](LICENSE). Third-party assets and dependencies retain their original licenses.
