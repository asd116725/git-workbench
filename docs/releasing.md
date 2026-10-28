# Maintainer's release guide

**English** | [简体中文](zh-CN/releasing.md)

## Version conventions

`package.json` is the version source; Tauri's `version` references it directly. The release script synchronizes the root Rust package version and its lockfile entry. Use Git tags in the form `vX.Y.Z` and changelog headings in the form `## [X.Y.Z] - YYYY-MM-DD`.

```sh
pnpm release:version 1.4.0
# Write this release's changes in CHANGELOG.md under [1.4.0], keeping an empty [Unreleased]
pnpm release:check --tag v1.4.0
```

The script rejects invalid formats and version downgrades, preserves third-party dependency versions, and does not create commits or tags. GitHub Release flags control prerelease status; version numbers still use `x.y.z`.

Keep the English and Simplified Chinese documentation in sync, including `CHANGELOG.md` and `CHANGELOG.zh-CN.md`. Release notes are extracted from the English `CHANGELOG.md`; preserve the version heading format in both files.

## Local checks and builds

The app icon source is `src-tauri/icons/app-icon-source.png`. Use an opaque square canvas with the background extending to every edge. Do not add transparent padding, a rounded base, or an outer frame in advance, as these can produce a gray backing when newer macOS versions adapt the icon. After replacing the source, run `pnpm tauri icon src-tauri/icons/app-icon-source.png --output src-tauri/icons` to generate platform sizes, and copy the generated `src-tauri/icons/128x128.png` to `public/app-icon.png`. After building, check the actual icon in Finder and the Dock, not only the PNG preview.

1. Start from a clean `main` and confirm that the changelog, download links, manual, and screenshots match the release.
2. Run all checks in the README. The version script's tests cover version mismatches, incorrect tags, missing changelog entries, and invalid upgrades.
3. When adding or upgrading dependencies, run `pnpm release:licenses`, commit the generated `docs/licenses/dependencies.txt`, and check for missing license text.
4. On macOS, run `pnpm desktop:package` to produce:

```text
release-artifacts/
  GitWorkbench_1.4.0_macos_arm64.dmg
  SHA256SUMS.txt
  release-notes.md
```

Filenames follow the version being built. This command only builds an arm64 DMG; it does not commit, push, or upload anything. `pnpm desktop:build` continues to build only the `.app` for the default architecture.

5. Verify with `shasum -a 256 -c SHA256SUMS.txt`, mount the DMG, and check the layout for dragging the app into Applications.
6. Copy the app to an independent temporary directory. Check its version in `Contents/Info.plist`, architecture with `file`/`lipo`, and signature with `codesign --verify --deep --strict`.
7. Launch the packaged app and use a temporary repository to verify diffs, directory staging, unstaging, and multiline commit messages. Confirm that commits include only staged content and leave other worktree content unchanged.
8. Modify the active worktree externally. Verify the 1-second debounce, the 5-second cooldown after refresh completion, and deferral of background changes until the app returns to the foreground. Confirm that the same diff keeps its scroll position and the commit draft is preserved. Switching windows without changes should not trigger a refresh.
9. Enter a commit draft and click the red macOS close button. Confirm that the process stays running. Click the Dock icon and check that the worktree, diff, and draft are preserved, then use `⌘Q` to confirm that the process exits normally.

## Push and create a draft release

For the first release, sign in to the maintainer account using the official GitHub CLI flow, `gh auth login --web`. Do not put tokens in the repository or workflows.

```sh
git add <release-files>
git commit -m "chore: 发布 1.4.0 正式版本"
git tag -a v1.4.0 -m "Git Workbench 1.4.0"
git push origin main
git push origin v1.4.0
```

The base CI runs for `main`, pull requests, and `v*` tags. Tag jobs first validate versions and tags, types, lint, the frontend build, and frontend/backend tests, then build the arm64 DMG on `macos-15`. Only the release job has `contents: write` permission.

The workflow uses GitHub's short-lived token to create a **draft prerelease**, uploading the DMG, checksums, and current release notes. If a job fails, inspect the relevant Actions step, fix the issue, and rerun it. Do not move a published version tag just to retry. The workflow cannot overwrite an already published release.

## Before publishing

1. Confirm that every job in the tag workflow passed and that the release target commit matches the tag.
2. Download the draft attachments, verify their SHA-256 checksums, and check the DMG's version, architecture, and launch behavior.
3. Review the release notes, ad-hoc signing notice, installation guide link, and attachment names.
4. After these checks, publish `1.4.0` as a stable release and mark it as latest:

```sh
gh release edit v1.4.0 --repo asd116725/git-workbench --draft=false --prerelease=false --latest
```

5. Download the DMG and checksums again through the public links, and verify that the README's download links and user manual are accessible.

Stable release status and installer signing are separate. The current installer is ad-hoc signed, without Developer ID signing or Apple notarization. Do not describe it as notarized. Adding signing, notarization, or an update service in the future requires separate credentials and verification procedures.

References: [Tauri DMG](https://v2.tauri.app/distribute/dmg/), [macOS signing](https://v2.tauri.app/distribute/sign/macos/), and [Tauri GitHub release workflow](https://github.com/tauri-apps/tauri-action).
