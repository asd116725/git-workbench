use super::*;
use tempfile::TempDir;

struct Fixture {
    _directory: TempDir,
    local: PathBuf,
    remote: PathBuf,
    peer: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(directory.path()).unwrap();
        let local = base.join("local");
        let remote = base.join("remote.git");
        let peer = base.join("peer");
        for path in [&local, &remote, &peer] {
            fs::create_dir(path).unwrap();
        }
        git(&remote, &["init", "--bare", "-b", "main"]).unwrap();
        for path in [&local, &peer] {
            git(path, &["init", "-b", "main"]).unwrap();
            git(path, &["config", "user.name", "Remote Test"]).unwrap();
            git(
                path,
                &["config", "user.email", "remote-test@example.invalid"],
            )
            .unwrap();
            git(path, &["config", "commit.gpgSign", "false"]).unwrap();
            git(path, &["config", "core.hooksPath", "/dev/null"]).unwrap();
            git(path, &["remote", "add", "origin", remote.to_str().unwrap()]).unwrap();
        }
        Self {
            _directory: directory,
            local,
            remote,
            peer,
        }
    }

    fn seed(&self) {
        commit_file(&self.local, "base.txt", "base\n");
        push(&self.local, None).unwrap();
        git(&self.peer, &["fetch", "origin"]).unwrap();
        git(&self.peer, &["reset", "--hard", "origin/main"]).unwrap();
        git(&self.peer, &["branch", "--set-upstream-to=origin/main"]).unwrap();
    }
}

fn commit_file(repo: &Path, name: &str, content: &str) {
    fs::write(repo.join(name), content).unwrap();
    git(repo, &["add", "--", name]).unwrap();
    git(repo, &["commit", "-m", content.trim()]).unwrap();
}

#[test]
fn first_push_establishes_tracking_and_refreshes_pending_count() {
    let fixture = Fixture::new();
    let repo = &fixture.local;
    let unborn = status(repo).unwrap();
    assert_eq!(unborn.remote.ahead, None);
    assert!(push(repo, None).unwrap_err().contains("尚无提交"));
    commit_file(repo, "base.txt", "base\n");
    let unpublished = remote_status(repo).unwrap();
    assert_eq!((unpublished.ahead, unpublished.behind), (None, None));
    push(repo, None).unwrap();
    let synced = status(repo).unwrap().remote;
    assert_eq!(synced.upstream.as_deref(), Some("origin/main"));
    assert_eq!(synced.ahead, Some(0));
    assert_eq!(synced.behind, Some(0));
    commit_file(repo, "next.txt", "next\n");
    assert_eq!(remote_status(repo).unwrap().ahead, Some(1));
    push(repo, None).unwrap();
    assert_eq!(remote_status(repo).unwrap().ahead, Some(0));
    assert_eq!(
        git_line(&fixture.remote, &["rev-parse", "main"]).unwrap(),
        git_line(repo, &["rev-parse", "HEAD"]).unwrap()
    );
}

#[test]
fn fetch_only_updates_refs_and_preserves_dirty_index_and_worktree() {
    let fixture = Fixture::new();
    fixture.seed();
    commit_file(&fixture.peer, "upstream.txt", "upstream\n");
    push(&fixture.peer, None).unwrap();
    let repo = &fixture.local;
    fs::write(repo.join("base.txt"), "staged\n").unwrap();
    git(repo, &["add", "base.txt"]).unwrap();
    fs::write(repo.join("base.txt"), "working\n").unwrap();
    let before = git(repo, &["status", "--porcelain=v1", "-z"]).unwrap();
    let head = git_line(repo, &["rev-parse", "HEAD"]).unwrap();
    fetch(repo).unwrap();
    assert_eq!(remote_status(repo).unwrap().behind, Some(1));
    assert_eq!(git_line(repo, &["rev-parse", "HEAD"]).unwrap(), head);
    assert_eq!(
        git(repo, &["status", "--porcelain=v1", "-z"]).unwrap(),
        before
    );
    assert_eq!(git(repo, &["show", ":base.txt"]).unwrap(), b"staged\n");
    assert_eq!(fs::read(repo.join("base.txt")).unwrap(), b"working\n");
}

#[test]
fn fetch_includes_remotes_marked_to_skip_fetch_all() {
    let fixture = Fixture::new();
    fixture.seed();
    let repo = &fixture.local;
    git(
        repo,
        &[
            "remote",
            "add",
            "secondary",
            fixture.remote.to_str().unwrap(),
        ],
    )
    .unwrap();
    git(repo, &["config", "remote.origin.skipFetchAll", "true"]).unwrap();
    git(repo, &["config", "remote.secondary.skipFetchAll", "true"]).unwrap();
    commit_file(&fixture.peer, "next.txt", "remote next\n");
    push(&fixture.peer, None).unwrap();
    fetch(repo).unwrap();
    let expected = git_line(&fixture.peer, &["rev-parse", "HEAD"]).unwrap();
    for reference in ["refs/remotes/origin/main", "refs/remotes/secondary/main"] {
        assert_eq!(git_line(repo, &["rev-parse", reference]).unwrap(), expected);
    }
}

#[test]
fn fetch_uses_real_remote_names_even_when_a_group_has_the_same_name() {
    let fixture = Fixture::new();
    fixture.seed();
    let repo = &fixture.local;
    git(
        repo,
        &[
            "remote",
            "add",
            "secondary",
            fixture.remote.to_str().unwrap(),
        ],
    )
    .unwrap();
    git(repo, &["config", "remotes.origin", "secondary"]).unwrap();
    commit_file(&fixture.peer, "next.txt", "remote next\n");
    push(&fixture.peer, None).unwrap();
    fetch(repo).unwrap();
    let expected = git_line(&fixture.peer, &["rev-parse", "HEAD"]).unwrap();
    for reference in ["refs/remotes/origin/main", "refs/remotes/secondary/main"] {
        assert_eq!(git_line(repo, &["rev-parse", reference]).unwrap(), expected);
    }
}

#[test]
fn fetch_continues_after_a_failed_remote_and_reports_each_failure() {
    let fixture = Fixture::new();
    fixture.seed();
    let repo = &fixture.local;
    for remote in ["a-missing", "z-missing"] {
        git(
            repo,
            &[
                "remote",
                "add",
                remote,
                "/nonexistent/git-workbench-remote.git",
            ],
        )
        .unwrap();
    }
    commit_file(&fixture.peer, "next.txt", "remote next\n");
    push(&fixture.peer, None).unwrap();
    let error = fetch(repo).unwrap_err();
    assert!(error.contains("a-missing"));
    assert!(error.contains("z-missing"));
    assert_eq!(
        git_line(repo, &["rev-parse", "origin/main"]).unwrap(),
        git_line(&fixture.peer, &["rev-parse", "HEAD"]).unwrap()
    );
}

#[test]
fn pull_clears_merge_options_for_a_branch_whose_name_contains_equals() {
    let fixture = Fixture::new();
    fixture.seed();
    let repo = &fixture.local;
    git(repo, &["branch", "-m", "feature=a"]).unwrap();
    git(
        repo,
        &["config", "branch.feature=a.mergeOptions", "--strategy=ours"],
    )
    .unwrap();
    commit_file(&fixture.peer, "next.txt", "remote next\n");
    push(&fixture.peer, None).unwrap();
    pull(repo).unwrap();
    assert_eq!(
        git_line(repo, &["rev-parse", "HEAD"]).unwrap(),
        git_line(&fixture.peer, &["rev-parse", "HEAD"]).unwrap()
    );
    assert_eq!(fs::read(repo.join("next.txt")).unwrap(), b"remote next\n");
    assert!(git(repo, &["status", "--porcelain=v1"]).unwrap().is_empty());
}

#[test]
fn pull_ignores_branch_merge_options_and_configuration_that_prevent_fast_forward() {
    for options in ["--squash", "--no-ff --no-commit", "--strategy=ours"] {
        let fixture = Fixture::new();
        fixture.seed();
        commit_file(&fixture.peer, "next.txt", "remote next\n");
        push(&fixture.peer, None).unwrap();
        let repo = &fixture.local;
        git(repo, &["config", "branch.main.mergeOptions", options]).unwrap();
        git(repo, &["config", "merge.ff", "false"]).unwrap();
        git(repo, &["config", "pull.ff", "false"]).unwrap();
        pull(repo).unwrap();
        assert_eq!(
            git_line(repo, &["rev-parse", "HEAD"]).unwrap(),
            git_line(&fixture.peer, &["rev-parse", "HEAD"]).unwrap(),
            "{options}"
        );
        assert!(
            git(repo, &["status", "--porcelain=v1"]).unwrap().is_empty(),
            "{options}"
        );
        assert!(operation(repo).unwrap().is_none(), "{options}");
    }
}

#[test]
fn push_never_recurses_into_submodules_even_when_configured() {
    for recursion in ["only", "on-demand"] {
        let fixture = Fixture::new();
        fixture.seed();
        let submodule = Fixture::new();
        submodule.seed();
        let repo = &fixture.local;
        git(
            repo,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                submodule.remote.to_str().unwrap(),
                "module",
            ],
        )
        .unwrap();
        let module = repo.join("module");
        git(&module, &["config", "user.name", "Remote Test"]).unwrap();
        git(
            &module,
            &["config", "user.email", "remote-test@example.invalid"],
        )
        .unwrap();
        git(&module, &["config", "commit.gpgSign", "false"]).unwrap();
        git(&module, &["config", "core.hooksPath", "/dev/null"]).unwrap();
        let submodule_remote_before = git_line(&submodule.remote, &["rev-parse", "main"]).unwrap();
        commit_file(&module, "unpublished.txt", "unpublished submodule commit\n");
        git(repo, &["add", ".gitmodules", "module"]).unwrap();
        git(
            repo,
            &["commit", "-m", "track unpublished submodule commit"],
        )
        .unwrap();
        git(repo, &["config", "push.recurseSubmodules", recursion]).unwrap();
        push(repo, None).unwrap();
        assert_eq!(
            git_line(&fixture.remote, &["rev-parse", "main"]).unwrap(),
            git_line(repo, &["rev-parse", "HEAD"]).unwrap(),
            "{recursion}"
        );
        assert_eq!(
            git_line(&submodule.remote, &["rev-parse", "main"]).unwrap(),
            submodule_remote_before,
            "{recursion}"
        );
        assert_eq!(remote_status(repo).unwrap().ahead, Some(0));
    }
}

#[test]
fn pull_fast_forwards_despite_rebase_config_and_keeps_unrelated_changes() {
    let fixture = Fixture::new();
    fixture.seed();
    commit_file(&fixture.peer, "upstream.txt", "upstream\n");
    push(&fixture.peer, None).unwrap();
    let repo = &fixture.local;
    git(repo, &["config", "pull.rebase", "true"]).unwrap();
    git(repo, &["config", "rebase.autoStash", "true"]).unwrap();
    fs::write(repo.join("local.txt"), "dirty\n").unwrap();
    pull(repo).unwrap();
    assert_eq!(
        git_line(repo, &["rev-parse", "HEAD"]).unwrap(),
        git_line(&fixture.peer, &["rev-parse", "HEAD"]).unwrap()
    );
    assert_eq!(fs::read(repo.join("local.txt")).unwrap(), b"dirty\n");
    assert_eq!(remote_status(repo).unwrap().behind, Some(0));
    assert!(git_line(repo, &["stash", "list"]).unwrap().is_empty());
}

#[test]
fn pull_refuses_divergence_and_does_not_autostash_dirty_files() {
    let fixture = Fixture::new();
    fixture.seed();
    commit_file(&fixture.peer, "upstream.txt", "upstream\n");
    push(&fixture.peer, None).unwrap();
    let repo = &fixture.local;
    commit_file(repo, "local.txt", "local\n");
    fs::write(repo.join("base.txt"), "dirty\n").unwrap();
    git(repo, &["add", "base.txt"]).unwrap();
    git(repo, &["config", "pull.rebase", "true"]).unwrap();
    git(repo, &["config", "merge.autoStash", "true"]).unwrap();
    git(repo, &["config", "rebase.autoStash", "true"]).unwrap();
    let head = git_line(repo, &["rev-parse", "HEAD"]).unwrap();
    let before = git(repo, &["status", "--porcelain=v1", "-z"]).unwrap();
    assert!(pull(repo).unwrap_err().contains("分叉"));
    assert_eq!(git_line(repo, &["rev-parse", "HEAD"]).unwrap(), head);
    assert_eq!(
        git(repo, &["status", "--porcelain=v1", "-z"]).unwrap(),
        before
    );
    assert_eq!(fs::read(repo.join("base.txt")).unwrap(), b"dirty\n");
    assert!(git_line(repo, &["stash", "list"]).unwrap().is_empty());
    assert!(operation(repo).unwrap().is_none());
    let state = remote_status(repo).unwrap();
    assert_eq!((state.ahead, state.behind), (Some(1), Some(1)));
}

#[test]
fn push_refuses_non_fast_forward_without_changing_remote_or_pending_count() {
    let fixture = Fixture::new();
    fixture.seed();
    commit_file(&fixture.peer, "peer.txt", "peer\n");
    push(&fixture.peer, None).unwrap();
    let remote_head = git_line(&fixture.remote, &["rev-parse", "main"]).unwrap();
    commit_file(&fixture.local, "local.txt", "local\n");
    assert!(push(&fixture.local, None).unwrap_err().contains("推送失败"));
    assert_eq!(
        git_line(&fixture.remote, &["rev-parse", "main"]).unwrap(),
        remote_head
    );
    assert_eq!(remote_status(&fixture.local).unwrap().ahead, Some(1));
}

#[test]
fn explicit_refspec_only_pushes_current_branch_and_never_implicit_tags() {
    let fixture = Fixture::new();
    fixture.seed();
    let repo = &fixture.local;
    git(repo, &["branch", "other"]).unwrap();
    git(repo, &["push", "origin", "other"]).unwrap();
    let other_before = git_line(&fixture.remote, &["rev-parse", "other"]).unwrap();
    commit_file(repo, "local.txt", "local\n");
    git(repo, &["branch", "-f", "other", "HEAD"]).unwrap();
    git(repo, &["config", "push.default", "matching"]).unwrap();
    git(repo, &["config", "push.followTags", "true"]).unwrap();
    git(
        repo,
        &[
            "config",
            "remote.origin.push",
            "refs/heads/other:refs/heads/other",
        ],
    )
    .unwrap();
    git(repo, &["tag", "-a", "unpublished", "-m", "do not push"]).unwrap();
    push(repo, None).unwrap();
    assert_eq!(
        git_line(&fixture.remote, &["rev-parse", "other"]).unwrap(),
        other_before
    );
    assert!(!commit_exists(&fixture.remote, "refs/tags/unpublished").unwrap());
    assert_eq!(remote_status(repo).unwrap().ahead, Some(0));
}

#[test]
fn renamed_upstream_is_the_explicit_pull_and_push_destination() {
    let fixture = Fixture::new();
    fixture.seed();
    let repo = &fixture.local;
    git(repo, &["branch", "-m", "local-name"]).unwrap();
    commit_file(repo, "local.txt", "local\n");
    push(repo, None).unwrap();
    assert_eq!(
        remote_status(repo).unwrap().upstream_branch.as_deref(),
        Some("main")
    );
    assert!(!commit_exists(&fixture.remote, "refs/heads/local-name").unwrap());
    pull(&fixture.peer).unwrap();
    commit_file(&fixture.peer, "peer.txt", "peer\n");
    push(&fixture.peer, None).unwrap();
    pull(repo).unwrap();
    assert_eq!(remote_status(repo).unwrap().behind, Some(0));
}

#[test]
fn same_named_tag_does_not_change_the_current_branch_or_push_target() {
    let fixture = Fixture::new();
    fixture.seed();
    let repo = &fixture.local;
    git(repo, &["tag", "main"]).unwrap();
    commit_file(repo, "local.txt", "local\n");
    assert_eq!(remote_status(repo).unwrap().ahead, Some(1));
    push(repo, None).unwrap();
    assert_eq!(remote_status(repo).unwrap().ahead, Some(0));
    assert_eq!(
        git_line(&fixture.remote, &["rev-parse", "refs/heads/main"]).unwrap(),
        git_line(repo, &["rev-parse", "HEAD"]).unwrap()
    );
}

#[test]
fn pull_will_not_hide_overwritten_local_changes_in_an_automatic_stash() {
    let fixture = Fixture::new();
    fixture.seed();
    commit_file(&fixture.peer, "base.txt", "remote change\n");
    push(&fixture.peer, None).unwrap();
    let repo = &fixture.local;
    fs::write(repo.join("base.txt"), "local change\n").unwrap();
    git(repo, &["config", "merge.autoStash", "true"]).unwrap();
    let head = git_line(repo, &["rev-parse", "HEAD"]).unwrap();
    assert!(pull(repo).is_err());
    assert_eq!(git_line(repo, &["rev-parse", "HEAD"]).unwrap(), head);
    assert_eq!(fs::read(repo.join("base.txt")).unwrap(), b"local change\n");
    assert!(git_line(repo, &["stash", "list"]).unwrap().is_empty());
}

#[test]
fn missing_upstream_reference_is_unknown_until_fetch_restores_it() {
    let fixture = Fixture::new();
    fixture.seed();
    let repo = &fixture.local;
    git(repo, &["update-ref", "-d", "refs/remotes/origin/main"]).unwrap();
    let before = status(repo).unwrap().remote;
    assert_eq!(before.upstream.as_deref(), Some("origin/main"));
    assert_eq!((before.ahead, before.behind), (None, None));
    fetch(repo).unwrap();
    assert_eq!(remote_status(repo).unwrap().ahead, Some(0));
}

#[test]
fn no_remote_detached_and_local_upstream_have_explicit_limits() {
    let fixture = Fixture::new();
    fixture.seed();
    let repo = &fixture.local;
    git(repo, &["branch", "local-target"]).unwrap();
    git(repo, &["branch", "--set-upstream-to=local-target"]).unwrap();
    assert_eq!(
        remote_status(repo).unwrap().upstream_remote.as_deref(),
        Some(".")
    );
    assert!(pull(repo).unwrap_err().contains("远程"));
    assert!(push(repo, None).unwrap_err().contains("远程"));
    git(repo, &["switch", "--detach", "HEAD"]).unwrap();
    assert_eq!(remote_status(repo).unwrap().ahead, None);
    assert!(push(repo, None).unwrap_err().contains("分离 HEAD"));
    assert!(pull(repo).unwrap_err().contains("分离 HEAD"));
    fetch(repo).unwrap();
    git(repo, &["remote", "remove", "origin"]).unwrap();
    assert_eq!(status(repo).unwrap().remote.ahead, None);
    assert!(fetch(repo).unwrap_err().contains("尚未配置"));
}

#[test]
fn first_push_requires_selection_for_ambiguous_remotes_and_validates_target() {
    let fixture = Fixture::new();
    let repo = &fixture.local;
    commit_file(repo, "base.txt", "base\n");
    git(repo, &["remote", "rename", "origin", "one"]).unwrap();
    git(
        repo,
        &["remote", "add", "two", fixture.remote.to_str().unwrap()],
    )
    .unwrap();
    let state = remote_status(repo).unwrap();
    assert_eq!(state.default_remote, None);
    assert_eq!(state.ahead, None);
    assert!(push(repo, None).unwrap_err().contains("请选择"));
    assert!(push(repo, Some("missing")).unwrap_err().contains("远程"));
    push(repo, Some("two")).unwrap();
    assert_eq!(
        remote_status(repo).unwrap().upstream.as_deref(),
        Some("two/main")
    );
    assert!(push(repo, Some("one")).unwrap_err().contains("上游已变化"));
}

#[test]
fn linked_worktree_push_counts_its_own_branch() {
    let fixture = Fixture::new();
    fixture.seed();
    let linked = fixture.local.parent().unwrap().join("linked");
    git(
        &fixture.local,
        &["worktree", "add", "-b", "feature", linked.to_str().unwrap()],
    )
    .unwrap();
    let unpublished = remote_status(&linked).unwrap();
    assert_eq!(unpublished.upstream, None);
    assert_eq!((unpublished.ahead, unpublished.behind), (None, None));
    commit_file(&linked, "feature.txt", "feature\n");
    assert_eq!(remote_status(&linked).unwrap().ahead, None);
    push(&linked, None).unwrap();
    assert_eq!(status(&linked).unwrap().remote.ahead, Some(0));
    commit_file(&linked, "next.txt", "next\n");
    assert_eq!(remote_status(&linked).unwrap().ahead, Some(1));
    push(&linked, None).unwrap();
    assert_eq!(
        status(&fixture.local).unwrap().remote.upstream.as_deref(),
        Some("origin/main")
    );
    assert_eq!(
        git_line(&fixture.remote, &["rev-parse", "feature"]).unwrap(),
        git_line(&linked, &["rev-parse", "HEAD"]).unwrap()
    );
}

#[test]
fn unreachable_remote_returns_failure_without_changing_head() {
    let fixture = Fixture::new();
    fixture.seed();
    git(
        &fixture.local,
        &[
            "remote",
            "set-url",
            "origin",
            "/nonexistent/git-workbench-remote.git",
        ],
    )
    .unwrap();
    let head = git_line(&fixture.local, &["rev-parse", "HEAD"]).unwrap();
    assert!(fetch(&fixture.local).is_err());
    assert!(push(&fixture.local, None).is_err());
    assert_eq!(
        git_line(&fixture.local, &["rev-parse", "HEAD"]).unwrap(),
        head
    );
}

#[cfg(unix)]
#[test]
fn stalled_remote_command_terminates_its_process_group_promptly() {
    let directory = tempfile::tempdir().unwrap();
    let marker = directory.path().join("survived");
    let mut command = Command::new("/bin/sh");
    command.args([
        "-c",
        "(sleep 1; touch \"$1\") & wait",
        "test",
        marker.to_str().unwrap(),
    ]);
    let started = Instant::now();
    assert!(
        run_remote_command(command, Duration::from_millis(100))
            .unwrap_err()
            .contains("超时")
    );
    assert!(started.elapsed() < Duration::from_secs(1));
    thread::sleep(Duration::from_millis(1100));
    assert!(!marker.exists());
}
