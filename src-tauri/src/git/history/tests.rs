use super::*;
use tempfile::TempDir;

struct Repo {
    _directory: TempDir,
    root: PathBuf,
}

fn track(repo: &Path, branch: &str, upstream: &str) {
    git(repo, &["config", "remote.origin.url", "."]).unwrap();
    git(
        repo,
        &[
            "config",
            "remote.origin.fetch",
            "+refs/heads/*:refs/remotes/origin/*",
        ],
    )
    .unwrap();
    git(
        repo,
        &["branch", &format!("--set-upstream-to={upstream}"), branch],
    )
    .unwrap();
}

#[test]
fn outgoing_history_uses_reachability_for_merges_and_updates_after_push() {
    let repo = Repo::new();
    repo.initial();
    git(&repo.root, &["branch", "topic"]).unwrap();
    let local = repo.commit("local-only");
    git(&repo.root, &["checkout", "topic"]).unwrap();
    let shared = repo.commit("already-upstream");
    git(
        &repo.root,
        &["update-ref", "refs/remotes/origin/main", &shared],
    )
    .unwrap();
    track(&repo.root, "main", "origin/main");
    git(&repo.root, &["checkout", "main"]).unwrap();
    git(
        &repo.root,
        &["merge", "--no-ff", "topic", "-m", "merge-pending"],
    )
    .unwrap();
    let head = repo.head();
    let path = repo.root.to_str().unwrap();
    let outgoing = history_reference(path, None).unwrap().outgoing.unwrap();
    assert_eq!(outgoing.upstream, "refs/remotes/origin/main");
    assert_eq!(
        outgoing.oids.iter().collect::<HashSet<_>>(),
        [&head, &local].into_iter().collect()
    );
    let shared_result = history(&repo.root, &head, "already-upstream", None).unwrap();
    assert_eq!(shared_result.commits[0].oid, shared);
    assert!(!outgoing.oids.contains(&shared_result.commits[0].oid));

    repo.save("dirty.txt", "staged\n");
    fs::write(repo.root.join("dirty.txt"), "unstaged\n").unwrap();
    let dirty = git(&repo.root, &["status", "--porcelain=v1", "-z"]).unwrap();
    // 模拟推送后更新本地跟踪引用，HEAD 不变也应立即取消待推送标识。
    git(
        &repo.root,
        &["update-ref", "refs/remotes/origin/main", &head],
    )
    .unwrap();
    assert!(
        history_reference(path, None)
            .unwrap()
            .outgoing
            .unwrap()
            .oids
            .is_empty()
    );
    assert_eq!(
        git(&repo.root, &["status", "--porcelain=v1", "-z"]).unwrap(),
        dirty
    );
    assert_eq!(
        git(&repo.root, &["show", ":dirty.txt"]).unwrap(),
        b"staged\n"
    );
}

#[test]
fn outgoing_history_is_independent_of_pages_search_and_selected_branch() {
    let repo = Repo::new();
    let commits = repo.chain(60);
    git(
        &repo.root,
        &["update-ref", "refs/remotes/origin/main", &commits[0]],
    )
    .unwrap();
    track(&repo.root, "main", "origin/main");
    git(&repo.root, &["branch", "other", &commits[10]]).unwrap();
    git(
        &repo.root,
        &["update-ref", "refs/remotes/origin/other", &commits[9]],
    )
    .unwrap();
    track(&repo.root, "other", "origin/other");
    let snapshot = history_reference(repo.root.to_str().unwrap(), None).unwrap();
    let outgoing = snapshot.outgoing.unwrap();
    assert_eq!(outgoing.oids.len(), 60);
    let first = history(&repo.root, snapshot.oid.as_ref().unwrap(), "", None).unwrap();
    let next = history(
        &repo.root,
        snapshot.oid.as_ref().unwrap(),
        "",
        first.next_cursor.as_deref(),
    )
    .unwrap();
    assert!(
        next.commits
            .iter()
            .any(|item| outgoing.oids.contains(&item.oid))
    );
    assert!(!outgoing.oids.contains(&commits[0]));
    let selected =
        history_reference(repo.root.to_str().unwrap(), Some("refs/heads/other")).unwrap();
    assert_eq!(selected.outgoing.unwrap().oids, vec![commits[10].clone()]);
    assert_eq!(repo.head(), commits[60]);
}

#[test]
fn outgoing_history_hides_unknown_detached_remote_and_unborn_states() {
    let repo = Repo::new();
    let path = repo.root.to_str().unwrap();
    assert!(history_reference(path, None).unwrap().outgoing.is_none());
    let head = repo.initial();
    assert!(history_reference(path, None).unwrap().outgoing.is_none());
    git(
        &repo.root,
        &["update-ref", "refs/remotes/origin/main", &head],
    )
    .unwrap();
    track(&repo.root, "main", "origin/main");
    assert!(
        history_reference(path, Some("refs/remotes/origin/main"))
            .unwrap()
            .outgoing
            .is_none()
    );
    git(&repo.root, &["checkout", "--detach"]).unwrap();
    assert!(history_reference(path, None).unwrap().outgoing.is_none());
    git(&repo.root, &["checkout", "main"]).unwrap();
    git(
        &repo.root,
        &["update-ref", "-d", "refs/remotes/origin/main"],
    )
    .unwrap();
    let missing = history_reference(path, None).unwrap();
    assert_eq!(missing.oid, Some(head));
    assert!(missing.outgoing.is_none());
}

impl Repo {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        git(&root, &["init", "-b", "main"]).unwrap();
        git(&root, &["config", "user.name", "History Author"]).unwrap();
        git(&root, &["config", "user.email", "history@example.invalid"]).unwrap();
        git(&root, &["config", "commit.gpgSign", "false"]).unwrap();
        git(&root, &["config", "core.autocrlf", "false"]).unwrap();
        let hooks = root.join(".git/empty-hooks");
        fs::create_dir(&hooks).unwrap();
        git(
            &root,
            &["config", "core.hooksPath", hooks.to_str().unwrap()],
        )
        .unwrap();
        Self {
            _directory: directory,
            root,
        }
    }
    fn save(&self, path: &str, contents: impl AsRef<[u8]>) {
        let full = self.root.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, contents).unwrap();
        git(&self.root, &["add", "--", path]).unwrap();
    }
    fn commit(&self, message: &str) -> String {
        git(&self.root, &["commit", "--allow-empty", "-m", message]).unwrap();
        self.head()
    }
    fn head(&self) -> String {
        git_line(&self.root, &["rev-parse", "HEAD"]).unwrap()
    }
    fn initial(&self) -> String {
        self.save("file.txt", "base\n");
        self.commit("initial")
    }
    // commit-tree 构造较长且时间稳定的真实提交链，避免每条记录反复扫描工作区。
    fn chain(&self, count: usize) -> Vec<String> {
        let first = self.initial();
        let tree = git_line(&self.root, &["rev-parse", "HEAD^{tree}"]).unwrap();
        let mut commits = vec![first];
        for index in 1..=count {
            let previous = commits.last().unwrap();
            let mut command = command(&self.root);
            command
                .env(
                    "GIT_AUTHOR_DATE",
                    format!("{} +0000", 1_900_000_000 + index),
                )
                .env(
                    "GIT_COMMITTER_DATE",
                    format!("{} +0000", 1_900_000_000 + index),
                );
            let message = format!(
                "record {index}\n\n{}\n",
                if index % 2 == 0 {
                    "NEEDLE literal.*[x]"
                } else {
                    "other body"
                }
            );
            let oid = utf8(
                command_with_input(
                    command,
                    &["commit-tree", &tree, "-p", previous],
                    message.as_bytes(),
                )
                .unwrap(),
            )
            .unwrap()
            .trim()
            .to_owned();
            commits.push(oid);
        }
        git(
            &self.root,
            &["update-ref", "refs/heads/main", commits.last().unwrap()],
        )
        .unwrap();
        commits
    }
}

#[test]
fn reference_supports_empty_detached_local_remote_and_rejects_invalid_scope() {
    let repo = Repo::new();
    assert!(resolve_reference(&repo.root, None).unwrap().oid.is_none());
    let oid = repo.initial();
    assert_eq!(
        resolve_reference(&repo.root, None).unwrap().oid.as_deref(),
        Some(oid.as_str())
    );
    git(
        &repo.root,
        &["update-ref", "refs/remotes/origin/main", &oid],
    )
    .unwrap();
    assert_eq!(
        resolve_reference(&repo.root, Some("refs/remotes/origin/main"))
            .unwrap()
            .oid
            .as_deref(),
        Some(oid.as_str())
    );
    git(&repo.root, &["checkout", "--detach", &oid]).unwrap();
    assert_eq!(
        resolve_reference(&repo.root, None).unwrap().oid.as_deref(),
        Some(oid.as_str())
    );
    for reference in [
        "main",
        "--all",
        "refs/tags/test",
        "refs/heads/missing",
        "refs/heads/../main",
    ] {
        assert!(
            resolve_reference(&repo.root, Some(reference)).is_err(),
            "{reference}"
        );
    }
}

#[test]
fn pagination_freezes_more_than_one_hundred_commits_across_reference_moves_and_deletion() {
    let repo = Repo::new();
    let chain = repo.chain(108);
    let snapshot = repo.head();
    git(&repo.root, &["branch", "history-source"]).unwrap();
    let first = history(&repo.root, &snapshot, "", None).unwrap();
    assert_eq!(first.commits.len(), 50);
    assert!(first.next_cursor.is_some());
    git(
        &repo.root,
        &["update-ref", "refs/heads/history-source", &chain[40]],
    )
    .unwrap();
    git(&repo.root, &["branch", "-D", "history-source"]).unwrap();
    repo.commit("new current branch commit");
    let second = history(&repo.root, &snapshot, "", first.next_cursor.as_deref()).unwrap();
    assert_eq!(second.commits.len(), 50);
    let third = history(&repo.root, &snapshot, "", second.next_cursor.as_deref()).unwrap();
    assert_eq!(third.commits.len(), 9);
    assert!(third.next_cursor.is_none());
    let actual: Vec<_> = first
        .commits
        .into_iter()
        .chain(second.commits)
        .chain(third.commits)
        .map(|commit| commit.oid)
        .collect();
    assert_eq!(actual, chain.into_iter().rev().collect::<Vec<_>>());
}

#[test]
fn full_history_search_is_literal_or_and_pagination_has_no_gaps() {
    let repo = Repo::new();
    let chain = repo.chain(108);
    let snapshot = repo.head();
    let first = history(&repo.root, &snapshot, "needle literal.*[x]", None).unwrap();
    assert_eq!(first.commits.len(), 50);
    let second = history(
        &repo.root,
        &snapshot,
        "NEEDLE literal.*[x]",
        first.next_cursor.as_deref(),
    )
    .unwrap();
    assert_eq!(second.commits.len(), 4);
    assert!(second.next_cursor.is_none());
    let expected: Vec<_> = chain
        .iter()
        .enumerate()
        .rev()
        .filter(|(index, _)| *index > 0 && index % 2 == 0)
        .map(|(_, oid)| oid.clone())
        .collect();
    let actual: Vec<_> = first
        .commits
        .into_iter()
        .chain(second.commits)
        .map(|commit| commit.oid)
        .collect();
    assert_eq!(actual, expected);
    assert_eq!(
        history(&repo.root, &snapshot, &chain[1][..9], None)
            .unwrap()
            .commits
            .len(),
        1
    );
    assert_eq!(
        history(&repo.root, &snapshot, "HISTORY AUTHOR", None)
            .unwrap()
            .commits
            .len(),
        50
    );
    assert_eq!(
        history(&repo.root, &snapshot, "history@example.invalid", None)
            .unwrap()
            .commits
            .len(),
        50
    );
    assert_eq!(
        history(&repo.root, &snapshot, "record 1", None)
            .unwrap()
            .commits
            .len(),
        20
    );
    assert!(
        history(&repo.root, &snapshot, "[unknown]", None)
            .unwrap()
            .commits
            .is_empty()
    );
    assert!(
        history(&repo.root, &snapshot, " needle", None)
            .unwrap()
            .commits
            .is_empty()
    );
}

#[test]
fn search_matches_folded_subject_and_preserves_literal_whitespace() {
    let repo = Repo::new();
    repo.initial();
    let oid = repo.commit("first line\nsecond line\n\nbody");
    let page = history(&repo.root, &oid, "first line second line", None).unwrap();
    assert_eq!(page.commits.len(), 1);
    assert!(
        history(&repo.root, &oid, "first line second line ", None)
            .unwrap()
            .commits
            .is_empty()
    );
}

#[test]
fn cursor_is_bound_to_snapshot_and_query() {
    let repo = Repo::new();
    let chain = repo.chain(51);
    let snapshot = repo.head();
    let first = history(&repo.root, &snapshot, "", None).unwrap();
    let cursor = first.next_cursor.as_deref();
    assert!(history(&repo.root, &snapshot, "record", cursor).is_err());
    assert!(history(&repo.root, &chain[2], "", cursor).is_err());
    assert!(history(&repo.root, &snapshot, "", Some("invalid")).is_err());
    assert!(history(&repo.root, "HEAD", "", None).is_err());
}

#[test]
fn root_commit_and_empty_commit_details_are_read_only() {
    let repo = Repo::new();
    let root = repo.initial();
    let record = detail(&repo.root, &root, 0).unwrap();
    assert_eq!(record.commit.oid, root);
    assert_eq!(record.message, "initial");
    assert!(record.parent_oid.is_none());
    assert_eq!(record.files.len(), 1);
    assert_eq!(record.files[0].status, "A");
    let diff = historical_diff(&repo.root, &root, 0, "file.txt").unwrap();
    assert!(diff.original.is_none());
    assert_eq!(diff.modified.as_deref(), Some("base\n"));
    let empty = repo.commit("empty commit");
    assert!(detail(&repo.root, &empty, 0).unwrap().files.is_empty());
    assert!(detail(&repo.root, &root, 1).is_err());
    assert!(detail(&repo.root, &empty, 4).is_err());
}

#[test]
fn history_does_not_read_or_modify_current_index_and_working_files() {
    let repo = Repo::new();
    repo.initial();
    repo.save("file.txt", "committed version\n");
    let oid = repo.commit("change");
    repo.save("file.txt", "staged version\n");
    fs::write(repo.root.join("file.txt"), "working version\n").unwrap();
    let before_index = fs::read(repo.root.join(".git/index")).unwrap();
    let before_status = git(&repo.root, &["status", "--porcelain", "-z"]).unwrap();
    let diff = historical_diff(&repo.root, &oid, 0, "file.txt").unwrap();
    assert_eq!(diff.original.as_deref(), Some("base\n"));
    assert_eq!(diff.modified.as_deref(), Some("committed version\n"));
    history(&repo.root, &oid, "", None).unwrap();
    detail(&repo.root, &oid, 0).unwrap();
    assert_eq!(
        fs::read(repo.root.join(".git/index")).unwrap(),
        before_index
    );
    assert_eq!(
        git(&repo.root, &["status", "--porcelain", "-z"]).unwrap(),
        before_status
    );
    assert_eq!(
        fs::read_to_string(repo.root.join("file.txt")).unwrap(),
        "working version\n"
    );
}

#[test]
fn rename_delete_and_special_character_paths_use_exact_git_objects() {
    let repo = Repo::new();
    let old = "原文件\t:name\n.txt";
    let new = "目录/新名字\n.txt";
    repo.save(old, "same contents\n");
    repo.commit("initial path");
    fs::create_dir(repo.root.join("目录")).unwrap();
    git(&repo.root, &["mv", "--", old, new]).unwrap();
    let rename = repo.commit("rename");
    let files = detail(&repo.root, &rename, 0).unwrap().files;
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, new);
    assert_eq!(files[0].old_path.as_deref(), Some(old));
    assert_eq!(files[0].status, "R");
    assert!(
        historical_diff(&repo.root, &rename, 0, new)
            .unwrap()
            .notice
            .unwrap()
            .contains("路径")
    );
    git(&repo.root, &["rm", "--", new]).unwrap();
    let deletion = repo.commit("delete");
    let diff = historical_diff(&repo.root, &deletion, 0, new).unwrap();
    assert_eq!(diff.original.as_deref(), Some("same contents\n"));
    assert!(diff.modified.is_none());
    assert!(historical_diff(&repo.root, &rename, 0, old).is_err());
    assert!(historical_diff(&repo.root, &rename, 0, "../outside").is_err());
}

#[test]
fn merge_files_and_diff_follow_selected_parent() {
    let repo = Repo::new();
    repo.initial();
    git(&repo.root, &["checkout", "-b", "feature"]).unwrap();
    repo.save("feature.txt", "feature\n");
    let feature = repo.commit("feature");
    git(&repo.root, &["checkout", "main"]).unwrap();
    repo.save("main.txt", "main\n");
    let main = repo.commit("main");
    git(&repo.root, &["merge", "--no-ff", "--no-edit", "feature"]).unwrap();
    let merged = repo.head();
    let first = detail(&repo.root, &merged, 0).unwrap();
    assert_eq!(first.commit.parents, vec![main.clone(), feature.clone()]);
    assert_eq!(first.parent_oid.as_deref(), Some(main.as_str()));
    assert_eq!(first.files[0].path, "feature.txt");
    let second = detail(&repo.root, &merged, 1).unwrap();
    assert_eq!(second.parent_oid.as_deref(), Some(feature.as_str()));
    assert_eq!(second.files[0].path, "main.txt");
    assert_eq!(
        historical_diff(&repo.root, &merged, 1, "main.txt")
            .unwrap()
            .modified
            .as_deref(),
        Some("main\n")
    );
    assert!(historical_diff(&repo.root, &merged, 0, "main.txt").is_err());
}

#[test]
fn binary_large_non_utf8_and_submodules_show_history_notices() {
    let repo = Repo::new();
    let base = repo.initial();
    repo.save("binary.bin", b"one\0two");
    repo.save("legacy.txt", [0xff, 0xfe, 0xfd]);
    repo.save("large.txt", vec![b'x'; MAX_DIFF_BYTES as usize + 1]);
    git(
        &repo.root,
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("160000,{base},vendor/module"),
        ],
    )
    .unwrap();
    let oid = repo.commit("special files");
    for (path, expected) in [
        ("binary.bin", "二进制"),
        ("legacy.txt", "UTF-8"),
        ("large.txt", "2 MiB"),
        ("vendor/module", "子模块"),
    ] {
        let diff = historical_diff(&repo.root, &oid, 0, path).unwrap();
        let notice = diff.notice.unwrap();
        assert!(notice.contains(expected), "{notice}");
        assert!(!notice.contains("暂存"), "{notice}");
    }
}

#[cfg(unix)]
#[test]
fn mode_changes_and_symlink_contents_are_not_read_from_disk() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let repo = Repo::new();
    repo.initial();
    fs::set_permissions(
        repo.root.join("file.txt"),
        fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    git(&repo.root, &["config", "core.filemode", "true"]).unwrap();
    git(&repo.root, &["add", "file.txt"]).unwrap();
    symlink("/outside/does-not-exist.txt", repo.root.join("link.txt")).unwrap();
    git(&repo.root, &["add", "link.txt"]).unwrap();
    let oid = repo.commit("mode and link");
    let detail = detail(&repo.root, &oid, 0).unwrap();
    let file = detail
        .files
        .iter()
        .find(|file| file.path == "file.txt")
        .unwrap();
    assert_eq!(file.old_mode, "100644");
    assert_eq!(file.new_mode, "100755");
    assert!(
        historical_diff(&repo.root, &oid, 0, "file.txt")
            .unwrap()
            .notice
            .unwrap()
            .contains("文件模式")
    );
    assert_eq!(
        historical_diff(&repo.root, &oid, 0, "link.txt")
            .unwrap()
            .modified
            .as_deref(),
        Some("/outside/does-not-exist.txt")
    );
}

#[test]
fn frozen_history_reads_can_run_while_repository_write_lock_is_held() {
    let repo = Repo::new();
    let oid = repo.initial();
    let path = repo.root.to_str().unwrap();
    // 读取内部不重入公共锁；真实扫描仅依赖不可变 Git 对象。
    with_repository(path, |root| {
        assert_eq!(history(root, &oid, "", None)?.commits.len(), 1);
        assert_eq!(detail(root, &oid, 0)?.files.len(), 1);
        historical_diff(root, &oid, 0, "file.txt")?;
        Ok(())
    })
    .unwrap();
}

#[test]
fn failed_history_traversal_preserves_raw_git_error_source() {
    let repo = Repo::new();
    let parent = repo.initial();
    let head = repo.commit("second");
    fs::remove_file(
        repo.root
            .join(format!(".git/objects/{}/{}", &parent[..2], &parent[2..])),
    )
    .unwrap();
    let output = history_command(&repo.root)
        .args([&head, "--"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    let detail = String::from_utf8_lossy(&output.stderr);
    assert!(detail.contains(&parent));
    assert_eq!(
        history(&repo.root, &head, "", None).unwrap_err(),
        format!("Git:\n{detail}")
    );
}
