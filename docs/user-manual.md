# Git Workbench user manual

**English** | [简体中文](zh-CN/user-manual.md)

This manual covers the stable `1.6.1` desktop release. Installers are available only for macOS Apple Silicon (arm64) from the [v1.6.1 release](https://github.com/asd116725/git-workbench/releases/tag/v1.6.1). The browser uses separate demo data and does not access real repositories.

Choose Simplified Chinese, Traditional Chinese, or English from [settings](#9-refreshing-and-settings). Screenshots show the English interface with fictional demo data.

## 1. Window layout

![Repositories, changed-file tree, and diff](screenshots/workbench-en.png)

- The left sidebar contains repositories and their linked worktrees.
- The middle pane contains unstaged/staged file trees and the commit form.
- The right pane shows a read-only diff of the selected file.
- The top bar has branch switching and manual refresh. The bottom bar shows the current worktree, changed-file count, and path.

Drag pane boundaries to resize them. **Commit history** opens a read-only three-pane view; see [commit history](#81-commit-history). The top bar also provides fetch, pull, and push; see [remote operations](#43-fetch-pull-and-push).

On macOS, the red close button only hides the main window. Repositories, the current diff, and uncommitted drafts remain in memory. Click the Dock icon to restore the window. To quit the app, use `⌘Q` or **Quit** in the app menu. After a full quit, repository paths are restored as described below, but commit drafts are not preserved across processes.

## 2. Open a local repository

1. Click **Open repository** (打开仓库) at the bottom left or `+` beside the repository heading.
2. Choose an existing Git repository in the directory picker, or enter its full path.
3. Once it appears in the sidebar, select the worktree you want to use.

You can select the repository root, a directory within it, or a linked worktree. This version does not initialize repositories or clone remote URLs; use a terminal or another Git tool first.

After a repository opens successfully, the app saves its path and the last selected worktree on the current device. On the next launch, it restores the repository list and reads the latest branches, changes, and diffs from Git. An inaccessible repository shows an error without blocking other repositories; its path is retained for another attempt on the next launch. If the last selected worktree has been deleted, the app selects an available one.

If opening fails, check that the directory exists, your account can access it, and `git -C /path/to/repository status` works. Git errors, including ownership checks, appear in the interface. Confirm the directory owner before following Git's suggested resolution.

## 3. Worktrees

When a repository opens, the app reads the linked worktrees registered with Git and lists them under the same repository. Each entry shows its name and branch; click one to change the operation target.

**Available since 1.5.0:** the sidebar shows `↓` incoming and `↑` outgoing commit counts beside each worktree's branch. Each branch is compared with its own upstream. Both counts appear when either is nonzero, for example `↓0 ↑3`; synchronized branches, branches without an upstream, and unknown counts show no numbers. Narrow sidebars preserve the counts and truncate the branch name; hover to read the full name and synchronization details. Counts use the most recently fetched local refs and displaying them does not contact the remote. Select the relevant worktree and click **Fetch** when you need updated remote refs.

Each worktree has its own files, index, and commit draft for the current session. Staging and committing affect only the selected worktree. Check the path in the bottom bar before switching targets.

After worktrees are added or deleted externally, Git metadata watching updates the list. You can also click **Refresh** for an immediate read. Worktrees whose directories have moved or become inaccessible cannot be opened normally. Creating, deleting, or repairing worktrees still requires Git commands or another tool.

## 4. Switch branches

Click the current branch in the top bar to open **Branch management** (分支管理), then type to filter local or remote branches. In the published v1.1.0 installer, this dialog is named **Switch branch** (切换分支).

- Branches are sorted by latest commit time. The second line shows the author, short hash, and summary of the latest commit.
- Use the mouse, or `↑` / `↓` to move, `Enter` to confirm, and `Esc` to close.
- Selecting a local branch switches to it in the current worktree.
- Selecting a fetched remote branch creates or uses the corresponding local tracking branch.
- Branches checked out in another worktree show the reason and cannot be selected.

The branch list does not contact remote servers automatically. If a new branch is missing, click **Fetch** to update remote refs.

**Available since 1.4.0:** local branches with pending changes show `↓` incoming and `↑` outgoing commit counts beside their names, for example `↓5 ↑0`. Each branch is compared with its own upstream, including branches that are not currently checked out. The pair is hidden when both counts are zero, no upstream is configured, or the counts cannot be determined. Remote branch rows do not show this pair. Counts describe locally fetched upstream refs; use **Fetch** before relying on them for the latest remote state.

Uncommitted edits may prevent switching. The app respects Git's checks and does not force files to be overwritten. Commit your work, stash it using an external tool, or otherwise resolve the changes before retrying. There is currently no stash action in the app.

## 4.1 Merging branches

1. Select the target worktree in the sidebar and confirm that the top bar shows the branch that should receive the changes.
2. Keep the worktree and index clean, then click **Merge** (合并) beside the branch selector.
3. Search for and select the source branch. Check **source → current branch** and the number of incoming commits.
4. By default, Git fast-forwards when possible and otherwise creates a merge commit. Enable **Always create a merge commit** when you need an explicit merge record.
5. Click **Merge into current branch**. If the current branch already contains the source commits, no merge is needed.

The source can be a local branch, a fetched remote branch, or a branch in use by another worktree. Only committed content is merged; uncommitted edits in other worktrees are excluded. The app does not automatically fetch, stash, or push. You cannot start a merge with a detached HEAD, before the first commit, or while a merge, rebase, or other Git operation is unfinished. If refs change after opening the dialog, recheck before executing.

**If conflicts occur:**

- The top bar shows the active merge, and the file pane lists **Merge conflicts** separately. Resolve conflicts in an external editor, save, and click `+` beside each file to stage it. The app does not provide a three-way conflict editor. Staging confirms that a file is resolved, so inspect its content first.
- Directory and whole-group actions in the regular **Unstaged** section exclude the conflict group to avoid accidentally marking conflicts as resolved in bulk.
- After resolving all conflicts and staging all changes to tracked files, review the **Merge commit message** and click **Complete merge** or press `⌘ Enter`. You can complete a merge even if the resolved files are identical to the current HEAD.
- The merge message has its own draft; the ordinary commit draft is preserved. After relaunch, the app restores the merge state and Git's default message from disk. Drafts typed in the app last only for the current session.
- To abandon an unfinished merge, click **Abort merge** and confirm. This discards changes from the merge and conflict-resolution process; save anything you need elsewhere first. This action is not shown for a merge that has already completed successfully.

The app does not bypass failing hooks or signing checks. It rereads the actual state and shows the error. If the merge is still pending, fix the problem and try **Complete merge** again, or abort it. Merges started in other tools have the same recovery actions. Other unfinished Git operations must be continued or aborted externally.

## 4.2 Creating and deleting local branches

These features are available starting with 1.2.0 and are not included in the 1.1.0 installer. Click the current branch in the top bar to open **Branch management**. In the browser, the same entry uses simulated data labeled **Demo mode**.

**Create a branch:**

1. Click **New branch** and enter a name such as `feature/search`.
2. Choose a starting point. The current branch is the default; you can also select another local branch or a fetched remote branch. With a detached HEAD, the current commit is the default. If no starting point exists, create the first commit first.
3. **Switch to the new branch after creation** is selected by default. Clear it to create only the ref, keeping the current files, diff, history reading state, and commit draft unchanged.
4. Click **Create and switch** or **Create branch**. A remote starting point sets the corresponding upstream tracking relationship; it does not push anything.

Git checks for invalid names, duplicate names, and conflicts with existing branch path components. Switching does not force local edits to be overwritten. If creation succeeds but switching fails because of local edits or another reason, the app reports this clearly and keeps the new branch in the list. Resolve the issue and switch directly from the list; there is no need to create it again.

**Delete a branch:**

1. Hover over a local branch, or focus its row actions with `Tab`, and click the trash button. The current branch and any branch in use by a worktree cannot be deleted. Remote branches have no delete action.
2. Confirm the branch name and whether its commits are contained in the current HEAD. If all commits are included, click **Delete branch**.
3. If there are unmerged commits, check the count and select **I understand the risks and still want to force-delete this branch** before clicking **Force delete**. “Unmerged” is relative to the current HEAD; pushing a commit to a remote does not mean it has been merged.

Deletion removes only the local branch ref. It does not delete worktree files or remote branches. Unmerged commits may be difficult to recover afterward, so review carefully. If the target ref or current HEAD changes after the preview, deletion is blocked until you click **Recheck branch** and confirm again. If the current HEAD has no commits, switch to a branch with commits before checking deletion.

Branches cannot be created or deleted while a merge, rebase, cherry-pick, or similar operation is unfinished. Duplicate submissions are blocked while a write is running. A failed list refresh after a successful operation is shown as a warning. Canceling creation or deletion returns to the list with the search text preserved.

## 4.3 Fetch, pull, and push

These features are available starting with 1.3.0. Configure a remote for the repository first. The app uses your installed Git's credentials and SSH configuration; it does not provide a sign-in form.

- **Fetch** (获取): update refs from all configured remotes and prune records of deleted remote branches. This does not merge into the current branch or change worktree files.
- **Pull** (拉取): fetch the current branch's upstream and update with fast-forward only. If there is no upstream, push first to set tracking. If both sides have new commits, fetch, then use **Merge** to merge the upstream branch. The app does not automatically rebase, stash, or force files to be overwritten.
- **Push** (推送): upload only the current branch to its configured upstream branch. It does not push other branches in bulk or force-push. When no upstream is configured, the action is labeled **Publish branch** (发布分支). On first publication, it prefers `origin`, otherwise the only available remote. If multiple remotes exist without a default target, choose a remote in the dialog and set upstream tracking.

The number beside the upload arrow is the outgoing commit count relative to the current branch's locally fetched upstream ref. It appears only when greater than zero. Branches without an upstream show **Publish branch** without a count; their full commit history is not treated as outgoing. Remote refs can lag behind the server; click **Fetch** to update them. No number is shown when the count is unknown. The app rereads the count after commits, branch switches, and fetch, pull, or push operations.

During execution, the buttons show progress and other Git write operations are temporarily disabled. Git errors are displayed on failure; for authentication errors, check your local credentials or SSH configuration first. If an operation succeeds but refreshing the state fails, refresh to confirm the actual state.

## 5. File tree and list

Changes are grouped into **Unstaged** and **Staged**. A file can appear in both groups. Each group's badge counts change entries; the bottom bar counts unique files.

Use the icons at the top right of the file pane to switch between a folder tree and a flat list. Folder arrows expand or collapse directories; file names select a diff. Numbers beside directories count changed entries below them. Common status letters are `A` for added, `M` for modified, `D` for deleted, and `R` for renamed.

Scroll to browse longer lists. The breadcrumb above the diff shows the file path.

File lists, folder trees, commit history, and diff tabs share vscode-icons, matched by special filename, longest compound extension, and language. Common folders also have matching expanded and collapsed icons. Icons are bundled for offline use; unrecognized types use generic icons.

Vertical hierarchy guides are hidden by default. Selecting a file shows only the guide for its nearest parent. Moving the pointer into the file tree shows all hierarchy guides; moving it out restores the selected file's parent guide.

## 6. Read diffs

Select an unstaged file to compare **index → worktree**, or a staged file to compare **HEAD (the last commit) → index**. In a new repository without HEAD, the starting point is empty content.

Use **Side by side / Inline** at the top right to change the view. The arrows jump to the previous or next changed hunk. Green marks additions and red marks deletions. The diff retains the full context for reading.

Diffs are read-only. Edit source files in your editor; the app refreshes after you save, or you can refresh manually. Binary files, non-UTF-8 text, oversized text, submodules, and unresolved conflicts may show an explanation instead of a normal text diff. Resolve conflicts with an external tool.

Real Git operations currently support staging whole files only. Hunk staging in the browser demo does not mean it is available in the desktop app.

## 7. Stage and unstage

Actions appear at the end of a row when you hover over it:

| Location | `+` in Unstaged | `−` in Staged |
| --- | --- | --- |
| File | Stage all changes in that file | Unstage that file |
| Directory | Stage all currently listed changed files under that directory | Unstage all currently listed staged files under that directory |
| Group heading | Stage all unstaged changes in the current worktree | Unstage all staged changes in the current worktree |

Directory actions include every subdirectory, even when collapsed. A row-end action is not limited to the file whose diff is currently selected.

Unstaging does not undo worktree file content; it only changes the index. Unstaging a partially staged file moves all of its uncommitted edits back to the unstaged group.

New write operations are temporarily blocked while an operation runs, then the status is refreshed. An external Git operation may cause an `index.lock` error. Wait for it to finish, refresh, and try again. Do not delete a lock file without understanding which process owns it.

## 8. Commit

1. Review the **Staged** files and their diffs.
2. Write the commit message in the multiline field. The first line is the subject; the remaining content is the body. Use blank lines to separate paragraphs. A plain Enter inserts a newline.
3. Click **Commit N files**, or press `⌘ Enter` in the form (`Ctrl Enter` on other platforms).

Only staged content is committed; unstaged edits are preserved. A commit requires a nonempty subject and staged changes. The app uses the system Git's author, signing, and hooks configuration; it does not change global Git settings.

If the author is not configured, set it for the current repository:

```sh
git config user.name "Your name"
git config user.email "Your email"
```

If a hook, signing step, or other Git check fails, the app shows the error and keeps the draft. Fix the issue and retry. After success, the draft clears and the change list refreshes. Commit drafts last only for the current app session and are lost on relaunch.

On macOS, the first Git operation reads PATH from a login and interactive shell in the user's home directory and caches it for the app process. Git and hooks can then find Node, npm, and npx installed through tools such as nvm or Homebrew. The app does not automatically select a Node version from a repository's `.nvmrc` or skip Husky checks. After installing tools or changing shell configuration, quit completely with `⌘Q` and reopen the app; hiding the window does not reload the environment. If shell initialization fails or takes longer than 10 seconds, the app keeps its original environment.

## 8.1 Commit history

**Available since 1.6.0:** commits not yet contained in the selected local branch's upstream have a green arrow and an **Unpushed** badge. Markers follow each commit across searches and pages, including merges. Hover for the upstream explanation. Counts and markers use locally fetched refs; reading history does not fetch. Branches without a usable upstream, remote branch filters, and detached HEAD do not show these markers. Refresh or fetch to read updated refs; pushing also refreshes history and its markers.

Click **Commit history** (提交历史) at the top. The repository sidebar stays in place. From left to right, the main area shows commits, the selected commit's changed-file tree, and its historical diff. On first entry, the newest commit and its first changed file are selected. Appropriate empty states appear when there are no commits or no changed files.

![Read-only history with three panes and fictional demo data](screenshots/history-en.png)

**Browse and search:**

- The current branch is selected by default. With a detached HEAD, the view shows the current commit and its ancestors. Use the history branch filter to select another local or fetched remote branch. This only changes the browsing scope; it does not switch the worktree branch or start a merge.
- The list contains all history reachable from that branch, including commits introduced by merges. Git's `--date-order` keeps children before their parents, otherwise ordering by commit time. Entries are grouped under Today, Yesterday, or a date.
- Each page contains 50 commits. Click **Load more** at the bottom to continue. Pagination uses a fixed starting commit snapshot, so new commits do not appear inside an already loaded list.
- Search begins 300 milliseconds after you stop typing and covers the selected branch's complete history, not just loaded pages. It matches substrings in the subject, body, author name, author email, or full hash. Matching is case-insensitive and does not use regular expressions.
- Commit rows show the message, author, time, and short hash. The copy action copies the full hash for use in other tools.

**View files and choose a comparison parent:**

1. Select a commit to see its full message and changed-file tree.
2. Select a file to compare its content before and after that commit. Ordinary commits are compared with their parent; the initial commit is compared with an empty version.
3. Merge commits use the first parent by default. Choose another parent using its parent number and short hash; the file tree and diff update together.
4. When switching commits or parents, the selected file path stays selected if it still exists; otherwise, the first changed file is selected. If there are no changed files, an empty state appears.

History supports additions, modifications, deletions, renames, and permission changes. Renames retain the original path; a permission-only change may have identical file content. Binary files, non-UTF-8 text, files larger than 2 MiB, and submodules show an explanation instead of a normal text comparison. Historical content comes from Git objects, regardless of whether the working file has been changed or deleted.

The history view is labeled **Read-only history**. Files and directories have no staging, unstaging, or commit actions, and the view does not offer revert, cherry-pick, or history rewriting. Diffs default to inline and can switch to side by side. History diff mode and the three pane widths are saved separately from **Local changes**, while code font size uses the global setting.

**Refresh and session state:**

- While you read history, filesystem watching triggers a lightweight check. If the selected branch points to a new commit, the app shows **History has changed; refresh to view it** while preserving the current list and diff.
- Refresh reloads the first page, keeping the selected commit and file if they still appear in the new results. Failed reads preserve existing content and can be retried. If the filtered branch has been deleted, select another branch or the current branch.
- Checks are deferred while history is hidden and run on the next visit. Ordinary local-state refreshes do not clear loaded history.
- Each worktree keeps its history filter, search, commit, parent, and file selection for the current session. Switching between **Local changes / Commit history** preserves their selections and commit drafts. Historical content and browsing sessions are not persisted locally; they are read again after relaunch.

## 9. Refreshing and settings

The app watches files and Git metadata for the active worktree, including shared refs for linked worktrees. After external edits, staging, commits, or ref updates, it combines changes and rereads local state automatically:

- Wait 1 second after the last filesystem event. After each automatic refresh completes, wait at least another 5 seconds before the next one. This is a cooldown, not fixed-interval polling.
- Defer refreshes while the window is in the background or a Git write is in progress. Process accumulated changes when the app is back in the foreground and idle. Switching windows without any changes does not trigger a refresh.
- Preserve the selected file, scroll position for the same diff, and commit draft. On a failed read, keep the previous result and show a message. If the selected file no longer has changes, select another changed file.
- In-app staging, unstaging, and commits still refresh state immediately without waiting for the automatic-refresh cooldown.

**Refresh** in the top bar reads the latest state for the current view. In history, it reloads the first page as described above. If watching fails, refresh manually, then relaunch the app to restore watching. Automatic refresh does not contact remote servers; click **Fetch** to update remote refs.

**Settings** at the bottom left shows the current version and lets you change code font size or restore the default layout, font size, and diff mode. Layout, reading preferences, and repository paths are saved on the current device; commit drafts last only for the current session. Restoring the default layout does not clear remembered repositories.

Since 1.4.0, **Settings → Interface language** provides language options, with **中文简体 / 中文繁體 / English**, defaulting to Simplified Chinese. The interface updates immediately and retains your choice on the next launch. Restoring the default layout or resetting demo data does not reset the language. Switching languages leaves repository paths, branches, authors, commit messages, file contents, and raw Git output unchanged. System menus and standard system-dialog buttons follow the operating system.

## 10. Keyboard shortcuts

| Context | Shortcut |
| --- | --- |
| Commit form | `⌘ Enter` / `Ctrl Enter` commits staged content |
| Branch selector | `↑` / `↓` selects, `Enter` switches, `Esc` closes |
| Dialog | `Esc` closes |

Manual refresh, file staging, and directory staging currently use the interface buttons.

## 11. Troubleshooting

| Symptom | What to check |
| --- | --- |
| Git cannot be found | Run `git --version` in a terminal and install Command Line Tools if prompted by macOS |
| The directory is not a Git repository | Select an initialized repository and check its path and access permissions |
| Missing worktrees or stale state | Refresh; check `git worktree list` and confirm that the directories exist |
| A new remote branch is missing | Click **Fetch** to update remote refs |
| A branch is in use or switching fails | Check the occupying worktree or Git error; resolve uncommitted edits without forcing files to be overwritten |
| Staging fails because of a lock | Wait for other Git operations to finish, identify the lock's owner before handling it, then refresh |
| A commit fails | Resolve author, hook, or signing errors; the draft is preserved |
| A hook reports `npx: command not found` | Confirm that `node --version` and `npx --version` work in a login terminal, check shell initialization, then quit with `⌘Q` and reopen the app |
| Content is unchanged after returning to the app | Automatic updates require a detected change. Wait for debounce/cooldown, then refresh manually and check for watching errors if needed |
| Commit history is disabled or Merge is missing | Upgrade to the v1.1.0 desktop app or later and open a local repository; the browser demo has no merge action |
| History reports an update but the list is unchanged | Refresh to load the new commit snapshot; the app preserves your current reading position until then |
| History search has no results | Check the selected branch and keyword. Search covers only commits reachable from that branch, not every branch combined |
| Reading a history branch fails | The branch may have been deleted externally; select another existing branch or the current branch and retry |
| Remote buttons are unavailable | Upgrade to v1.3.0 or later, open a real repository, and configure a remote. Pull also requires an upstream; push requires at least one commit and an attached branch |

If the problem persists, open an [issue](https://github.com/asd116725/git-workbench/issues) with the app version, system/chip, reproduction steps, and sanitized error details. Back up important edits first. Do not upload credentials, private repository source code, or personal paths.
