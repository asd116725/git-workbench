use super::*;
use crate::git::branch_management::{create_branch, delete_branch, delete_preview};

fn committed_fixture() -> Fixture {
    let fixture = Fixture::new();
    fixture.write("file.txt", "initial\n");
    fixture.initial_commit();
    fixture
}

fn remote_ref(repo: &Path, name: &str, revision: &str) {
    if git_line(repo, &["remote"]).unwrap().is_empty() {
        git(
            repo,
            &["remote", "add", "origin", "/unused/branch-tests.git"],
        )
        .unwrap();
    }
    git(
        repo,
        &[
            "update-ref",
            &format!("refs/remotes/origin/{name}"),
            revision,
        ],
    )
    .unwrap();
}

fn exists(repo: &Path, name: &str) -> bool {
    run_git(repo, &["show-ref", "--verify", "--quiet", name])
        .unwrap()
        .status
        .success()
}

#[test]
fn create_only_preserves_dirty_index_and_disables_implicit_tracking() {
    let fixture = committed_fixture();
    let repo = fixture.path();
    git(repo, &["config", "branch.autoSetupMerge", "always"]).unwrap();
    fixture.write("file.txt", "staged\n");
    stage(repo, "file.txt").unwrap();
    fixture.write("file.txt", "working\n");
    let before = git(repo, &["status", "--porcelain=v1", "-z"]).unwrap();
    let result = create_branch(repo, "feature/中文", "refs/heads/main", false).unwrap();
    assert_eq!(result.branch, "feature/中文");
    assert!(!result.switched && result.warning.is_none());
    assert_eq!(
        git_line(repo, &["symbolic-ref", "--short", "HEAD"]).unwrap(),
        "main"
    );
    assert_eq!(
        git(repo, &["status", "--porcelain=v1", "-z"]).unwrap(),
        before
    );
    assert_eq!(git(repo, &["show", ":file.txt"]).unwrap(), b"staged\n");
    assert_eq!(fs::read(repo.join("file.txt")).unwrap(), b"working\n");
    assert!(
        !run_git(repo, &["config", "--get", "branch.feature/中文.remote"])
            .unwrap()
            .status
            .success()
    );
}

#[test]
fn create_remote_branch_uses_selected_tracking_ref_and_switches() {
    let fixture = committed_fixture();
    let repo = fixture.path();
    remote_ref(repo, "topic", "HEAD");
    git(repo, &["config", "branch.autoSetupMerge", "false"]).unwrap();
    let result = create_branch(repo, "local-topic", "refs/remotes/origin/topic", true).unwrap();
    assert!(result.switched && result.warning.is_none());
    assert_eq!(
        git_line(repo, &["symbolic-ref", "--short", "HEAD"]).unwrap(),
        "local-topic"
    );
    assert_eq!(
        git_line(repo, &["rev-parse", "--symbolic-full-name", "@{upstream}"]).unwrap(),
        "refs/remotes/origin/topic"
    );
    assert!(exists(repo, "refs/remotes/origin/topic"));
}

#[test]
fn create_from_detached_head_and_unborn_with_existing_start() {
    let fixture = committed_fixture();
    let repo = fixture.path();
    git(repo, &["switch", "--detach", "HEAD"]).unwrap();
    let result = create_branch(repo, "detached-copy", "HEAD", true).unwrap();
    assert!(result.switched);
    git(repo, &["symbolic-ref", "HEAD", "refs/heads/unborn"]).unwrap();
    assert!(
        create_branch(repo, "empty-copy", "HEAD", false)
            .unwrap_err()
            .contains("尚无提交")
    );
    assert!(!exists(repo, "refs/heads/empty-copy"));
    assert!(create_branch(repo, "from-existing", "refs/heads/main", false).is_ok());
}

#[test]
fn create_rejects_invalid_duplicate_conflicting_names_and_revision_expressions() {
    let fixture = committed_fixture();
    let repo = fixture.path();
    git(repo, &["switch", "-c", "other"]).unwrap();
    git(repo, &["switch", "main"]).unwrap();
    for name in [
        "",
        "main",
        "bad..name",
        "with space",
        "name.lock",
        "-force",
        "@{-1}",
    ] {
        assert!(create_branch(repo, name, "HEAD", false).is_err(), "{name}");
    }
    assert!(create_branch(repo, "main/nested", "HEAD", false).is_err());
    for source in [
        "main",
        "HEAD~1",
        "refs/heads/main~1",
        "--force",
        "refs/heads/missing",
    ] {
        assert!(
            create_branch(repo, "not-created", source, false).is_err(),
            "{source}"
        );
    }
    assert!(!exists(repo, "refs/heads/not-created"));
    git(repo, &["update-ref", "refs/remotes/missing/topic", "HEAD"]).unwrap();
    assert!(create_branch(repo, "missing-remote", "refs/remotes/missing/topic", false).is_err());
}

#[test]
fn create_retains_branch_when_dirty_files_block_switching() {
    let fixture = committed_fixture();
    let repo = fixture.path();
    git(repo, &["switch", "-c", "other"]).unwrap();
    fixture.write("file.txt", "other\n");
    fixture.initial_commit();
    git(repo, &["switch", "main"]).unwrap();
    fixture.write("file.txt", "unsaved\n");
    let result = create_branch(repo, "retained", "refs/heads/other", true).unwrap();
    assert!(!result.switched);
    assert!(result.warning.unwrap().contains("分支已创建"));
    assert_eq!(
        git_line(repo, &["symbolic-ref", "--short", "HEAD"]).unwrap(),
        "main"
    );
    assert!(exists(repo, "refs/heads/retained"));
    assert_eq!(fs::read(repo.join("file.txt")).unwrap(), b"unsaved\n");
    assert_eq!(git(repo, &["show", ":file.txt"]).unwrap(), b"initial\n");
}

#[cfg(unix)]
#[test]
fn create_returns_success_and_warning_after_post_checkout_hook_failure() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = committed_fixture();
    let repo = fixture.path();
    let hook = repo.join(".git/test-hooks/post-checkout");
    fs::write(
        &hook,
        "#!/bin/sh\necho 'branch test hook rejected' >&2\nexit 1\n",
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    let result = create_branch(repo, "hook-branch", "HEAD", true).unwrap();
    assert!(result.switched);
    assert!(
        result
            .warning
            .unwrap()
            .contains("branch test hook rejected")
    );
    assert_eq!(
        git_line(repo, &["symbolic-ref", "--short", "HEAD"]).unwrap(),
        "hook-branch"
    );
}

#[test]
fn delete_merged_branch_preserves_dirty_files_and_removes_tracking_config_only_locally() {
    let fixture = committed_fixture();
    let repo = fixture.path();
    remote_ref(repo, "topic", "HEAD");
    create_branch(repo, "topic", "refs/remotes/origin/topic", false).unwrap();
    fixture.write("file.txt", "dirty\n");
    stage(repo, "file.txt").unwrap();
    fixture.write("new.txt", "untracked\n");
    let before = git(repo, &["status", "--porcelain=v1", "-z"]).unwrap();
    let preview = delete_preview(repo, "refs/heads/topic").unwrap();
    assert_eq!(preview.unmerged_commits, 0);
    assert_eq!(preview.head_ref.as_deref(), Some("refs/heads/main"));
    let result = delete_branch(repo, &preview, false).unwrap();
    assert_eq!(result.branch, "topic");
    assert!(result.warning.is_none());
    assert!(!exists(repo, "refs/heads/topic"));
    assert!(exists(repo, "refs/remotes/origin/topic"));
    assert!(
        !run_git(repo, &["config", "--get", "branch.topic.remote"])
            .unwrap()
            .status
            .success()
    );
    assert_eq!(
        git(repo, &["status", "--porcelain=v1", "-z"]).unwrap(),
        before
    );
}

#[test]
fn delete_requires_explicit_force_even_when_upstream_already_contains_tip() {
    let fixture = committed_fixture();
    let repo = fixture.path();
    git(repo, &["switch", "-c", "topic"]).unwrap();
    fixture.write("topic.txt", "topic\n");
    fixture.initial_commit();
    remote_ref(repo, "topic", "HEAD");
    git(repo, &["branch", "--set-upstream-to=origin/topic", "topic"]).unwrap();
    git(repo, &["switch", "main"]).unwrap();
    let preview = delete_preview(repo, "refs/heads/topic").unwrap();
    assert_eq!(preview.unmerged_commits, 1);
    assert!(
        delete_branch(repo, &preview, false)
            .unwrap_err()
            .contains("明确确认")
    );
    assert!(exists(repo, "refs/heads/topic"));
    assert!(delete_branch(repo, &preview, true).is_ok());
    assert!(exists(repo, "refs/remotes/origin/topic"));
}

#[test]
fn delete_uses_current_head_when_upstream_has_not_merged_tip() {
    let fixture = committed_fixture();
    let repo = fixture.path();
    remote_ref(repo, "behind", "HEAD");
    fixture.write("new.txt", "new\n");
    fixture.initial_commit();
    git(repo, &["branch", "topic"]).unwrap();
    git(
        repo,
        &["branch", "--set-upstream-to=origin/behind", "topic"],
    )
    .unwrap();
    assert!(
        !run_git(repo, &["branch", "-d", "topic"])
            .unwrap()
            .status
            .success()
    );
    let preview = delete_preview(repo, "refs/heads/topic").unwrap();
    assert_eq!(preview.unmerged_commits, 0);
    assert!(delete_branch(repo, &preview, false).is_ok());
}

#[test]
fn delete_rejects_current_remote_missing_and_occupied_worktree_branches() {
    let fixture = committed_fixture();
    let repo = fixture.path();
    remote_ref(repo, "main", "HEAD");
    for name in [
        "refs/heads/main",
        "refs/remotes/origin/main",
        "refs/heads/missing",
        "main",
        "--force",
    ] {
        assert!(delete_preview(repo, name).is_err(), "{name}");
    }
    let linked = fixture._directory.path().join("linked");
    git(
        repo,
        &[
            "worktree",
            "add",
            "-b",
            "occupied",
            linked.to_str().unwrap(),
        ],
    )
    .unwrap();
    git(repo, &["worktree", "lock", linked.to_str().unwrap()]).unwrap();
    assert!(
        delete_preview(repo, "refs/heads/occupied")
            .unwrap_err()
            .contains("使用")
    );
    fs::remove_dir_all(&linked).unwrap();
    assert!(
        delete_preview(repo, "refs/heads/occupied")
            .unwrap_err()
            .contains("使用")
    );
}

#[test]
fn delete_rejects_stale_tip_head_ref_head_oid_and_forged_count() {
    let fixture = committed_fixture();
    let repo = fixture.path();
    git(repo, &["branch", "topic"]).unwrap();
    let preview = delete_preview(repo, "refs/heads/topic").unwrap();
    git(repo, &["switch", "-c", "same-commit"]).unwrap();
    assert!(
        delete_branch(repo, &preview, true)
            .unwrap_err()
            .contains("变化")
    );
    git(repo, &["switch", "main"]).unwrap();
    fixture.write("new.txt", "new\n");
    fixture.initial_commit();
    assert!(
        delete_branch(repo, &preview, true)
            .unwrap_err()
            .contains("变化")
    );
    let current = delete_preview(repo, "refs/heads/topic").unwrap();
    git(repo, &["update-ref", "refs/heads/topic", "HEAD"]).unwrap();
    assert!(
        delete_branch(repo, &current, true)
            .unwrap_err()
            .contains("变化")
    );
    let mut forged = delete_preview(repo, "refs/heads/topic").unwrap();
    forged.unmerged_commits += 1;
    assert!(delete_branch(repo, &forged, true).is_err());
    assert!(exists(repo, "refs/heads/topic"));
}

#[test]
fn delete_rechecks_worktree_occupancy_and_allows_detached_head_comparison() {
    let fixture = committed_fixture();
    let repo = fixture.path();
    git(repo, &["branch", "topic"]).unwrap();
    let preview = delete_preview(repo, "refs/heads/topic").unwrap();
    let linked = fixture._directory.path().join("linked");
    git(
        repo,
        &["worktree", "add", linked.to_str().unwrap(), "topic"],
    )
    .unwrap();
    assert!(delete_branch(repo, &preview, true).is_err());
    git(repo, &["worktree", "remove", linked.to_str().unwrap()]).unwrap();
    git(repo, &["switch", "--detach", "HEAD"]).unwrap();
    let detached = delete_preview(repo, "refs/heads/topic").unwrap();
    assert!(detached.head_ref.is_none());
    assert!(detached.head_name.starts_with("当前 HEAD"));
    assert!(delete_branch(repo, &detached, false).is_ok());
}

#[test]
fn unfinished_git_operations_block_creation_preview_and_deletion() {
    let fixture = committed_fixture();
    let repo = fixture.path();
    git(repo, &["branch", "topic"]).unwrap();
    let preview = delete_preview(repo, "refs/heads/topic").unwrap();
    let head = git_line(repo, &["rev-parse", "HEAD"]).unwrap();
    for name in ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"] {
        fs::write(repo.join(".git").join(name), &head).unwrap();
        assert!(create_branch(repo, "blocked", "HEAD", false).is_err());
        assert!(delete_preview(repo, "refs/heads/topic").is_err());
        assert!(delete_branch(repo, &preview, true).is_err());
        fs::remove_file(repo.join(".git").join(name)).unwrap();
    }
    for name in ["rebase-merge", "rebase-apply"] {
        fs::create_dir(repo.join(".git").join(name)).unwrap();
        assert!(create_branch(repo, "blocked", "HEAD", false).is_err());
        assert!(delete_branch(repo, &preview, true).is_err());
        fs::remove_dir(repo.join(".git").join(name)).unwrap();
    }
    assert!(!exists(repo, "refs/heads/blocked"));
    assert!(exists(repo, "refs/heads/topic"));
}
