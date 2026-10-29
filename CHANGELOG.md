# Changelog

**English** | [简体中文](CHANGELOG.zh-CN.md)

Versions use `major.minor.patch`, with a `v` prefix for Git tags. The `0.1.x` series consisted of prereleases; `1.0.0` was the first stable release.

## [Unreleased]

## [1.6.0] - 2026-10-29

**English** | [简体中文](https://github.com/asd116725/git-workbench/blob/main/CHANGELOG.zh-CN.md#160---2026-10-29)

- Mark commits not yet contained in the selected local branch's upstream with a green arrow and an “Unpushed” badge in history. Preserve the correct markers across search, pagination, and upstream updates using locally fetched refs.
- Determine outgoing commits by Git reachability, including merge commits, and retain the existing commit and merge icons, selection styling, and historical diffs. Hide markers when the branch has no upstream, the upstream is unavailable, or a remote branch or detached HEAD is selected.
- Provide Simplified Chinese, Traditional Chinese, and English explanations, and keep badges visible in narrow commit lists. Reading history does not fetch or modify the repository.

This release provides a macOS Apple Silicon (arm64) installer. It is ad-hoc signed, without Developer ID signing or Apple notarization. See the [installation guide](https://github.com/asd116725/git-workbench/blob/main/docs/installation.md). Browser interface flows and real temporary Git repositories have been tested; native-window interaction remains pending verification.

Save commit drafts and quit the previous version completely with `⌘Q` before upgrading. Verify `GitWorkbench_1.6.0_macos_arm64.dmg` against `SHA256SUMS.txt` from the same release before installing.

## [1.5.0] - 2026-10-29

**English** | [简体中文](https://github.com/asd116725/git-workbench/blob/main/CHANGELOG.zh-CN.md#150---2026-10-29)

- Show each worktree's incoming and outgoing commit counts beside its branch in the repository sidebar, with upstream details on hover and support for narrow sidebars.
- Compare each branch with its own upstream, including worktree-specific and conditional Git configuration. Counts use locally fetched refs; displaying them does not trigger a fetch. Hide numbers when synchronized, without an upstream, or unknown, and clear stale counts when refresh fails.
- Keep complete counts and truncated branch names in narrow sidebars, and provide synchronization explanations in Simplified Chinese, Traditional Chinese, and English. Explanatory tooltips do not block clicks on adjacent worktrees.
- Remove the duplicate branch name and shortcut hint below the commit button.

This release provides a macOS Apple Silicon (arm64) installer. It is ad-hoc signed, without Developer ID signing or Apple notarization. See the [installation guide](https://github.com/asd116725/git-workbench/blob/main/docs/installation.md). Browser interface flows and real temporary Git repositories have been tested; native-window interaction remains pending verification.

Save commit drafts and quit the previous version completely with `⌘Q` before upgrading. Verify `GitWorkbench_1.5.0_macos_arm64.dmg` against `SHA256SUMS.txt` from the same release before installing.

## [1.4.0] - 2026-10-28

**English** | [简体中文](https://github.com/asd116725/git-workbench/blob/main/CHANGELOG.zh-CN.md#140---2026-10-28)

- Show incoming and outgoing commit counts next to local branches in the branch list, relative to each branch's upstream. Counts use locally fetched refs and do not trigger a fetch.
- Add Simplified Chinese, Traditional Chinese, and English interface options, applied immediately and saved from settings, while preserving repository sessions, commit drafts, and reading preferences.
- Localize the workbench, branch and merge operations, remote operations, history, and diff messages. Repository content and raw Git output remain unchanged.
- Make English the default language for public documentation, with complete Simplified Chinese versions and language links for the README and its linked guides.

This release provides a macOS Apple Silicon (arm64) installer. It is ad-hoc signed, without Developer ID signing or Apple notarization. See the [installation guide](https://github.com/asd116725/git-workbench/blob/main/docs/installation.md).

Save commit drafts and quit the previous version completely with `⌘Q` before upgrading. Verify `GitWorkbench_1.4.0_macos_arm64.dmg` against `SHA256SUMS.txt` from the same release before installing.

## [1.3.0] - 2026-10-28

- Add fetch, pull, and push: fetch refs from all configured remotes, pull from the upstream with fast-forward only, and push only the current branch. The first push can set upstream tracking.
- Show the outgoing commit count beside the push arrow and refresh it after commits, branch switches, and remote operations. The count uses locally fetched remote refs and is hidden when unknown or zero.
- Show progress, errors, and post-operation refresh warnings for remote operations, using the installed Git's credentials and SSH configuration. Retain checks for non-fast-forward updates, unfinished operations, and stale previews. Never automatically force-push, rebase, or stash.
- Bundle 116 original SVG files from vscode-icons. File lists, folder trees, commit history, and diff tabs select icons by filename, compound extension, and language, with matching expanded and collapsed folder icons.
- Bundle icons for offline use and retain attribution, the CC BY-SA 4.0 artwork license, and the MIT license for association data. Update the installation guide and user manual.

This stable release provides a macOS Apple Silicon (arm64) installer. It is ad-hoc signed, without Developer ID signing or Apple notarization. See the [installation guide](https://github.com/asd116725/git-workbench/blob/main/docs/installation.md) for installation steps and macOS prompts.

Before upgrading, save your commit drafts and quit the previous version completely with `⌘Q`. Installer: `GitWorkbench_1.3.0_macos_arm64.dmg`. Verify it against `SHA256SUMS.txt` from the same release before installing.

## [1.2.0] - 2026-10-26

- Expand the branch switcher into branch management, adding local branch creation, optional switching after creation, and a delete action available on hover or keyboard focus.
- Create from a local branch, a fetched remote branch, or the current HEAD. A remote starting point sets upstream tracking. If switching fails, keep the newly created branch and report the actual outcome.
- Before deletion, check the current branch, usage by all worktrees, and unfinished Git operations. Count unmerged commits relative to the current HEAD, require separate confirmation for force deletion, and recheck stale previews.
- Preserve the diff, history reading state, and commit draft when only other branch refs change. Add equivalent creation, switching, and normal/force deletion flows to the browser demo.

This stable release provides a macOS Apple Silicon (arm64) installer. It is ad-hoc signed, without Developer ID signing or Apple notarization. See the [installation guide](https://github.com/asd116725/git-workbench/blob/main/docs/installation.md) for installation steps and macOS prompts.

Before upgrading, save your commit drafts and quit the previous version completely with `⌘Q`. Installer: `GitWorkbench_1.2.0_macos_arm64.dmg`. Verify it against `SHA256SUMS.txt` from the same release before installing.

## [1.1.0] - 2026-10-22

- Add branch merging from local or fetched remote branches, with fast-forward when possible or an option to always create a merge commit. Show the merge direction and incoming commit count before confirmation.
- Add a merge-conflict group, a separate merge message draft, and actions to complete or abort a merge. Restore merge state from disk after relaunch or external Git operations, and support merge commits with no file differences.
- Check the worktree, unfinished operations, and branch refs before merging. Preserve Git hooks and signing checks, and show the actual state after a failure so the user can continue.
- Add read-only history for real repositories, with commit, changed-file, and diff panes. Include full commit messages, copying full hashes, independent pane widths, and historical diff modes.
- Filter history by the current branch, local branches, or fetched remote branches without switching the worktree branch. Use Git `--date-order`, 50 commits per page, and a fixed pagination snapshot. Search messages, authors, and hashes across the full reachable history.
- Compare the initial commit with an empty tree, select parents of merge commits, and support additions, deletions, renames, and permission changes. Historical content comes only from Git objects; binary files, large files, and submodules show an explanation.
- Keep history browsing state per worktree for the current session. Prompt for refresh when refs change while preserving the current diff. Failed reads can be retried without affecting local-change selection or commit drafts.

This stable release provides a macOS Apple Silicon (arm64) installer. It is ad-hoc signed, without Developer ID signing or Apple notarization. See the [installation guide](https://github.com/asd116725/git-workbench/blob/main/docs/installation.md) for installation steps and macOS prompts.

Before upgrading, save your commit drafts and quit the previous version completely with `⌘Q`. Installer: `GitWorkbench_1.1.0_macos_arm64.dmg`. Verify it against `SHA256SUMS.txt` from the same release before installing.

## [1.0.0] - 2026-10-21

- Combine the commit subject and body into one multiline input, preserving the full draft and line breaks. Use the first line as the Git subject and the remaining content as the body.
- Add native filesystem watching for the active worktree, including shared Git metadata for linked worktrees. Use a 1-second debounce, require the app to be in the foreground and idle, and wait at least 5 seconds after an automatic refresh finishes. No fixed-interval status polling.
- Combine background changes for processing when the app returns to the foreground. Silent updates preserve the current diff, reading position, and commit draft. Failed reads preserve the previous result and show a message.
- Ignore unrelated files and Git lock/object noise. Disable optional index writes during status reads so refreshes do not trigger their own watchers.

This is a stable release with a macOS Apple Silicon (arm64) installer only. The installer remains ad-hoc signed, without Developer ID signing or Apple notarization; stable release status does not change its signing status. See the [installation guide](https://github.com/asd116725/git-workbench/blob/main/docs/installation.md) for first-launch prompts.

Before upgrading, save your commit drafts and quit the previous version completely with `⌘Q`. Installer: `GitWorkbench_1.0.0_macos_arm64.dmg`. Verify it against `SHA256SUMS.txt` from the same release before installing.

## [0.1.2] - 2026-10-21

- Refine file-tree guides: hide vertical hierarchy lines by default, show only the selected file's nearest parent guide, and show all hierarchy lines while the pointer is inside the tree.
- Update guides when switching files, staging groups, or collapsed folders, preventing stale highlights in other groups or ancestors.
- Replace the app icon with a blue three-dimensional Git branch symbol on a graphite background, updating the desktop icon and web favicon together.
- Make the source icon canvas opaque with an edge-to-edge background, removing preset padding and the outer frame.

This release provides only a macOS Apple Silicon (arm64) installer. It remains ad-hoc signed, without Developer ID signing or Apple notarization. See the [installation guide](https://github.com/asd116725/git-workbench/blob/main/docs/installation.md) for first-launch prompts.

Before upgrading, save your commit drafts and quit the previous version completely with `⌘Q`. Installer: `GitWorkbench_0.1.2_macos_arm64.dmg`. Verify it against `SHA256SUMS.txt` from the same release before installing.

## [0.1.1] - 2026-10-20

- Align controls, lists, badges, and diff colors with upstream Atom One Dark. Unify system interface fonts and file-tree row heights.
- Save open local repositories and the current worktree, restoring them with fresh Git state on launch. An unavailable path does not prevent other repositories from being restored.
- On macOS, closing the main window hides it while preserving the worktree, diff, and commit draft. Clicking the Dock icon restores the window; `⌘Q` quits normally.
- Fix hooks failing to find Node, npm, or npx when launched from Finder or the Dock. Cache the login shell's PATH while retaining commit checks and staged content after failures.

This release provides only a macOS Apple Silicon (arm64) installer. It remains ad-hoc signed, without Developer ID signing or Apple notarization. See the [installation guide](https://github.com/asd116725/git-workbench/blob/main/docs/installation.md) for first-launch prompts.

Before upgrading, save your commit drafts and quit the previous version completely with `⌘Q`. Installer: `GitWorkbench_0.1.1_macos_arm64.dmg`. Verify it against `SHA256SUMS.txt` from the same release before installing.

## [0.1.0] - 2026-10-16

- Publish the project as open source, with a macOS Apple Silicon (arm64) DMG.
- Open local Git repositories and discover and switch between linked worktrees.
- Search local and fetched remote branches, sorted by latest commit, with commit summaries.
- Browse staged and unstaged files in a tree or list, with side-by-side and inline diffs.
- Stage or unstage files, directories, or entire groups, and commit the staged content.
- Add Atom One Dark colors, code font size and pane layout preferences, and an app version display in settings.
- Provide Chinese installation instructions, a user manual, and a release workflow.

Initial release scope: arm64 installer only, using the system Git. Real-repository history, fetch, pull, push, hunk staging, and conflict editing are not yet available in this version. Refresh manually after external repository changes.

Signing: this package is ad-hoc signed, without Developer ID signing or Apple notarization. On first launch, macOS may require confirmation in **System Settings → Privacy & Security**; see the [installation guide](https://github.com/asd116725/git-workbench/blob/main/docs/installation.md).

Installer: `GitWorkbench_0.1.0_macos_arm64.dmg`. Verify it against `SHA256SUMS.txt` from the same release before installing.
