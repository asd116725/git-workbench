use super::*;
use tempfile::TempDir;

#[path = "branch_management_tests.rs"]
mod branch_management_tests;

fn stage(repo: &Path, path: &str) -> GitResult<()> {
    stage_paths(repo, &[path.into()])
}
fn unstage(repo: &Path, path: &str) -> GitResult<()> {
    unstage_paths(repo, &[path.into()])
}

struct Fixture {
    _directory: TempDir,
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let fixture = Self {
            root: fs::canonicalize(directory.path()).unwrap(),
            _directory: directory,
        };
        let repo = fixture.path();
        git(repo, &["init", "-b", "main"]).unwrap();
        git(repo, &["config", "user.name", "Git Workbench Test"]).unwrap();
        git(
            repo,
            &["config", "user.email", "workbench-test@example.invalid"],
        )
        .unwrap();
        git(repo, &["config", "commit.gpgSign", "false"]).unwrap();
        git(repo, &["config", "core.autocrlf", "false"]).unwrap();
        fs::create_dir(repo.join(".git/test-hooks")).unwrap();
        git(repo, &["config", "core.hooksPath", ".git/test-hooks"]).unwrap();
        fixture
    }
    fn path(&self) -> &Path {
        &self.root
    }
    fn write(&self, path: &str, content: impl AsRef<[u8]>) {
        let full = self.path().join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, content).unwrap();
    }
    fn initial_commit(&self) {
        git(self.path(), &["add", "-A"]).unwrap();
        git(self.path(), &["commit", "-m", "初始提交"]).unwrap();
    }
}

#[test]
fn unborn_stage_unstage_and_commit_preserves_working_changes() {
    let fixture = Fixture::new();
    fixture.write("说明 文件.txt", "第一版\n");
    let initial = status(fixture.path()).unwrap();
    assert!(!initial.has_head);
    assert_eq!(initial.branch, "main");
    assert_eq!(initial.files[0].status_index, "?");
    let preview = diff(fixture.path(), "说明 文件.txt", ChangeArea::Unstaged).unwrap();
    assert_eq!(preview.original, None);
    assert_eq!(preview.modified.as_deref(), Some("第一版\n"));
    stage(fixture.path(), "说明 文件.txt").unwrap();
    unstage(fixture.path(), "说明 文件.txt").unwrap();
    assert!(fixture.path().join("说明 文件.txt").exists());
    assert_eq!(changes(fixture.path()).unwrap()[0].status_index, "?");
    stage(fixture.path(), "说明 文件.txt").unwrap();
    fixture.write("说明 文件.txt", "第二版\n");
    let staged = diff(fixture.path(), "说明 文件.txt", ChangeArea::Staged).unwrap();
    assert_eq!(staged.modified.as_deref(), Some("第一版\n"));
    let unstaged = diff(fixture.path(), "说明 文件.txt", ChangeArea::Unstaged).unwrap();
    assert_eq!(unstaged.original.as_deref(), Some("第一版\n"));
    assert_eq!(unstaged.modified.as_deref(), Some("第二版\n"));
    let result = commit(fixture.path(), "  新增文件  ", "详细说明").unwrap();
    assert_eq!(
        result.commit_id,
        git_line(fixture.path(), &["rev-parse", "HEAD"]).unwrap()
    );
    assert_eq!(
        git_line(fixture.path(), &["log", "-1", "--format=%B"])
            .unwrap()
            .trim(),
        "新增文件\n\n详细说明"
    );
    assert_eq!(
        git(fixture.path(), &["show", "HEAD:说明 文件.txt"]).unwrap(),
        "第一版\n".as_bytes()
    );
    assert_eq!(changes(fixture.path()).unwrap()[0].status_worktree, "M");
}

#[test]
fn staged_and_working_versions_remain_independent() {
    let fixture = Fixture::new();
    fixture.write("file.txt", "head\n");
    fixture.initial_commit();
    fixture.write("file.txt", "index\n");
    stage(fixture.path(), "file.txt").unwrap();
    fixture.write("file.txt", "working\n");
    let file = changes(fixture.path()).unwrap().remove(0);
    assert_eq!(
        (file.status_index.as_str(), file.status_worktree.as_str()),
        ("M", "M")
    );
    let staged = diff(fixture.path(), "file.txt", ChangeArea::Staged).unwrap();
    assert_eq!(
        (staged.original.as_deref(), staged.modified.as_deref()),
        (Some("head\n"), Some("index\n"))
    );
    unstage(fixture.path(), "file.txt").unwrap();
    assert_eq!(
        fs::read_to_string(fixture.path().join("file.txt")).unwrap(),
        "working\n"
    );
    assert_eq!(
        git(fixture.path(), &["show", ":file.txt"]).unwrap(),
        b"head\n"
    );
}

#[test]
fn deleted_files_and_staged_renames_use_correct_paths() {
    let fixture = Fixture::new();
    fixture.write("旧 名.txt", "contents\n");
    fixture.write("deleted.txt", "delete me\n");
    fixture.initial_commit();
    fs::remove_file(fixture.path().join("deleted.txt")).unwrap();
    let deleted = diff(fixture.path(), "deleted.txt", ChangeArea::Unstaged).unwrap();
    assert_eq!(deleted.modified, None);
    stage(fixture.path(), "deleted.txt").unwrap();
    let staged = diff(fixture.path(), "deleted.txt", ChangeArea::Staged).unwrap();
    assert_eq!(staged.original.as_deref(), Some("delete me\n"));
    assert_eq!(staged.modified, None);
    unstage(fixture.path(), "deleted.txt").unwrap();
    assert!(!fixture.path().join("deleted.txt").exists());
    git(fixture.path(), &["mv", "--", "旧 名.txt", "新\n名.txt"]).unwrap();
    let renamed = changes(fixture.path())
        .unwrap()
        .into_iter()
        .find(|file| file.path == "新\n名.txt")
        .unwrap();
    assert_eq!(renamed.status_index, "R");
    assert_eq!(renamed.original_path.as_deref(), Some("旧 名.txt"));
    let preview = diff(fixture.path(), "新\n名.txt", ChangeArea::Staged).unwrap();
    assert!(preview.notice.unwrap().contains("路径"));
    stage(fixture.path(), "新\n名.txt").unwrap();
    unstage(fixture.path(), "新\n名.txt").unwrap();
    assert_eq!(
        git(fixture.path(), &["show", ":旧 名.txt"]).unwrap(),
        b"contents\n"
    );
    assert!(fixture.path().join("新\n名.txt").exists());
}

#[test]
fn literal_paths_do_not_expand_git_pathspecs() {
    let fixture = Fixture::new();
    for name in [":(glob)*", "a[1].txt", "other.txt"] {
        fixture.write(name, name);
    }
    stage(fixture.path(), ":(glob)*").unwrap();
    let files = changes(fixture.path()).unwrap();
    assert_eq!(
        files.iter().filter(|file| file.status_index == "A").count(),
        1
    );
    assert_eq!(
        files
            .iter()
            .find(|file| file.path == "other.txt")
            .unwrap()
            .status_index,
        "?"
    );
    assert!(stage(fixture.path(), "../outside").is_err());
    assert!(stage(fixture.path(), "/etc/passwd").is_err());
    assert!(stage(fixture.path(), "missing.txt").is_err());
}

#[test]
fn binary_and_large_files_show_notices_without_text() {
    let fixture = Fixture::new();
    fixture.write("binary.bin", [0_u8, 1, 2]);
    fixture.write("large.txt", vec![b'x'; MAX_DIFF_BYTES as usize + 1]);
    fixture.write("legacy.txt", [0xff_u8, 0xfe]);
    for name in ["binary.bin", "large.txt", "legacy.txt"] {
        let preview = diff(fixture.path(), name, ChangeArea::Unstaged).unwrap();
        assert!(preview.notice.is_some());
        assert!(preview.original.is_none() && preview.modified.is_none());
        stage(fixture.path(), name).unwrap();
        assert!(
            diff(fixture.path(), name, ChangeArea::Staged)
                .unwrap()
                .notice
                .is_some()
        );
    }
}

#[test]
fn nested_directory_linked_worktree_and_detached_head_are_supported() {
    let fixture = Fixture::new();
    fixture.write("nested/file.txt", "initial");
    fixture.initial_commit();
    let nested = repository_root(fixture.path().join("nested").to_str().unwrap()).unwrap();
    assert_eq!(nested, fs::canonicalize(fixture.path()).unwrap());
    let linked_parent = tempfile::tempdir().unwrap();
    let linked_path = linked_parent.path().join("linked repo");
    git(
        fixture.path(),
        &[
            "worktree",
            "add",
            "-b",
            "feature",
            linked_path.to_str().unwrap(),
        ],
    )
    .unwrap();
    let linked = with_repository(linked_path.to_str().unwrap(), status).unwrap();
    assert_eq!(linked.branch, "feature");
    assert_eq!(
        linked.path,
        fs::canonicalize(&linked_path).unwrap().to_string_lossy()
    );
    git(fixture.path(), &["checkout", "--detach"]).unwrap();
    assert!(
        status(fixture.path())
            .unwrap()
            .branch
            .starts_with("分离 HEAD")
    );
    let not_repo = tempfile::tempdir().unwrap();
    assert!(repository_root(not_repo.path().to_str().unwrap()).is_err());
}

#[cfg(unix)]
#[test]
fn symlinks_display_link_target_without_reading_external_content() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let external = tempfile::tempdir().unwrap();
    fs::write(external.path().join("secret"), "outside content").unwrap();
    let target = external.path().join("secret");
    symlink(&target, fixture.path().join("link")).unwrap();
    let preview = diff(fixture.path(), "link", ChangeArea::Unstaged).unwrap();
    assert_eq!(preview.modified.as_deref(), target.to_str());
    assert!(!preview.modified.unwrap().contains("outside content"));
}

#[cfg(unix)]
#[test]
fn failed_commit_hook_keeps_index_and_head_intact() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    fixture.write("file.txt", "first");
    fixture.initial_commit();
    let before = git_line(fixture.path(), &["rev-parse", "HEAD"]).unwrap();
    fixture.write("file.txt", "second");
    stage(fixture.path(), "file.txt").unwrap();
    let hook = fixture.path().join(".git/test-hooks/pre-commit");
    fs::write(&hook, "#!/bin/sh\ncat .git/test-hook-output >&2\nexit 1\n").unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    for detail in [
        "test hook rejected\n",
        "今天",
        "请填写提交信息。",
        "  文件/今天 {error}\n请填写提交信息。\n",
    ] {
        fixture.write(".git/test-hook-output", detail);
        let error = commit(fixture.path(), "失败提交", "").unwrap_err();
        assert_eq!(error, format!("Git:\n{detail}"));
    }
    assert_eq!(
        git_line(fixture.path(), &["rev-parse", "HEAD"]).unwrap(),
        before
    );
    assert_eq!(changes(fixture.path()).unwrap()[0].status_index, "M");
}

#[cfg(unix)]
#[test]
fn checked_preserves_raw_output_and_marks_failed_git_source() {
    use std::os::unix::process::ExitStatusExt;
    use std::process::ExitStatus;

    let output = |status, stdout: &[u8], stderr: &[u8]| Output {
        status: ExitStatus::from_raw(status),
        stdout: stdout.into(),
        stderr: stderr.into(),
    };
    assert_eq!(
        checked(output(0, "今天\n".as_bytes(), b"warning")).unwrap(),
        "今天\n".as_bytes()
    );
    assert_eq!(
        checked(output(1 << 8, "今天\n".as_bytes(), b" \n")).unwrap_err(),
        "Git:\n今天\n"
    );
    assert_eq!(
        checked(output(1 << 8, b"ignored", " 请填写提交信息。\n".as_bytes())).unwrap_err(),
        "Git:\n 请填写提交信息。\n"
    );
}

#[cfg(target_os = "macos")]
#[test]
fn gui_launch_loads_login_path_once_and_runs_commit_hooks() {
    use std::os::unix::fs::PermissionsExt;

    // 在独立进程中模拟 Finder 的系统 PATH，避免修改并行测试共用的环境。
    if let Some(home) = std::env::var_os("GIT_WORKBENCH_TEST_HOME") {
        let home = PathBuf::from(home);
        let fixture = Fixture::new();
        fixture.write("file.txt", "first");
        fixture.initial_commit();
        fixture.write("file.txt", "second");
        stage(fixture.path(), "file.txt").unwrap();
        let hook = fixture.path().join(".git/test-hooks/pre-commit");
        fs::write(
            &hook,
            "#!/bin/sh\ntest -z \"$WORKBENCH_SHELL_PRIVATE\" || exit 1\nnpx > hook-result.txt\n",
        )
        .unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();

        commit(fixture.path(), "运行提交检查", "").unwrap();
        assert_eq!(
            fs::read_to_string(fixture.path().join("hook-result.txt")).unwrap(),
            "login and interactive tools found\n"
        );
        assert_eq!(fs::read_to_string(home.join("login-count")).unwrap(), "x");

        let before = git_line(fixture.path(), &["rev-parse", "HEAD"]).unwrap();
        fixture.write("file.txt", "third");
        stage(fixture.path(), "file.txt").unwrap();
        fs::write(
            &hook,
            "#!/bin/sh\nnpx >/dev/null || exit $?\necho 'hook rejected after finding npx' >&2\nexit 1\n",
        )
        .unwrap();
        let error = commit(fixture.path(), "不应提交", "").unwrap_err();
        assert!(error.contains("hook rejected after finding npx"), "{error}");
        assert_eq!(
            git_line(fixture.path(), &["rev-parse", "HEAD"]).unwrap(),
            before
        );
        assert_eq!(changes(fixture.path()).unwrap()[0].status_index, "M");
        return;
    }

    let home = tempfile::Builder::new()
        .prefix("workbench shell ")
        .tempdir()
        .unwrap();
    fs::write(
        home.path().join(".zprofile"),
        "printf 'startup noise\\n'\nprintf x >> \"$HOME/login-count\"\nexport WORKBENCH_SHELL_PRIVATE=private\nexport PATH=\"$HOME/login bin:$PATH\"\n",
    )
    .unwrap();
    fs::write(
        home.path().join(".zshrc"),
        "export PATH=\"$HOME/interactive bin:$PATH\"\n",
    )
    .unwrap();
    for (name, script) in [
        (
            "login bin/login-tool",
            "#!/bin/sh\nprintf 'login and interactive tools found\\n'\n",
        ),
        ("interactive bin/npx", "#!/bin/sh\nexec login-tool\n"),
    ] {
        let executable = home.path().join(name);
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::write(&executable, script).unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "git::tests::gui_launch_loads_login_path_once_and_runs_commit_hooks",
            "--nocapture",
        ])
        .env("GIT_WORKBENCH_TEST_HOME", home.path())
        .env("HOME", home.path())
        .env("ZDOTDIR", home.path())
        .env("SHELL", "/bin/zsh")
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env_remove("WORKBENCH_SHELL_PRIVATE")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn conflicting_files_are_reported_and_commit_is_rejected() {
    let fixture = Fixture::new();
    fixture.write("conflict.txt", "base\n");
    fixture.initial_commit();
    git(fixture.path(), &["checkout", "-b", "other"]).unwrap();
    fixture.write("conflict.txt", "other\n");
    fixture.initial_commit();
    git(fixture.path(), &["checkout", "main"]).unwrap();
    fixture.write("conflict.txt", "main\n");
    fixture.initial_commit();
    assert!(
        !run_git(fixture.path(), &["merge", "other"])
            .unwrap()
            .status
            .success()
    );
    assert!(changes(fixture.path()).unwrap()[0].conflicted);
    assert!(
        diff(fixture.path(), "conflict.txt", ChangeArea::Unstaged)
            .unwrap()
            .notice
            .unwrap()
            .contains("冲突")
    );
    assert!(
        commit(fixture.path(), "尚未解决", "")
            .unwrap_err()
            .contains("冲突")
    );
    fixture.write("conflict.txt", "resolved\n");
    stage(fixture.path(), "conflict.txt").unwrap();
    assert!(!changes(fixture.path()).unwrap()[0].conflicted);
    assert!(commit(fixture.path(), "解决冲突", "").is_err());
    let pending = operation(fixture.path()).unwrap().unwrap();
    let result = tauri::async_runtime::block_on(merge::git_merge_continue(
        fixture.root.to_string_lossy().into_owned(),
        pending.head.clone(),
        pending.merge_heads.clone(),
        "解决冲突".into(),
    ))
    .unwrap();
    assert_eq!(result.outcome, "merged");
    assert_eq!(
        git_line(fixture.path(), &["show", "-s", "--format=%P", "HEAD"]).unwrap(),
        format!("{} {}", pending.head, pending.merge_heads[0])
    );
}

#[test]
fn submodule_changes_show_notice() {
    let fixture = Fixture::new();
    let module = Fixture::new();
    module.write("file.txt", "submodule");
    module.initial_commit();
    git(
        fixture.path(),
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            module.path().to_str().unwrap(),
            "module",
        ],
    )
    .unwrap();
    fixture.initial_commit();
    fs::write(fixture.path().join("module/file.txt"), "modified").unwrap();
    assert!(
        diff(fixture.path(), "module", ChangeArea::Unstaged)
            .unwrap()
            .notice
            .unwrap()
            .contains("子模块")
    );
}

#[test]
fn staged_deletion_and_recreated_untracked_file_share_one_status_row() {
    let fixture = Fixture::new();
    fixture.write("file.txt", "original\n");
    fixture.initial_commit();
    git(fixture.path(), &["rm", "--cached", "--", "file.txt"]).unwrap();
    fixture.write("file.txt", "recreated\n");
    let files = changes(fixture.path()).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(
        (
            files[0].status_index.as_str(),
            files[0].status_worktree.as_str()
        ),
        ("D", "?")
    );
    let staged = diff(fixture.path(), "file.txt", ChangeArea::Staged).unwrap();
    assert_eq!(staged.original.as_deref(), Some("original\n"));
    assert_eq!(staged.modified, None);
    let unstaged = diff(fixture.path(), "file.txt", ChangeArea::Unstaged).unwrap();
    assert_eq!(unstaged.original, None);
    assert_eq!(unstaged.modified.as_deref(), Some("recreated\n"));
    stage(fixture.path(), "file.txt").unwrap();
    assert_eq!(changes(fixture.path()).unwrap()[0].status_index, "M");
}

#[cfg(unix)]
#[test]
fn executable_mode_only_change_has_an_explicit_notice() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    git(fixture.path(), &["config", "core.fileMode", "true"]).unwrap();
    fixture.write("script.sh", "#!/bin/sh\necho hello\n");
    fs::set_permissions(
        fixture.path().join("script.sh"),
        fs::Permissions::from_mode(0o644),
    )
    .unwrap();
    fixture.initial_commit();
    fs::set_permissions(
        fixture.path().join("script.sh"),
        fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    let working = diff(fixture.path(), "script.sh", ChangeArea::Unstaged).unwrap();
    assert!(
        working
            .notice
            .unwrap()
            .contains("mode change 100644 => 100755")
    );
    stage(fixture.path(), "script.sh").unwrap();
    let staged = diff(fixture.path(), "script.sh", ChangeArea::Staged).unwrap();
    assert!(
        staged
            .notice
            .unwrap()
            .contains("mode change 100644 => 100755")
    );
}

#[cfg(unix)]
#[test]
fn changing_symlink_to_file_reads_only_the_new_working_file() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    symlink("target.txt", fixture.path().join("link")).unwrap();
    fixture.initial_commit();
    fs::remove_file(fixture.path().join("link")).unwrap();
    fixture.write("link", "plain text\n");
    let working = diff(fixture.path(), "link", ChangeArea::Unstaged).unwrap();
    assert_eq!(working.original.as_deref(), Some("target.txt"));
    assert_eq!(working.modified.as_deref(), Some("plain text\n"));
    stage(fixture.path(), "link").unwrap();
    let staged = diff(fixture.path(), "link", ChangeArea::Staged).unwrap();
    assert_eq!(staged.original.as_deref(), Some("target.txt"));
    assert_eq!(staged.modified.as_deref(), Some("plain text\n"));
}

#[test]
fn staging_deleted_file_replaced_by_directory_does_not_stage_children() {
    let fixture = Fixture::new();
    fixture.write("swap", "original\n");
    fixture.initial_commit();
    fs::remove_file(fixture.path().join("swap")).unwrap();
    fixture.write("swap/child.txt", "new child\n");
    stage(fixture.path(), "swap").unwrap();
    let files = changes(fixture.path()).unwrap();
    assert_eq!(
        files
            .iter()
            .find(|file| file.path == "swap")
            .unwrap()
            .status_index,
        "D"
    );
    assert_eq!(
        files
            .iter()
            .find(|file| file.path == "swap/child.txt")
            .unwrap()
            .status_index,
        "?"
    );
    assert!(git(fixture.path(), &["ls-files", "-z"]).unwrap().is_empty());
    assert!(fixture.path().join("swap/child.txt").exists());
}

#[test]
fn unstaging_file_replacing_directory_keeps_child_deletion_staged() {
    let fixture = Fixture::new();
    fixture.write("swap/child.txt", "original\n");
    fixture.initial_commit();
    fs::remove_dir_all(fixture.path().join("swap")).unwrap();
    fixture.write("swap", "new file\n");
    git(fixture.path(), &["add", "-A"]).unwrap();
    unstage(fixture.path(), "swap").unwrap();
    let files = changes(fixture.path()).unwrap();
    assert_eq!(
        files
            .iter()
            .find(|file| file.path == "swap")
            .unwrap()
            .status_index,
        "?"
    );
    assert_eq!(
        files
            .iter()
            .find(|file| file.path == "swap/child.txt")
            .unwrap()
            .status_index,
        "D"
    );
    assert!(git(fixture.path(), &["ls-files", "-z"]).unwrap().is_empty());
}

#[test]
fn unstaging_deleted_file_refuses_to_replace_staged_directory_children() {
    let fixture = Fixture::new();
    fixture.write("swap", "original\n");
    fixture.initial_commit();
    fs::remove_file(fixture.path().join("swap")).unwrap();
    fixture.write("swap/child.txt", "new child\n");
    git(fixture.path(), &["add", "-A"]).unwrap();
    let before = git(fixture.path(), &["ls-files", "--stage", "-z"]).unwrap();
    assert!(unstage(fixture.path(), "swap").is_err());
    assert_eq!(
        git(fixture.path(), &["ls-files", "--stage", "-z"]).unwrap(),
        before
    );
    assert!(fixture.path().join("swap/child.txt").exists());
}

#[test]
fn staging_new_file_requires_staging_conflicting_child_deletions_first() {
    let fixture = Fixture::new();
    fixture.write("swap/child.txt", "original\n");
    fixture.initial_commit();
    fs::remove_dir_all(fixture.path().join("swap")).unwrap();
    fixture.write("swap", "new file\n");
    let before = git(fixture.path(), &["ls-files", "--stage", "-z"]).unwrap();
    assert!(stage(fixture.path(), "swap").is_err());
    assert_eq!(
        git(fixture.path(), &["ls-files", "--stage", "-z"]).unwrap(),
        before
    );
    stage(fixture.path(), "swap/child.txt").unwrap();
    stage(fixture.path(), "swap").unwrap();
    assert_eq!(git(fixture.path(), &["ls-files", "-z"]).unwrap(), b"swap\0");
}

#[test]
fn staging_new_child_requires_staging_conflicting_parent_deletion_first() {
    let fixture = Fixture::new();
    fixture.write("swap", "original\n");
    fixture.initial_commit();
    fs::remove_file(fixture.path().join("swap")).unwrap();
    fixture.write("swap/child.txt", "new child\n");
    let before = git(fixture.path(), &["ls-files", "--stage", "-z"]).unwrap();
    assert!(stage(fixture.path(), "swap/child.txt").is_err());
    assert_eq!(
        git(fixture.path(), &["ls-files", "--stage", "-z"]).unwrap(),
        before
    );
    stage(fixture.path(), "swap").unwrap();
    stage(fixture.path(), "swap/child.txt").unwrap();
    assert_eq!(
        git(fixture.path(), &["ls-files", "-z"]).unwrap(),
        b"swap/child.txt\0"
    );
}

#[test]
fn worktrees_share_repository_identity_and_preserve_unavailable_entries() {
    let fixture = Fixture::new();
    fixture.write("file.txt", "base\n");
    fixture.initial_commit();
    let parent = tempfile::tempdir().unwrap();
    let linked = parent.path().join("linked 中文\nworktree");
    git(
        fixture.path(),
        &["worktree", "add", "-b", "feature", linked.to_str().unwrap()],
    )
    .unwrap();
    let detached = parent.path().join("detached");
    git(
        fixture.path(),
        &["worktree", "add", "--detach", detached.to_str().unwrap()],
    )
    .unwrap();
    git(
        fixture.path(),
        &[
            "worktree",
            "lock",
            "--reason",
            "外接磁盘\n保留",
            linked.to_str().unwrap(),
        ],
    )
    .unwrap();
    let main_status = status(fixture.path()).unwrap();
    let linked_status = with_repository(linked.to_str().unwrap(), status).unwrap();
    assert_eq!(main_status.common_dir, linked_status.common_dir);
    assert_eq!(main_status.repository_name, linked_status.repository_name);
    assert_eq!(main_status.worktrees.len(), 3);
    assert!(main_status.worktrees[0].is_main && main_status.worktrees[0].available);
    let linked_info = main_status
        .worktrees
        .iter()
        .find(|entry| entry.branch == "feature")
        .unwrap();
    assert_eq!(
        linked_info.path,
        fs::canonicalize(&linked).unwrap().to_string_lossy()
    );
    assert_eq!(linked_info.locked.as_deref(), Some("外接磁盘\n保留"));
    assert!(linked_info.available);
    assert!(
        main_status
            .worktrees
            .iter()
            .any(|entry| entry.detached && entry.available)
    );
    fs::remove_dir_all(&linked).unwrap();
    fs::remove_dir_all(&detached).unwrap();
    let missing = status(fixture.path()).unwrap();
    assert_eq!(missing.worktrees.len(), 3);
    assert!(
        missing
            .worktrees
            .iter()
            .filter(|entry| !entry.is_main)
            .all(|entry| !entry.available)
    );
    assert!(
        missing
            .worktrees
            .iter()
            .find(|entry| entry.detached)
            .unwrap()
            .prunable
            .is_some()
    );
    assert!(
        missing
            .worktrees
            .iter()
            .find(|entry| entry.branch == "feature")
            .unwrap()
            .locked
            .is_some()
    );
}

#[test]
fn worktree_list_preserves_bare_source_when_opened_from_linked_checkout() {
    let fixture = Fixture::new();
    fixture.write("file.txt", "base");
    fixture.initial_commit();
    let parent = tempfile::tempdir().unwrap();
    let bare = parent.path().join("origin.git");
    git(
        fixture.path(),
        &[
            "clone",
            "--bare",
            fixture.path().to_str().unwrap(),
            bare.to_str().unwrap(),
        ],
    )
    .unwrap();
    let linked = parent.path().join("linked");
    git(
        &bare,
        &["worktree", "add", linked.to_str().unwrap(), "main"],
    )
    .unwrap();
    let repository = with_repository(linked.to_str().unwrap(), status).unwrap();
    assert_eq!(repository.repository_name, "origin");
    assert!(
        repository.worktrees[0].bare
            && repository.worktrees[0].is_main
            && !repository.worktrees[0].available
    );
    assert!(repository.worktrees[1].available);
}

#[test]
fn branches_sort_by_tip_commit_time_and_include_commit_details() {
    let fixture = Fixture::new();
    assert!(branches(fixture.path()).unwrap().is_empty());
    let commit_at = |subject: &str, author_date: &str, commit_date: &str| {
        let output = command(fixture.path())
            .args([
                "commit",
                "--allow-empty",
                "-m",
                subject,
                "-m",
                "详细正文不应混入第二行",
            ])
            .env("GIT_AUTHOR_NAME", "测试作者")
            .env("GIT_AUTHOR_DATE", author_date)
            .env("GIT_COMMITTER_DATE", commit_date)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    commit_at("初始提交", "1700000000 +0000", "1700000000 +0000");
    git(fixture.path(), &["switch", "-c", "a-old"]).unwrap();
    commit_at("较早提交", "1800000000 +0000", "1700000100 +0000");
    git(fixture.path(), &["switch", "-c", "z-new"]).unwrap();
    let subject = "feat: 中文 · 支持 \"引号\" 和 | 分隔符";
    commit_at(subject, "1600000000 +0000", "1700000200 +0000");
    git(fixture.path(), &["branch", "m-tie"]).unwrap();
    git(fixture.path(), &["remote", "add", "origin", "/unused"]).unwrap();
    git(
        fixture.path(),
        &["update-ref", "refs/remotes/origin/new", "HEAD"],
    )
    .unwrap();

    let listed = branches(fixture.path()).unwrap();
    assert_eq!(
        listed
            .iter()
            .map(|branch| branch.name.as_str())
            .collect::<Vec<_>>(),
        ["m-tie", "z-new", "origin/new", "a-old", "main"]
    );
    let hash = git_line(fixture.path(), &["rev-parse", "--short=7", "HEAD"]).unwrap();
    for branch in &listed[..3] {
        assert_eq!(branch.last_commit.short_hash, hash);
        assert_eq!(branch.last_commit.author, "测试作者");
        assert_eq!(branch.last_commit.subject, subject);
        assert_eq!(branch.last_commit.committed_at, 1700000200);
    }
    assert!(listed[1].current);
    assert_eq!(listed[2].kind, "remote");
}

#[test]
fn branch_listing_reports_current_remote_tracking_and_other_worktree() {
    let fixture = Fixture::new();
    fixture.write("file.txt", "base");
    fixture.initial_commit();
    let parent = tempfile::tempdir().unwrap();
    let linked = parent.path().join("feature");
    git(
        fixture.path(),
        &["worktree", "add", "-b", "feature", linked.to_str().unwrap()],
    )
    .unwrap();
    git(fixture.path(), &["remote", "add", "team-other", "/unused"]).unwrap();
    git(fixture.path(), &["remote", "add", "team/origin", "/unused"]).unwrap();
    git(
        fixture.path(),
        &["update-ref", "refs/remotes/team/origin/topic/中文", "HEAD"],
    )
    .unwrap();
    git(
        fixture.path(),
        &[
            "symbolic-ref",
            "refs/remotes/team/origin/HEAD",
            "refs/remotes/team/origin/topic/中文",
        ],
    )
    .unwrap();
    let listed = branches(fixture.path()).unwrap();
    assert_eq!(listed.len(), 3);
    assert!(
        listed
            .iter()
            .find(|branch| branch.name == "main")
            .unwrap()
            .current
    );
    let occupied = listed
        .iter()
        .find(|branch| branch.name == "feature")
        .unwrap();
    assert_eq!(
        occupied.worktree_path.as_deref(),
        fs::canonicalize(&linked).unwrap().to_str()
    );
    let remote = listed
        .iter()
        .find(|branch| branch.kind == "remote")
        .unwrap();
    assert_eq!(remote.local_name.as_deref(), Some("topic/中文"));
    assert_eq!(remote.full_name, "refs/remotes/team/origin/topic/中文");
    assert!(!remote.current);
    git(fixture.path(), &["switch", "--detach"]).unwrap();
    assert!(
        branches(fixture.path())
            .unwrap()
            .iter()
            .all(|branch| !branch.current)
    );
}

#[test]
fn switching_local_and_remote_branches_preserves_tracking_identity() {
    let fixture = Fixture::new();
    fixture.write("file.txt", "base");
    fixture.initial_commit();
    git(fixture.path(), &["branch", "feature"]).unwrap();
    assert_eq!(
        checkout(fixture.path(), "refs/heads/feature")
            .unwrap()
            .branch,
        "feature"
    );
    assert_eq!(status(fixture.path()).unwrap().branch, "feature");
    git(fixture.path(), &["remote", "add", "team/origin", "/unused"]).unwrap();
    git(
        fixture.path(),
        &["update-ref", "refs/remotes/team/origin/topic/中文", "HEAD"],
    )
    .unwrap();
    let remote = "refs/remotes/team/origin/topic/中文";
    assert_eq!(
        checkout(fixture.path(), remote).unwrap().branch,
        "topic/中文"
    );
    assert_eq!(
        git_line(
            fixture.path(),
            &["rev-parse", "--symbolic-full-name", "@{upstream}"]
        )
        .unwrap(),
        remote
    );
    checkout(fixture.path(), "refs/heads/main").unwrap();
    assert_eq!(
        checkout(fixture.path(), remote).unwrap().branch,
        "topic/中文"
    );
    assert_eq!(
        branches(fixture.path())
            .unwrap()
            .iter()
            .find(|branch| branch.full_name == remote)
            .unwrap()
            .worktree_path
            .as_deref(),
        fixture.path().to_str()
    );
}

#[test]
fn remote_branch_name_collision_and_worktree_occupancy_are_rejected() {
    let fixture = Fixture::new();
    fixture.write("file.txt", "base");
    fixture.initial_commit();
    git(fixture.path(), &["branch", "topic"]).unwrap();
    git(fixture.path(), &["remote", "add", "origin", "/unused"]).unwrap();
    git(
        fixture.path(),
        &["update-ref", "refs/remotes/origin/topic", "HEAD"],
    )
    .unwrap();
    assert!(
        checkout(fixture.path(), "refs/remotes/origin/topic")
            .unwrap_err()
            .contains("未跟踪")
    );
    let parent = tempfile::tempdir().unwrap();
    let linked = parent.path().join("linked");
    git(
        fixture.path(),
        &["worktree", "add", linked.to_str().unwrap(), "topic"],
    )
    .unwrap();
    assert!(
        checkout(fixture.path(), "refs/heads/topic")
            .unwrap_err()
            .contains("占用")
    );
    assert_eq!(status(fixture.path()).unwrap().branch, "main");
    assert!(checkout(fixture.path(), "main").is_err());
    assert!(checkout(fixture.path(), "refs/heads/main~1").is_err());
    assert!(checkout(fixture.path(), "--force").is_err());
}

#[test]
fn switch_rejects_overwriting_dirty_or_untracked_files_without_changing_head_or_index() {
    let fixture = Fixture::new();
    fixture.write("file.txt", "base\n");
    fixture.initial_commit();
    git(fixture.path(), &["switch", "-c", "other"]).unwrap();
    fixture.write("file.txt", "other\n");
    fixture.write("new.txt", "tracked on other\n");
    fixture.initial_commit();
    git(fixture.path(), &["switch", "main"]).unwrap();
    let before_head = git(fixture.path(), &["rev-parse", "HEAD"]).unwrap();
    fixture.write("file.txt", "dirty staged\n");
    stage(fixture.path(), "file.txt").unwrap();
    fixture.write("file.txt", "dirty working\n");
    let before_index = git(fixture.path(), &["ls-files", "--stage", "-z"]).unwrap();
    assert!(checkout(fixture.path(), "refs/heads/other").is_err());
    assert_eq!(
        git(fixture.path(), &["rev-parse", "HEAD"]).unwrap(),
        before_head
    );
    assert_eq!(
        git(fixture.path(), &["ls-files", "--stage", "-z"]).unwrap(),
        before_index
    );
    assert_eq!(
        fs::read_to_string(fixture.path().join("file.txt")).unwrap(),
        "dirty working\n"
    );
    // 仅还原测试夹具文件，继续覆盖未跟踪文件保护场景。
    fixture.write("file.txt", "base\n");
    stage(fixture.path(), "file.txt").unwrap();
    fixture.write("new.txt", "untracked local\n");
    assert!(checkout(fixture.path(), "refs/heads/other").is_err());
    assert_eq!(
        git(fixture.path(), &["rev-parse", "HEAD"]).unwrap(),
        before_head
    );
    assert_eq!(
        fs::read_to_string(fixture.path().join("new.txt")).unwrap(),
        "untracked local\n"
    );
    assert_eq!(changes(fixture.path()).unwrap()[0].status_index, "?");
}

#[test]
fn failed_remote_checkout_does_not_create_branch_or_upstream_config() {
    let fixture = Fixture::new();
    fixture.write("file.txt", "base\n");
    fixture.initial_commit();
    git(fixture.path(), &["switch", "-c", "source"]).unwrap();
    fixture.write("file.txt", "remote\n");
    fixture.initial_commit();
    git(fixture.path(), &["remote", "add", "origin", "/unused"]).unwrap();
    git(
        fixture.path(),
        &["update-ref", "refs/remotes/origin/topic", "HEAD"],
    )
    .unwrap();
    git(fixture.path(), &["switch", "main"]).unwrap();
    fixture.write("file.txt", "dirty\n");
    assert!(checkout(fixture.path(), "refs/remotes/origin/topic").is_err());
    assert!(
        !run_git(
            fixture.path(),
            &["show-ref", "--verify", "refs/heads/topic"]
        )
        .unwrap()
        .status
        .success()
    );
    assert!(
        !run_git(fixture.path(), &["config", "--get", "branch.topic.remote"])
            .unwrap()
            .status
            .success()
    );
    assert_eq!(status(fixture.path()).unwrap().branch, "main");
}

#[cfg(unix)]
#[test]
fn checkout_hook_failure_reports_successful_switch_with_warning() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    fixture.write("file.txt", "base");
    fixture.initial_commit();
    git(fixture.path(), &["branch", "target"]).unwrap();
    let hook = fixture.path().join(".git/test-hooks/post-checkout");
    fs::write(
        &hook,
        "#!/bin/sh\necho 'post-checkout rejected' >&2\nexit 1\n",
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    let result = checkout(fixture.path(), "refs/heads/target").unwrap();
    assert_eq!(result.branch, "target");
    assert!(result.warning.unwrap().contains("post-checkout rejected"));
    assert_eq!(status(fixture.path()).unwrap().branch, "target");
}

#[cfg(unix)]
#[test]
fn remote_checkout_hook_failure_keeps_created_tracking_branch_and_reports_warning() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    fixture.write("file.txt", "base");
    fixture.initial_commit();
    git(fixture.path(), &["remote", "add", "origin", "/unused"]).unwrap();
    git(
        fixture.path(),
        &["update-ref", "refs/remotes/origin/topic", "HEAD"],
    )
    .unwrap();
    let hook = fixture.path().join(".git/test-hooks/post-checkout");
    fs::write(
        &hook,
        "#!/bin/sh\necho 'post-checkout rejected' >&2\nexit 1\n",
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    let result = checkout(fixture.path(), "refs/remotes/origin/topic").unwrap();
    assert_eq!(result.branch, "topic");
    assert!(result.warning.unwrap().contains("post-checkout rejected"));
    assert_eq!(
        git_line(
            fixture.path(),
            &["rev-parse", "--symbolic-full-name", "@{upstream}"]
        )
        .unwrap(),
        "refs/remotes/origin/topic"
    );
    // 已经位于目标分支时，hook 失败不能伪装为一次成功的切换。
    assert!(checkout(fixture.path(), "refs/heads/topic").is_err());
}

#[test]
fn batch_stage_handles_directory_replacements_without_order_dependency() {
    for parent_was_file in [true, false] {
        let fixture = Fixture::new();
        let (before, after) = if parent_was_file {
            ("swap", "swap/child.txt")
        } else {
            ("swap/child.txt", "swap")
        };
        fixture.write(before, "before\n");
        fixture.write("unselected.txt", "before\n");
        fixture.initial_commit();
        if parent_was_file {
            fs::remove_file(fixture.path().join("swap")).unwrap();
        } else {
            fs::remove_dir_all(fixture.path().join("swap")).unwrap();
        }
        fixture.write(after, "after\n");
        fixture.write("unselected.txt", "working\n");
        stage_paths(fixture.path(), &[after.into(), before.into()]).unwrap();
        assert_eq!(
            git(fixture.path(), &["show", &format!(":{after}")]).unwrap(),
            b"after\n"
        );
        assert_eq!(
            git(fixture.path(), &["show", ":unselected.txt"]).unwrap(),
            b"before\n"
        );
        unstage_paths(fixture.path(), &[after.into(), before.into()]).unwrap();
        assert_eq!(
            git(fixture.path(), &["show", &format!(":{before}")]).unwrap(),
            b"before\n"
        );
        assert_eq!(fs::read(fixture.path().join(after)).unwrap(), b"after\n");
    }
}

#[test]
fn batch_rejects_stale_selection_before_changing_any_index_entry() {
    let fixture = Fixture::new();
    fixture.write("file.txt", "head\n");
    fixture.initial_commit();
    fixture.write("file.txt", "working\n");
    let before = git(fixture.path(), &["ls-files", "--stage", "-z"]).unwrap();
    assert!(stage_paths(fixture.path(), &["file.txt".into(), "missing.txt".into()]).is_err());
    assert_eq!(
        git(fixture.path(), &["ls-files", "--stage", "-z"]).unwrap(),
        before
    );
    stage(fixture.path(), "file.txt").unwrap();
    let before = git(fixture.path(), &["ls-files", "--stage", "-z"]).unwrap();
    assert!(unstage_paths(fixture.path(), &["file.txt".into(), "missing.txt".into()]).is_err());
    assert_eq!(
        git(fixture.path(), &["ls-files", "--stage", "-z"]).unwrap(),
        before
    );
}

#[test]
#[ignore = "仅手动运行临时仓库性能基准"]
fn batch_stage_unstage_benchmark() {
    for tracked in [100, 20_000] {
        let fixture = Fixture::new();
        for index in 0..tracked {
            fixture.write(&format!("files/{index:05}.txt"), "head\n");
        }
        fixture.initial_commit();
        let paths: Vec<String> = (0..35)
            .map(|index| format!("files/{index:05}.txt"))
            .collect();
        for path in &paths {
            fixture.write(path, "working\n");
        }
        let mut stage_times = Vec::new();
        let mut unstage_times = Vec::new();
        for _ in 0..3 {
            let start = std::time::Instant::now();
            with_repository(fixture.path().to_str().unwrap(), |repo| {
                stage_paths(repo, &paths)
            })
            .unwrap();
            stage_times.push(start.elapsed().as_millis());
            let start = std::time::Instant::now();
            with_repository(fixture.path().to_str().unwrap(), |repo| {
                unstage_paths(repo, &paths)
            })
            .unwrap();
            unstage_times.push(start.elapsed().as_millis());
        }
        stage_times.sort();
        unstage_times.sort();
        println!(
            "BENCH tracked={tracked} selected=35 stage_ms={stage_times:?} unstage_ms={unstage_times:?}"
        );
    }
}

#[test]
fn failed_batch_filter_leaves_index_and_working_files_unchanged() {
    let fixture = Fixture::new();
    fixture.write("deleted.txt", "head\n");
    fixture.write("unselected.txt", "head\n");
    fixture.write(".gitattributes", "*.fail filter=broken\n");
    fixture.initial_commit();
    fixture.write("unselected.txt", "partially staged\n");
    stage(fixture.path(), "unselected.txt").unwrap();
    fixture.write("unselected.txt", "working\n");
    fixture.write("selected.fail", "working\n");
    fs::remove_file(fixture.path().join("deleted.txt")).unwrap();
    git(fixture.path(), &["config", "filter.broken.clean", "false"]).unwrap();
    git(
        fixture.path(),
        &["config", "filter.broken.required", "true"],
    )
    .unwrap();
    let before = fs::read(fixture.path().join(".git/index")).unwrap();
    assert!(
        stage_paths(
            fixture.path(),
            &["deleted.txt".into(), "selected.fail".into()]
        )
        .is_err()
    );
    assert_eq!(fs::read(fixture.path().join(".git/index")).unwrap(), before);
    assert_eq!(
        fs::read(fixture.path().join("selected.fail")).unwrap(),
        b"working\n"
    );
    assert_eq!(
        fs::read(fixture.path().join("unselected.txt")).unwrap(),
        b"working\n"
    );
    assert!(!fixture.path().join("deleted.txt").exists());
    assert!(!fixture.path().join(".git/index.lock").exists());
    assert!(
        !fs::read_dir(fixture.path().join(".git"))
            .unwrap()
            .any(|entry| entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("git-workbench-index-"))
    );
}

#[test]
fn batch_literal_rename_and_partial_selection_preserve_unselected_versions() {
    let fixture = Fixture::new();
    fixture.write("old name.txt", "rename contents\n");
    fixture.write("unselected.txt", "head\n");
    fixture.initial_commit();
    fixture.write("unselected.txt", "index\n");
    stage(fixture.path(), "unselected.txt").unwrap();
    fixture.write("unselected.txt", "working\n");
    git(
        fixture.path(),
        &["mv", "--", "old name.txt", "new\nname.txt"],
    )
    .unwrap();
    for name in [":(glob)*", "a[1].txt", "tab\tname.txt"] {
        fixture.write(name, "literal\n");
    }
    let paths = vec![
        "new\nname.txt".into(),
        ":(glob)*".into(),
        "a[1].txt".into(),
        "tab\tname.txt".into(),
    ];
    stage_paths(fixture.path(), &paths).unwrap();
    unstage_paths(fixture.path(), &paths).unwrap();
    assert_eq!(
        git(fixture.path(), &["show", ":old name.txt"]).unwrap(),
        b"rename contents\n"
    );
    assert_eq!(
        git(fixture.path(), &["show", ":unselected.txt"]).unwrap(),
        b"index\n"
    );
    assert_eq!(
        fs::read(fixture.path().join("unselected.txt")).unwrap(),
        b"working\n"
    );
    assert!(fixture.path().join("new\nname.txt").exists());
    assert_eq!(
        changes(fixture.path())
            .unwrap()
            .iter()
            .filter(|file| file.status_index == "?")
            .count(),
        4
    );
}

#[test]
fn batch_unborn_and_duplicate_paths_preserve_unselected_files() {
    let fixture = Fixture::new();
    for path in ["one.txt", "two.txt", "other.txt"] {
        fixture.write(path, path);
    }
    let paths = vec!["one.txt".into(), "two.txt".into(), "one.txt".into()];
    stage_paths(fixture.path(), &paths).unwrap();
    assert_eq!(
        git(fixture.path(), &["ls-files", "-z"]).unwrap(),
        b"one.txt\0two.txt\0"
    );
    unstage_paths(fixture.path(), &paths).unwrap();
    assert!(git(fixture.path(), &["ls-files", "-z"]).unwrap().is_empty());
    for path in ["one.txt", "two.txt", "other.txt"] {
        assert_eq!(
            fs::read(fixture.path().join(path)).unwrap(),
            path.as_bytes()
        );
    }
}

#[test]
fn batch_split_index_and_linked_worktree_keep_independent_indexes() {
    let fixture = Fixture::new();
    fixture.write("one.txt", "head\n");
    fixture.write("two.txt", "head\n");
    fixture.initial_commit();
    git(fixture.path(), &["update-index", "--split-index"]).unwrap();
    fixture.write("one.txt", "main working\n");
    stage_paths(fixture.path(), &["one.txt".into()]).unwrap();
    unstage_paths(fixture.path(), &["one.txt".into()]).unwrap();
    assert_eq!(
        git(fixture.path(), &["show", ":one.txt"]).unwrap(),
        b"head\n"
    );
    let linked = fixture.path().join("linked");
    git(
        fixture.path(),
        &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
    )
    .unwrap();
    fs::write(linked.join("one.txt"), "linked one\n").unwrap();
    fs::write(linked.join("two.txt"), "linked two\n").unwrap();
    let main_index = git(fixture.path(), &["ls-files", "--stage", "-z"]).unwrap();
    with_repository(linked.to_str().unwrap(), |repo| {
        stage_paths(repo, &["one.txt".into(), "two.txt".into()])
    })
    .unwrap();
    assert_eq!(
        git(&linked, &["show", ":one.txt"]).unwrap(),
        b"linked one\n"
    );
    unstage_paths(&linked, &["one.txt".into(), "two.txt".into()]).unwrap();
    assert_eq!(git(&linked, &["show", ":two.txt"]).unwrap(), b"head\n");
    assert_eq!(
        git(fixture.path(), &["ls-files", "--stage", "-z"]).unwrap(),
        main_index
    );
}

#[cfg(unix)]
#[test]
fn batch_symlink_index_uses_real_target_lock_and_keeps_link() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    fixture.write("file.txt", "head\n");
    fixture.initial_commit();
    let index = fixture.path().join(".git/index");
    let target = fixture.path().join(".git/actual-index");
    fs::rename(&index, &target).unwrap();
    symlink("actual-index", &index).unwrap();
    fixture.write("file.txt", "working\n");
    let lock = fixture.path().join(".git/actual-index.lock");
    fs::write(&lock, "external lock").unwrap();
    assert!(stage(fixture.path(), "file.txt").is_err());
    assert_eq!(fs::read(&lock).unwrap(), b"external lock");
    fs::remove_file(&lock).unwrap();
    stage(fixture.path(), "file.txt").unwrap();
    unstage(fixture.path(), "file.txt").unwrap();
    assert!(
        fs::symlink_metadata(index)
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(
        git(fixture.path(), &["show", ":file.txt"]).unwrap(),
        b"head\n"
    );
}
