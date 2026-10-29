use super::*;
use tempfile::TempDir;

struct TrackingFixture {
    _directory: TempDir,
    local: PathBuf,
    peer: PathBuf,
    linked: PathBuf,
}

impl TrackingFixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        let remote = root.join("remote.git");
        let local = root.join("local");
        let peer = root.join("peer");
        git(
            &root,
            &["init", "--bare", "-b", "main", remote.to_str().unwrap()],
        )
        .unwrap();
        git(
            &root,
            &["clone", remote.to_str().unwrap(), local.to_str().unwrap()],
        )
        .unwrap();
        configure(&local);
        commit_empty(&local, "initial");
        git(&local, &["push", "-u", "origin", "main"]).unwrap();
        git(
            &root,
            &["clone", remote.to_str().unwrap(), peer.to_str().unwrap()],
        )
        .unwrap();
        configure(&peer);
        Self {
            _directory: directory,
            local,
            peer,
            linked: root.join("linked"),
        }
    }
}

fn configure(repo: &Path) {
    for (key, value) in [
        ("user.name", "Branch Count Test"),
        ("user.email", "branch-count@example.invalid"),
        ("commit.gpgSign", "false"),
        ("core.hooksPath", "/dev/null"),
    ] {
        git(repo, &["config", key, value]).unwrap();
    }
}

fn commit_empty(repo: &Path, subject: &str) {
    git(repo, &["commit", "--allow-empty", "-m", subject]).unwrap();
}

fn find_branch(repo: &Path, name: &str) -> GitBranch {
    branches(repo)
        .unwrap()
        .into_iter()
        .find(|branch| branch.name == name)
        .unwrap()
}

fn counts(repo: &Path, name: &str) -> (Option<u64>, Option<u64>) {
    let branch = find_branch(repo, name);
    (branch.ahead, branch.behind)
}

#[test]
fn branch_counts_follow_each_upstream_and_only_locally_fetched_refs() {
    let fixture = TrackingFixture::new();
    let repo = &fixture.local;
    assert_eq!(counts(repo, "main"), (Some(0), Some(0)));
    assert_eq!(counts(repo, "origin/main"), (None, None));
    git(repo, &["branch", "--no-track", "local-only", "main"]).unwrap();
    assert_eq!(counts(repo, "local-only"), (None, None));

    git(
        repo,
        &["switch", "-c", "diverged", "--track", "origin/main"],
    )
    .unwrap();
    commit_empty(repo, "local one");
    commit_empty(repo, "local two");
    commit_empty(&fixture.peer, "remote one");
    git(&fixture.peer, &["push", "origin", "main"]).unwrap();
    let fetched_before = git_line(repo, &["rev-parse", "origin/main"]).unwrap();
    assert_eq!(counts(repo, "diverged"), (Some(2), Some(0)));
    assert_eq!(
        git_line(repo, &["rev-parse", "origin/main"]).unwrap(),
        fetched_before
    );

    git(repo, &["fetch", "origin"]).unwrap();
    assert_eq!(counts(repo, "diverged"), (Some(2), Some(1)));
    assert_eq!(counts(repo, "main"), (Some(0), Some(1)));
    git(repo, &["branch", "synced", "--track", "origin/main"]).unwrap();
    assert_eq!(counts(repo, "synced"), (Some(0), Some(0)));
    git(
        repo,
        &["switch", "-c", "ahead-only", "--track", "origin/main"],
    )
    .unwrap();
    commit_empty(repo, "ahead only");
    assert_eq!(counts(repo, "ahead-only"), (Some(1), Some(0)));

    git(
        repo,
        &[
            "worktree",
            "add",
            fixture.linked.to_str().unwrap(),
            "diverged",
        ],
    )
    .unwrap();
    let linked_branch = find_branch(&fixture.linked, "diverged");
    assert!(linked_branch.current);
    assert_eq!(
        (linked_branch.ahead, linked_branch.behind),
        (Some(2), Some(1))
    );
    assert_eq!(counts(&fixture.linked, "ahead-only"), (Some(1), Some(0)));
    assert_eq!(
        find_branch(repo, "diverged").worktree_path.as_deref(),
        fixture.linked.to_str()
    );

    fs::write(repo.join("dirty.txt"), "staged\n").unwrap();
    git(repo, &["add", "dirty.txt"]).unwrap();
    fs::write(repo.join("dirty.txt"), "working\n").unwrap();
    let state_before = git(repo, &["status", "--porcelain=v1", "-z"]).unwrap();
    let head_before = git_line(repo, &["rev-parse", "HEAD"]).unwrap();
    assert_eq!(counts(repo, "diverged"), (Some(2), Some(1)));
    assert_eq!(
        git(repo, &["status", "--porcelain=v1", "-z"]).unwrap(),
        state_before
    );
    assert_eq!(git_line(repo, &["rev-parse", "HEAD"]).unwrap(), head_before);
    assert_eq!(git(repo, &["show", ":dirty.txt"]).unwrap(), b"staged\n");
    assert_eq!(fs::read(repo.join("dirty.txt")).unwrap(), b"working\n");
}

#[test]
fn missing_upstream_is_unknown_and_local_upstream_uses_its_own_ref() {
    let fixture = TrackingFixture::new();
    let repo = &fixture.local;
    git(repo, &["branch", "--track", "local-tracking", "main"]).unwrap();
    commit_empty(repo, "advance local main");
    assert_eq!(counts(repo, "local-tracking"), (Some(0), Some(1)));
    assert_eq!(counts(repo, "main"), (Some(1), Some(0)));
    git(repo, &["update-ref", "-d", "refs/remotes/origin/main"]).unwrap();
    let missing = find_branch(repo, "main");
    assert_eq!(
        missing.upstream.as_deref(),
        Some("refs/remotes/origin/main")
    );
    assert_eq!((missing.ahead, missing.behind), (None, None));
    assert_eq!(counts(repo, "local-tracking"), (Some(0), Some(1)));
}

#[test]
fn unknown_tracking_output_is_never_reported_as_synchronized() {
    for (tracking, short) in [
        ("", ""),
        ("gone", ""),
        ("ahead unknown", ">"),
        ("ahead 2", "<>"),
        ("unexpected", "="),
    ] {
        assert_eq!(
            tracking_counts(tracking, short),
            None,
            "{tracking:?} {short:?}"
        );
    }
}

#[test]
fn porcelain_preserves_paths_and_optional_reasons() {
    let records = b"worktree /missing bare\0bare\0\0worktree /missing\nlinked\0HEAD 0123456789\0detached\0locked reason\nwith newline\0prunable missing directory\0\0worktree /also missing\0HEAD 0000000\0branch refs/heads/topic\0locked\0\0";
    let parsed = parse_worktrees(records).unwrap();
    assert_eq!(parsed.len(), 3);
    assert!(parsed[0].bare && parsed[0].is_main && !parsed[0].available);
    assert_eq!(parsed[1].path, "/missing\nlinked");
    assert_eq!(parsed[1].locked.as_deref(), Some("reason\nwith newline"));
    assert_eq!(parsed[1].prunable.as_deref(), Some("missing directory"));
    assert_eq!(parsed[1].branch, "分离 HEAD · 0123456");
    assert!(parsed[1].detached && !parsed[1].available);
    assert_eq!(parsed[2].locked.as_deref(), Some(""));
}

#[test]
fn worktree_counts_follow_each_branch_without_fetching_or_touching_files() {
    let fixture = TrackingFixture::new();
    let repo = &fixture.local;
    let root = repo.parent().unwrap();
    git(repo, &["branch", "topic", "--track", "origin/main"]).unwrap();
    git(
        repo,
        &["worktree", "add", fixture.linked.to_str().unwrap(), "topic"],
    )
    .unwrap();
    commit_empty(&fixture.linked, "topic one");
    commit_empty(&fixture.linked, "topic two");
    commit_empty(&fixture.peer, "remote one");
    git(&fixture.peer, &["push", "origin", "main"]).unwrap();

    let fetched_before = git_line(repo, &["rev-parse", "origin/main"]).unwrap();
    let before = worktrees(repo).unwrap();
    let before_main = before
        .iter()
        .find(|item| item.is_main)
        .unwrap()
        .branch_sync
        .as_ref()
        .unwrap();
    let before_topic = before
        .iter()
        .find(|item| item.branch == "topic")
        .unwrap()
        .branch_sync
        .as_ref()
        .unwrap();
    assert_eq!((before_main.ahead, before_main.behind), (Some(0), Some(0)));
    assert_eq!(
        (before_topic.ahead, before_topic.behind),
        (Some(2), Some(0))
    );
    assert_eq!(
        git_line(repo, &["rev-parse", "origin/main"]).unwrap(),
        fetched_before
    );

    git(repo, &["fetch", "origin"]).unwrap();
    for (name, start, tracking) in [
        ("synced", "origin/main", "--track"),
        ("local-only", "main", "--no-track"),
        ("missing-dir", "origin/main", "--track"),
    ] {
        git(repo, &["branch", name, tracking, start]).unwrap();
        git(
            repo,
            &["worktree", "add", root.join(name).to_str().unwrap(), name],
        )
        .unwrap();
    }
    git(
        repo,
        &[
            "worktree",
            "add",
            "--detach",
            root.join("detached").to_str().unwrap(),
            "HEAD",
        ],
    )
    .unwrap();
    fs::remove_dir_all(root.join("missing-dir")).unwrap();
    fs::write(repo.join("dirty.txt"), "staged\n").unwrap();
    git(repo, &["add", "dirty.txt"]).unwrap();
    fs::write(repo.join("dirty.txt"), "working\n").unwrap();
    let index_before = fs::read(repo.join(".git/index")).unwrap();
    let head_before = git_line(repo, &["rev-parse", "HEAD"]).unwrap();

    for entry in [repo, &fixture.linked] {
        let rows = worktrees(entry).unwrap();
        for (name, expected) in [
            ("main", (Some(0), Some(1))),
            ("topic", (Some(2), Some(1))),
            ("synced", (Some(0), Some(0))),
            ("local-only", (None, None)),
        ] {
            let row = rows.iter().find(|row| row.branch == name).unwrap();
            let sync = row.branch_sync.as_ref().unwrap();
            assert_eq!((sync.ahead, sync.behind), expected, "{name}");
            assert_eq!(
                sync.upstream.as_deref(),
                (name != "local-only").then_some("refs/remotes/origin/main")
            );
        }
        assert!(
            rows.iter()
                .find(|row| row.detached)
                .unwrap()
                .branch_sync
                .is_none()
        );
        assert!(
            rows.iter()
                .find(|row| row.branch == "missing-dir")
                .unwrap()
                .branch_sync
                .is_none()
        );
    }
    assert_eq!(fs::read(repo.join(".git/index")).unwrap(), index_before);
    assert_eq!(git_line(repo, &["rev-parse", "HEAD"]).unwrap(), head_before);
    assert_eq!(fs::read(repo.join("dirty.txt")).unwrap(), b"working\n");
}

#[test]
fn worktree_sync_preserves_unknown_upstream_and_serializes_ipc_fields() {
    let fixture = TrackingFixture::new();
    let repo = &fixture.local;
    git(repo, &["update-ref", "-d", "refs/remotes/origin/main"]).unwrap();
    let rows = worktrees(repo).unwrap();
    let sync = rows[0].branch_sync.as_ref().unwrap();
    assert_eq!(sync.upstream.as_deref(), Some("refs/remotes/origin/main"));
    assert_eq!((sync.ahead, sync.behind), (None, None));
    let tauri::ipc::InvokeResponseBody::Json(json) =
        tauri::ipc::IpcResponse::body(&rows[0]).unwrap()
    else {
        panic!("工作区元数据应序列化为 JSON");
    };
    assert!(json.contains(
        "\"branchSync\":{\"upstream\":\"refs/remotes/origin/main\",\"ahead\":null,\"behind\":null}"
    ));
}

#[test]
fn worktree_sync_read_failure_does_not_hide_worktrees() {
    let fixture = TrackingFixture::new();
    let repo = &fixture.local;
    // Git 保留配置里的原始字节；同步列表无法解码时，正常工作区仍须可用。
    git(repo, &["config", "--unset-all", "branch.main.merge"]).unwrap();
    let config_path = repo.join(".git/config");
    let mut config = fs::read(&config_path).unwrap();
    config
        .extend_from_slice(b"\n[branch \"main\"]\nremote = .\nmerge = refs/heads/upstream-\xff\n");
    fs::write(config_path, config).unwrap();
    assert!(worktree_branch_sync(repo, "refs/heads/").is_err());
    let rows = worktrees(repo).unwrap();
    assert_eq!(rows.len(), 1);
    assert!(rows[0].available);
    assert_eq!(rows[0].branch, "main");
    assert!(rows[0].branch_sync.is_none());
}

#[test]
fn unborn_worktree_has_no_sync_status() {
    let directory = tempfile::tempdir().unwrap();
    let repo = fs::canonicalize(directory.path()).unwrap();
    git(&repo, &["init", "-b", "main"]).unwrap();
    let rows = worktrees(&repo).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].branch, "main");
    assert!(rows[0].branch_sync.is_none());
}

#[test]
fn worktree_upstream_configuration_is_resolved_in_each_worktree_context() {
    for mode in ["worktree", "onbranch", "gitdir"] {
        let fixture = TrackingFixture::new();
        let repo = &fixture.local;
        git(repo, &["branch", "--no-track", "topic", "main"]).unwrap();
        git(
            repo,
            &["worktree", "add", fixture.linked.to_str().unwrap(), "topic"],
        )
        .unwrap();
        commit_empty(repo, "advance main");
        if mode == "worktree" {
            git(repo, &["config", "extensions.worktreeConfig", "true"]).unwrap();
            git(
                &fixture.linked,
                &["config", "--worktree", "branch.topic.remote", "."],
            )
            .unwrap();
            git(
                &fixture.linked,
                &[
                    "config",
                    "--worktree",
                    "branch.topic.merge",
                    "refs/heads/main",
                ],
            )
            .unwrap();
        } else {
            let included = repo.parent().unwrap().join("topic.config");
            fs::write(
                &included,
                "[branch \"topic\"]\nremote = .\nmerge = refs/heads/main\n",
            )
            .unwrap();
            let condition = if mode == "onbranch" {
                "onbranch:topic".into()
            } else {
                format!(
                    "gitdir:{}",
                    git_line(&fixture.linked, &["rev-parse", "--absolute-git-dir"]).unwrap()
                )
            };
            git(
                repo,
                &[
                    "config",
                    &format!("includeIf.{condition}.path"),
                    included.to_str().unwrap(),
                ],
            )
            .unwrap();
        }
        for entry in [repo, &fixture.linked] {
            let rows = worktrees(entry).unwrap();
            let main = rows
                .iter()
                .find(|row| row.is_main)
                .unwrap()
                .branch_sync
                .as_ref()
                .unwrap();
            let topic = rows
                .iter()
                .find(|row| row.branch == "topic")
                .unwrap()
                .branch_sync
                .as_ref()
                .unwrap();
            assert_eq!(
                main.upstream.as_deref(),
                Some("refs/remotes/origin/main"),
                "{mode}"
            );
            assert_eq!((main.ahead, main.behind), (Some(1), Some(0)), "{mode}");
            assert_eq!(topic.upstream.as_deref(), Some("refs/heads/main"), "{mode}");
            assert_eq!((topic.ahead, topic.behind), (Some(0), Some(1)), "{mode}");
        }
    }
}
