use super::*;

/// 从工作区自身的 Git 状态文件恢复操作，不依赖应用是否曾发起该操作。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOperation {
    pub kind: &'static str,
    pub head: String,
    pub merge_heads: Vec<String>,
    pub message: String,
    pub source: Option<String>,
}

/// 用户确认时的引用快照；执行前重新校验，防止外部分支切换或提交改变合并方向。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMergePreview {
    pub target_ref: String,
    pub target_branch: String,
    pub target_oid: String,
    pub source_ref: String,
    pub source_name: String,
    pub source_oid: String,
    pub incoming_commits: u64,
    pub fast_forward: bool,
    pub up_to_date: bool,
}

/// 冲突及 Hook 失败后的待完成状态是有效操作结果，前端必须刷新后继续处理。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeResult {
    pub outcome: &'static str,
    pub commit_id: Option<String>,
    pub warning: Option<String>,
}

fn git_path(repo: &Path, name: &str) -> GitResult<PathBuf> {
    Ok(PathBuf::from(git_line(
        repo,
        &["rev-parse", "--path-format=absolute", "--git-path", name],
    )?))
}

fn read_optional(path: &Path) -> GitResult<String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("无法读取 Git 操作状态：{error}")),
    }
}

/// 优先识别变基与 sequencer 操作，防止把变基内部的合并误当成独立合并继续。
pub(super) fn operation(repo: &Path) -> GitResult<Option<GitOperation>> {
    let git_dir = git_path(repo, "HEAD")?
        .parent()
        .ok_or("无法定位 Git 工作区状态目录。")?
        .to_path_buf();
    let merge_heads = read_optional(&git_dir.join("MERGE_HEAD"))?
        .split_whitespace()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let rebase_apply = git_dir.join("rebase-apply");
    let todo = read_optional(&git_dir.join("sequencer/todo"))?;
    let kind = if git_dir.join("rebase-merge").exists() || rebase_apply.join("rebasing").exists() {
        "rebase"
    } else if rebase_apply.exists() {
        "am"
    } else if git_dir.join("CHERRY_PICK_HEAD").exists()
        || todo.lines().any(|line| line.starts_with("pick "))
    {
        "cherry-pick"
    } else if git_dir.join("REVERT_HEAD").exists()
        || todo.lines().any(|line| line.starts_with("revert "))
    {
        "revert"
    } else if !merge_heads.is_empty() {
        "merge"
    } else {
        return Ok(None);
    };
    let message = read_optional(&git_dir.join("MERGE_MSG"))?;
    let source = if kind == "merge" && merge_heads.len() == 1 {
        merge_source(&message)
    } else {
        None
    };
    Ok(Some(GitOperation {
        kind,
        head: if has_head(repo)? {
            git_line(repo, &["rev-parse", "HEAD"])?
        } else {
            String::new()
        },
        merge_heads,
        message: if message.is_empty() {
            message
        } else {
            utf8(git_with_input(
                repo,
                &["stripspace", "--strip-comments"],
                message.as_bytes(),
            )?)?
        },
        source,
    }))
}

/// 多个分支可能指向同一提交；只从标准合并说明恢复来源，无法确认时交给界面显示 hash。
fn merge_source(message: &str) -> Option<String> {
    let line = message.lines().next()?;
    let rest = line
        .strip_prefix("Merge branch '")
        .or_else(|| line.strip_prefix("Merge remote-tracking branch '"))?;
    let source = rest
        .split_once("' into ")
        .map(|(source, _)| source)
        .or_else(|| rest.strip_suffix('\''))?;
    (!source.chars().any(char::is_whitespace)).then(|| source.to_owned())
}

fn is_ancestor(repo: &Path, ancestor: &str, descendant: &str) -> GitResult<bool> {
    let output = run_git(repo, &["merge-base", "--is-ancestor", ancestor, descendant])?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => checked(output).map(|_| false),
    }
}

/// 只接收真实分支引用，并要求干净工作区，避免合并混入当前未提交的改动。
fn preview(repo: &Path, source_ref: &str) -> GitResult<GitMergePreview> {
    if operation(repo)?.is_some() {
        return Err("请先完成或中止当前 Git 操作，再发起合并。".into());
    }
    if !has_head(repo)? {
        return Err("当前分支尚无提交，不能发起合并。".into());
    }
    let target = run_git(repo, &["symbolic-ref", "--quiet", "HEAD"])?;
    if !target.status.success() {
        return Err("当前处于分离 HEAD 状态，请先切换到本地分支。".into());
    }
    let target_ref = utf8(target.stdout)?.trim_end_matches('\n').to_owned();
    let target_branch = target_ref
        .strip_prefix("refs/heads/")
        .ok_or("当前 HEAD 不是本地分支。")?
        .to_owned();
    let source_name = source_ref
        .strip_prefix("refs/heads/")
        .or_else(|| source_ref.strip_prefix("refs/remotes/"))
        .ok_or("请选择有效的本地或远程分支。")?
        .to_owned();
    if !run_git(repo, &["check-ref-format", source_ref])?
        .status
        .success()
        || !run_git(repo, &["show-ref", "--verify", "--quiet", source_ref])?
            .status
            .success()
        || run_git(repo, &["symbolic-ref", "--quiet", source_ref])?
            .status
            .success()
    {
        return Err("合并来源分支不存在或不是独立分支，请刷新后重试。".into());
    }
    if source_ref == target_ref {
        return Err("不能将当前分支合并到自身。".into());
    }
    if !changes(repo)?.is_empty() {
        return Err("合并前请先提交或处理工作区和暂存区的全部变更，包括未跟踪文件。".into());
    }
    let target_oid = git_line(repo, &["rev-parse", "--verify", "HEAD^{commit}"])?;
    let source_oid = git_line(
        repo,
        &["rev-parse", "--verify", &format!("{source_ref}^{{commit}}")],
    )?;
    let incoming_commits = git_line(
        repo,
        &[
            "rev-list",
            "--count",
            &format!("{target_oid}..{source_oid}"),
        ],
    )?
    .parse()
    .map_err(|_| "无法读取待合入提交数量。")?;
    Ok(GitMergePreview {
        fast_forward: is_ancestor(repo, &target_oid, &source_oid)?,
        up_to_date: is_ancestor(repo, &source_oid, &target_oid)?,
        incoming_commits,
        target_ref,
        target_branch,
        target_oid,
        source_ref: source_ref.into(),
        source_name,
        source_oid,
    })
}

/// 根据命令执行后的真实状态分类，避免把发生冲突或 Hook 阻止提交误报成操作未发生。
fn merge_result(
    repo: &Path,
    before: &str,
    fast_forward_oid: Option<&str>,
    result: GitResult<Vec<u8>>,
) -> GitResult<GitMergeResult> {
    let current = operation(repo)?;
    if current
        .as_ref()
        .is_some_and(|operation| operation.kind == "merge")
    {
        let conflicted = changes(repo)?.iter().any(|file| file.conflicted);
        return Ok(GitMergeResult {
            outcome: if conflicted { "conflicts" } else { "pending" },
            commit_id: None,
            warning: if conflicted { None } else { result.err() },
        });
    }
    let head = git_line(repo, &["rev-parse", "HEAD"])?;
    if head == before {
        result?;
        return Ok(GitMergeResult {
            outcome: "upToDate",
            commit_id: None,
            warning: None,
        });
    }
    Ok(GitMergeResult {
        outcome: if fast_forward_oid == Some(head.as_str()) {
            "fastForward"
        } else {
            "merged"
        },
        commit_id: Some(head),
        warning: result.err(),
    })
}

/// 固定来源提交执行；显式指定策略与自动提交，不受 merge.ff 等默认设置改变操作含义。
fn merge(repo: &Path, confirmed: &GitMergePreview, no_ff: bool) -> GitResult<GitMergeResult> {
    let current = preview(repo, &confirmed.source_ref)?;
    if current.target_ref != confirmed.target_ref
        || current.target_oid != confirmed.target_oid
        || current.source_oid != confirmed.source_oid
    {
        return Err("目标分支或来源提交已变化，请重新选择并确认合并。".into());
    }
    let message = format!(
        "Merge branch '{}' into {}",
        current.source_name, current.target_branch
    );
    let mut command = command(repo);
    command
        .env("GIT_EDITOR", "true")
        .env("GIT_MERGE_AUTOEDIT", "no")
        .env("GIT_WORKBENCH_MERGE_OPTIONS", "");
    // 分离配置名和值，避免合法分支名中的等号被 -c 当成分隔符。
    let output = command
        .arg(format!(
            "--config-env=branch.{}.mergeOptions=GIT_WORKBENCH_MERGE_OPTIONS",
            current.target_branch
        ))
        .args([
            "merge",
            if no_ff { "--no-ff" } else { "--ff" },
            "--no-squash",
            "--commit",
            "--verify",
            "--no-edit",
            "--no-autostash",
            "-m",
            &message,
            "--",
            &current.source_oid,
        ])
        .output()
        .map_err(|error| format!("无法运行 Git 合并：{error}"))?;
    merge_result(
        repo,
        &current.target_oid,
        (!no_ff).then_some(current.source_oid.as_str()),
        checked(output),
    )
}

fn expected_merge(
    repo: &Path,
    expected_head: &str,
    expected_merge_heads: &[String],
) -> GitResult<GitOperation> {
    let operation = operation(repo)?
        .filter(|operation| operation.kind == "merge")
        .ok_or("当前工作区没有待完成的合并，请刷新后重试。")?;
    if operation.head != expected_head || operation.merge_heads != expected_merge_heads {
        return Err("合并状态已变化，请刷新并重新确认操作。".into());
    }
    Ok(operation)
}

fn continue_merge(
    repo: &Path,
    expected_head: &str,
    expected_merge_heads: &[String],
    message: &str,
) -> GitResult<GitMergeResult> {
    expected_merge(repo, expected_head, expected_merge_heads)?;
    let files = changes(repo)?;
    if files.iter().any(|file| file.conflicted) {
        return Err("仍有未解决的冲突，请解决并暂存所有冲突文件。".into());
    }
    if files
        .iter()
        .any(|file| !matches!(file.status_worktree.as_str(), " " | "?"))
    {
        return Err("仍有未暂存的文件修改，请暂存或处理后再完成合并。".into());
    }
    if message.trim().is_empty() {
        return Err("请填写合并提交说明。".into());
    }
    let mut command = command(repo);
    command.env("GIT_EDITOR", "true");
    // 即使索引与 HEAD 无差异，Git 仍需通过 MERGE_HEAD 建立双父提交。
    let result = command_with_input(
        command,
        &["commit", "--cleanup=whitespace", "-F", "-"],
        message.as_bytes(),
    );
    merge_result(repo, expected_head, None, result)
}

fn abort_merge(
    repo: &Path,
    expected_head: &str,
    expected_merge_heads: &[String],
) -> GitResult<GitMergeResult> {
    expected_merge(repo, expected_head, expected_merge_heads)?;
    let result = git(repo, &["merge", "--abort"]);
    if operation(repo)?.is_some() {
        result?;
        return Err("Git 合并尚未中止，请检查工作区状态后重试。".into());
    }
    Ok(GitMergeResult {
        outcome: "aborted",
        commit_id: None,
        warning: result.err(),
    })
}

/// 读取合并方向与提交数量，不修改工作区。
#[tauri::command]
pub async fn git_merge_preview(
    repo_path: String,
    source_ref: String,
) -> GitResult<GitMergePreview> {
    blocking(move || with_repository(&repo_path, |repo| preview(repo, &source_ref))).await
}

/// 在公共仓库锁内校验确认快照，再执行标准 Git 合并。
#[tauri::command]
pub async fn git_merge(
    repo_path: String,
    preview: GitMergePreview,
    no_ff: bool,
) -> GitResult<GitMergeResult> {
    blocking(move || with_repository(&repo_path, |repo| merge(repo, &preview, no_ff))).await
}

/// 所有冲突已解决并暂存后，完成当前工作区的合并提交。
#[tauri::command]
pub async fn git_merge_continue(
    repo_path: String,
    expected_head: String,
    expected_merge_heads: Vec<String>,
    message: String,
) -> GitResult<GitMergeResult> {
    blocking(move || {
        with_repository(&repo_path, |repo| {
            continue_merge(repo, &expected_head, &expected_merge_heads, &message)
        })
    })
    .await
}

/// 使用 Git 的中止语义保留保护检查，不强制重置工作区。
#[tauri::command]
pub async fn git_merge_abort(
    repo_path: String,
    expected_head: String,
    expected_merge_heads: Vec<String>,
) -> GitResult<GitMergeResult> {
    blocking(move || {
        with_repository(&repo_path, |repo| {
            abort_merge(repo, &expected_head, &expected_merge_heads)
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    struct Repo {
        _directory: TempDir,
        root: PathBuf,
    }

    impl Repo {
        fn new() -> Self {
            let directory = tempfile::tempdir().unwrap();
            let root = fs::canonicalize(directory.path()).unwrap();
            git(&root, &["init", "-b", "main"]).unwrap();
            git(&root, &["config", "user.name", "Merge Test"]).unwrap();
            git(&root, &["config", "user.email", "merge@example.invalid"]).unwrap();
            git(&root, &["config", "commit.gpgSign", "false"]).unwrap();
            git(&root, &["config", "core.autocrlf", "false"]).unwrap();
            let hooks = root.join(".git/test-hooks");
            fs::create_dir(&hooks).unwrap();
            git(
                &root,
                &["config", "core.hooksPath", hooks.to_str().unwrap()],
            )
            .unwrap();
            let repo = Self {
                _directory: directory,
                root,
            };
            repo.save("file.txt", "base\n", "initial");
            repo
        }
        fn save(&self, path: &str, content: &str, message: &str) {
            fs::write(self.root.join(path), content).unwrap();
            git(&self.root, &["add", path]).unwrap();
            git(&self.root, &["commit", "-m", message]).unwrap();
        }
        fn feature(&self, conflicting: bool) {
            git(&self.root, &["checkout", "-b", "feature"]).unwrap();
            self.save(
                if conflicting {
                    "file.txt"
                } else {
                    "feature.txt"
                },
                "feature\n",
                "feature commit",
            );
            git(&self.root, &["checkout", "main"]).unwrap();
        }
        fn divergent(&self, conflicting: bool) {
            self.feature(conflicting);
            self.save(
                if conflicting { "file.txt" } else { "main.txt" },
                "main\n",
                "main commit",
            );
        }
        fn preview(&self) -> GitMergePreview {
            preview(&self.root, "refs/heads/feature").unwrap()
        }
        fn pending(&self) -> GitOperation {
            operation(&self.root).unwrap().unwrap()
        }
        fn parents(&self) -> Vec<String> {
            git_line(&self.root, &["show", "-s", "--format=%P", "HEAD"])
                .unwrap()
                .split_whitespace()
                .map(str::to_owned)
                .collect()
        }
        #[cfg(unix)]
        fn hook(&self, name: &str, source: &str) {
            use std::os::unix::fs::PermissionsExt;
            let path = self.root.join(".git/test-hooks").join(name);
            fs::write(&path, source).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    #[test]
    fn preview_and_fast_forward_override_configured_no_ff() {
        let repo = Repo::new();
        repo.feature(false);
        git(&repo.root, &["config", "merge.ff", "false"]).unwrap();
        let preview = repo.preview();
        assert_eq!(preview.target_ref, "refs/heads/main");
        assert_eq!(preview.target_branch, "main");
        assert_eq!(preview.source_name, "feature");
        assert!(preview.fast_forward);
        assert!(!preview.up_to_date);
        assert_eq!(preview.incoming_commits, 1);
        let result = merge(&repo.root, &preview, false).unwrap();
        assert_eq!(result.outcome, "fastForward");
        assert_eq!(
            result.commit_id.as_deref(),
            Some(preview.source_oid.as_str())
        );
        assert!(repo.root.join("feature.txt").exists());
        assert!(operation(&repo.root).unwrap().is_none());
        let current = repo.preview();
        assert!(current.up_to_date);
        assert_eq!(current.incoming_commits, 0);
        assert_eq!(
            merge(&repo.root, &current, false).unwrap().outcome,
            "upToDate"
        );
    }

    #[test]
    fn no_ff_creates_two_parents_even_when_fast_forward_is_possible() {
        let repo = Repo::new();
        repo.feature(false);
        let preview = repo.preview();
        assert_eq!(merge(&repo.root, &preview, true).unwrap().outcome, "merged");
        assert_eq!(repo.parents(), vec![preview.target_oid, preview.source_oid]);
        assert_eq!(
            merge(&repo.root, &repo.preview(), true).unwrap().outcome,
            "upToDate"
        );
    }

    #[test]
    fn divergent_normal_merge_creates_two_parents() {
        let repo = Repo::new();
        repo.divergent(false);
        let preview = repo.preview();
        assert!(!preview.fast_forward);
        assert_eq!(
            merge(&repo.root, &preview, false).unwrap().outcome,
            "merged"
        );
        assert_eq!(repo.parents(), vec![preview.target_oid, preview.source_oid]);
        assert!(repo.root.join("main.txt").exists());
        assert!(repo.root.join("feature.txt").exists());
    }

    #[test]
    fn branch_merge_options_cannot_change_confirmed_merge_strategy() {
        let repo = Repo::new();
        repo.divergent(false);
        let options = "--squash --no-verify --no-commit";
        git(&repo.root, &["config", "branch.main.mergeOptions", options]).unwrap();
        let confirmed = repo.preview();
        assert_eq!(
            merge(&repo.root, &confirmed, false).unwrap().outcome,
            "merged"
        );
        assert_eq!(
            repo.parents(),
            vec![confirmed.target_oid, confirmed.source_oid]
        );
        assert_eq!(
            git_line(&repo.root, &["config", "branch.main.mergeOptions"]).unwrap(),
            options
        );
    }

    #[test]
    fn target_branch_with_equals_preserves_confirmed_merge_strategy() {
        let repo = Repo::new();
        repo.divergent(false);
        git(&repo.root, &["branch", "-m", "topic/a=b"]).unwrap();
        let key = "branch.topic/a=b.mergeOptions";
        let options = "--squash --no-verify --no-commit";
        git(&repo.root, &["config", key, options]).unwrap();
        let confirmed = repo.preview();
        assert_eq!(confirmed.target_branch, "topic/a=b");
        assert_eq!(
            merge(&repo.root, &confirmed, false).unwrap().outcome,
            "merged"
        );
        assert_eq!(
            repo.parents(),
            vec![confirmed.target_oid, confirmed.source_oid]
        );
        assert_eq!(git_line(&repo.root, &["config", key]).unwrap(), options);
    }

    #[test]
    fn operation_source_does_not_guess_between_refs_with_the_same_commit() {
        let repo = Repo::new();
        repo.divergent(true);
        git(&repo.root, &["branch", "aaa-alias", "feature"]).unwrap();
        merge(&repo.root, &repo.preview(), false).unwrap();
        assert_eq!(repo.pending().source.as_deref(), Some("feature"));
        fs::write(repo.root.join(".git/MERGE_MSG"), "Custom merge message\n").unwrap();
        assert!(repo.pending().source.is_none());
        assert_eq!(
            merge_source("Merge remote-tracking branch 'origin/feature' into main"),
            Some("origin/feature".into())
        );
        assert_eq!(
            merge_source("Merge branch 'feature/o'brien' into main"),
            Some("feature/o'brien".into())
        );
    }

    #[test]
    fn conflicted_merge_recovers_state_and_requires_resolved_staged_changes() {
        let repo = Repo::new();
        repo.divergent(true);
        let preview = repo.preview();
        assert_eq!(
            merge(&repo.root, &preview, false).unwrap().outcome,
            "conflicts"
        );
        let operation = repo.pending();
        assert_eq!(operation.kind, "merge");
        assert_eq!(operation.head, preview.target_oid);
        assert_eq!(operation.merge_heads, vec![preview.source_oid.clone()]);
        assert_eq!(operation.source.as_deref(), Some("feature"));
        assert!(
            operation
                .message
                .contains("Merge branch 'feature' into main")
        );
        assert!(!operation.message.contains("# Conflicts"));
        assert_eq!(
            status(&repo.root).unwrap().operation.unwrap().merge_heads,
            operation.merge_heads
        );
        assert!(commit(&repo.root, "普通提交不应完成合并", "").is_err());
        assert!(
            continue_merge(
                &repo.root,
                &operation.head,
                &operation.merge_heads,
                "完成合并"
            )
            .unwrap_err()
            .contains("冲突")
        );
        fs::write(repo.root.join("file.txt"), "resolved\n").unwrap();
        stage_paths(&repo.root, &["file.txt".into()]).unwrap();
        fs::write(repo.root.join("file.txt"), "unstaged edit\n").unwrap();
        assert!(
            continue_merge(
                &repo.root,
                &operation.head,
                &operation.merge_heads,
                "完成合并"
            )
            .unwrap_err()
            .contains("未暂存")
        );
        stage_paths(&repo.root, &["file.txt".into()]).unwrap();
        assert!(
            continue_merge(&repo.root, &operation.head, &operation.merge_heads, " \n ").is_err()
        );
        assert_eq!(
            continue_merge(
                &repo.root,
                &operation.head,
                &operation.merge_heads,
                "完成合并\n\n# 保留正文标题\n保留说明"
            )
            .unwrap()
            .outcome,
            "merged"
        );
        assert_eq!(repo.parents(), vec![preview.target_oid, preview.source_oid]);
        assert_eq!(
            git_line(&repo.root, &["log", "-1", "--format=%B"])
                .unwrap()
                .trim_end(),
            "完成合并\n\n# 保留正文标题\n保留说明"
        );
        assert!(super::operation(&repo.root).unwrap().is_none());
    }

    #[test]
    fn resolving_conflicts_to_head_allows_zero_diff_merge_commit() {
        let repo = Repo::new();
        repo.divergent(true);
        let preview = repo.preview();
        merge(&repo.root, &preview, false).unwrap();
        let operation = repo.pending();
        fs::write(repo.root.join("file.txt"), "main\n").unwrap();
        stage_paths(&repo.root, &["file.txt".into()]).unwrap();
        assert!(changes(&repo.root).unwrap().is_empty());
        assert_eq!(
            continue_merge(
                &repo.root,
                &operation.head,
                &operation.merge_heads,
                &operation.message
            )
            .unwrap()
            .outcome,
            "merged"
        );
        assert_eq!(repo.parents(), vec![preview.target_oid, preview.source_oid]);
    }

    #[test]
    fn modify_delete_conflicts_stage_actual_file_for_either_resolution() {
        for target_deleted in [false, true] {
            for keep_file in [false, true] {
                let repo = Repo::new();
                git(&repo.root, &["checkout", "-b", "feature"]).unwrap();
                if target_deleted {
                    repo.save("file.txt", "feature retained\n", "source modification");
                } else {
                    git(&repo.root, &["rm", "file.txt"]).unwrap();
                    git(&repo.root, &["commit", "-m", "source deletion"]).unwrap();
                }
                git(&repo.root, &["checkout", "main"]).unwrap();
                if target_deleted {
                    git(&repo.root, &["rm", "file.txt"]).unwrap();
                    git(&repo.root, &["commit", "-m", "target deletion"]).unwrap();
                } else {
                    repo.save("file.txt", "main retained\n", "target modification");
                }
                let confirmed = repo.preview();
                assert_eq!(
                    merge(&repo.root, &confirmed, false).unwrap().outcome,
                    "conflicts"
                );
                let conflict = changes(&repo.root).unwrap().remove(0);
                assert_eq!(
                    format!("{}{}", conflict.status_index, conflict.status_worktree),
                    if target_deleted { "DU" } else { "UD" }
                );
                let retained = fs::read_to_string(repo.root.join("file.txt")).unwrap();
                if !keep_file {
                    fs::remove_file(repo.root.join("file.txt")).unwrap();
                }
                stage_paths(&repo.root, &["file.txt".into()]).unwrap();
                assert!(
                    changes(&repo.root)
                        .unwrap()
                        .iter()
                        .all(|file| !file.conflicted)
                );
                assert_eq!(
                    run_git(
                        &repo.root,
                        &["ls-files", "--error-unmatch", "--", "file.txt"]
                    )
                    .unwrap()
                    .status
                    .success(),
                    keep_file
                );
                let pending = repo.pending();
                assert_eq!(
                    continue_merge(
                        &repo.root,
                        &pending.head,
                        &pending.merge_heads,
                        &pending.message
                    )
                    .unwrap()
                    .outcome,
                    "merged"
                );
                assert_eq!(
                    repo.parents(),
                    vec![confirmed.target_oid, confirmed.source_oid]
                );
                assert_eq!(repo.root.join("file.txt").exists(), keep_file);
                if keep_file {
                    assert_eq!(
                        utf8(git(&repo.root, &["show", "HEAD:file.txt"]).unwrap()).unwrap(),
                        retained
                    );
                }
                assert!(changes(&repo.root).unwrap().is_empty());
            }
        }
    }

    #[test]
    fn abort_restores_original_head_and_files_and_rejects_stale_confirmation() {
        let repo = Repo::new();
        repo.divergent(true);
        let preview = repo.preview();
        merge(&repo.root, &preview, false).unwrap();
        let operation = repo.pending();
        assert!(abort_merge(&repo.root, &preview.source_oid, &operation.merge_heads).is_err());
        assert!(
            continue_merge(
                &repo.root,
                &operation.head,
                &[operation.head.clone()],
                &operation.message
            )
            .is_err()
        );
        assert_eq!(
            abort_merge(&repo.root, &operation.head, &operation.merge_heads)
                .unwrap()
                .outcome,
            "aborted"
        );
        assert_eq!(
            git_line(&repo.root, &["rev-parse", "HEAD"]).unwrap(),
            preview.target_oid
        );
        assert_eq!(
            fs::read_to_string(repo.root.join("file.txt")).unwrap(),
            "main\n"
        );
        assert!(changes(&repo.root).unwrap().is_empty());
        assert!(abort_merge(&repo.root, &operation.head, &operation.merge_heads).is_err());
    }

    #[test]
    fn dirty_untracked_staged_detached_and_unborn_states_cannot_start_merge() {
        let repo = Repo::new();
        repo.feature(false);
        let confirmed = repo.preview();
        fs::write(repo.root.join("loose.txt"), "untracked").unwrap();
        assert!(
            preview(&repo.root, "refs/heads/feature")
                .unwrap_err()
                .contains("未跟踪")
        );
        assert!(merge(&repo.root, &confirmed, false).is_err());
        fs::remove_file(repo.root.join("loose.txt")).unwrap();
        fs::write(repo.root.join("file.txt"), "dirty\n").unwrap();
        assert!(preview(&repo.root, "refs/heads/feature").is_err());
        git(&repo.root, &["add", "file.txt"]).unwrap();
        assert!(preview(&repo.root, "refs/heads/feature").is_err());
        git(&repo.root, &["reset", "--hard", "HEAD"]).unwrap();
        git(&repo.root, &["checkout", "--detach"]).unwrap();
        assert!(
            preview(&repo.root, "refs/heads/feature")
                .unwrap_err()
                .contains("分离")
        );
        git(&repo.root, &["checkout", "--orphan", "empty"]).unwrap();
        assert!(
            preview(&repo.root, "refs/heads/feature")
                .unwrap_err()
                .contains("尚无提交")
        );
    }

    #[test]
    fn source_must_be_a_real_branch_and_snapshot_guards_changed_refs() {
        let repo = Repo::new();
        repo.feature(false);
        for source in [
            "refs/heads/main",
            "feature",
            "HEAD",
            "refs/heads/feature~1",
            "refs/heads/missing",
            "--help",
        ] {
            assert!(preview(&repo.root, source).is_err(), "{source}");
        }
        git(
            &repo.root,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/heads/feature",
            ],
        )
        .unwrap();
        assert!(preview(&repo.root, "refs/remotes/origin/HEAD").is_err());
        let confirmed = repo.preview();
        git(&repo.root, &["update-ref", "refs/heads/feature", "HEAD"]).unwrap();
        assert!(
            merge(&repo.root, &confirmed, false)
                .unwrap_err()
                .contains("已变化")
        );
        git(
            &repo.root,
            &["update-ref", "refs/heads/feature", &confirmed.source_oid],
        )
        .unwrap();
        git(&repo.root, &["checkout", "-b", "other"]).unwrap();
        assert!(
            merge(&repo.root, &confirmed, false)
                .unwrap_err()
                .contains("已变化")
        );
        git(&repo.root, &["checkout", "main"]).unwrap();
        repo.save("new.txt", "new\n", "new target");
        assert!(
            merge(&repo.root, &confirmed, false)
                .unwrap_err()
                .contains("已变化")
        );
    }

    #[test]
    fn remote_branch_can_merge_without_fetching_or_checking_it_out() {
        let repo = Repo::new();
        repo.feature(false);
        git(
            &repo.root,
            &[
                "update-ref",
                "refs/remotes/origin/feature",
                "refs/heads/feature",
            ],
        )
        .unwrap();
        let preview = preview(&repo.root, "refs/remotes/origin/feature").unwrap();
        assert_eq!(preview.source_name, "origin/feature");
        assert_eq!(
            merge(&repo.root, &preview, false).unwrap().outcome,
            "fastForward"
        );
    }

    #[test]
    fn source_checked_out_elsewhere_is_allowed_and_merge_state_is_worktree_local() {
        let repo = Repo::new();
        repo.divergent(true);
        let directory = tempfile::tempdir().unwrap();
        let worktree = directory.path().join("linked");
        git(
            &repo.root,
            &["worktree", "add", worktree.to_str().unwrap(), "feature"],
        )
        .unwrap();
        let preview = preview(&worktree, "refs/heads/main").unwrap();
        assert_eq!(
            merge(&worktree, &preview, false).unwrap().outcome,
            "conflicts"
        );
        assert!(operation(&repo.root).unwrap().is_none());
        let operation = operation(&worktree).unwrap().unwrap();
        assert_eq!(operation.head, preview.target_oid);
        assert_eq!(operation.merge_heads, vec![preview.source_oid]);
        assert_eq!(
            abort_merge(&worktree, &operation.head, &operation.merge_heads)
                .unwrap()
                .outcome,
            "aborted"
        );
        assert!(repo.preview().source_name == "feature");
    }

    #[test]
    fn other_operations_block_merges_and_are_reported() {
        let repo = Repo::new();
        repo.feature(false);
        let git_dir = repo.root.join(".git");
        for (path, kind) in [
            ("CHERRY_PICK_HEAD", "cherry-pick"),
            ("REVERT_HEAD", "revert"),
        ] {
            fs::write(git_dir.join(path), repo.preview().source_oid).unwrap();
            assert_eq!(operation(&repo.root).unwrap().unwrap().kind, kind);
            assert!(preview(&repo.root, "refs/heads/feature").is_err());
            fs::remove_file(git_dir.join(path)).unwrap();
        }
        fs::create_dir(git_dir.join("rebase-merge")).unwrap();
        assert_eq!(operation(&repo.root).unwrap().unwrap().kind, "rebase");
        assert!(preview(&repo.root, "refs/heads/feature").is_err());
        fs::remove_dir(git_dir.join("rebase-merge")).unwrap();
        fs::create_dir(git_dir.join("rebase-apply")).unwrap();
        assert_eq!(operation(&repo.root).unwrap().unwrap().kind, "am");
        fs::write(git_dir.join("rebase-apply/rebasing"), "").unwrap();
        assert_eq!(operation(&repo.root).unwrap().unwrap().kind, "rebase");
    }

    #[cfg(unix)]
    #[test]
    fn hooks_failure_keeps_pending_merge_and_can_continue() {
        let repo = Repo::new();
        repo.divergent(false);
        git(
            &repo.root,
            &["config", "branch.main.mergeOptions", "--no-verify"],
        )
        .unwrap();
        repo.hook(
            "pre-merge-commit",
            "#!/bin/sh\necho 'merge hook rejected' >&2\nexit 1\n",
        );
        let preview = repo.preview();
        let result = merge(&repo.root, &preview, false).unwrap();
        assert_eq!(result.outcome, "pending");
        assert!(result.warning.unwrap().contains("merge hook rejected"));
        let operation = repo.pending();
        repo.hook(
            "pre-commit",
            "#!/bin/sh\necho 'commit hook rejected' >&2\nexit 1\n",
        );
        let result = continue_merge(
            &repo.root,
            &operation.head,
            &operation.merge_heads,
            &operation.message,
        )
        .unwrap();
        assert_eq!(result.outcome, "pending");
        assert!(result.warning.unwrap().contains("commit hook rejected"));
        assert_eq!(repo.pending().merge_heads, operation.merge_heads);
        fs::remove_file(repo.root.join(".git/test-hooks/pre-commit")).unwrap();
        assert_eq!(
            continue_merge(
                &repo.root,
                &operation.head,
                &operation.merge_heads,
                &operation.message
            )
            .unwrap()
            .outcome,
            "merged"
        );
        assert_eq!(repo.parents(), vec![preview.target_oid, preview.source_oid]);
    }

    #[test]
    fn unrelated_history_error_does_not_create_pending_state() {
        let repo = Repo::new();
        git(&repo.root, &["checkout", "--orphan", "other"]).unwrap();
        repo.save("other.txt", "new root\n", "unrelated");
        git(&repo.root, &["checkout", "main"]).unwrap();
        let preview = preview(&repo.root, "refs/heads/other").unwrap();
        assert!(merge(&repo.root, &preview, false).is_err());
        assert!(operation(&repo.root).unwrap().is_none());
        assert_eq!(
            git_line(&repo.root, &["rev-parse", "HEAD"]).unwrap(),
            preview.target_oid
        );
    }

    #[test]
    fn externally_started_merge_is_recovered_and_completed() {
        let repo = Repo::new();
        repo.divergent(false);
        let expected = repo.preview();
        git(&repo.root, &["merge", "--no-commit", "--no-ff", "feature"]).unwrap();
        let pending = status(&repo.root).unwrap().operation.unwrap();
        assert_eq!(pending.kind, "merge");
        assert_eq!(pending.head, expected.target_oid);
        assert_eq!(pending.merge_heads, vec![expected.source_oid.clone()]);
        assert!(!pending.message.trim().is_empty());
        let error = tauri::async_runtime::block_on(git_checkout(
            repo.root.to_string_lossy().into_owned(),
            "refs/heads/feature".into(),
        ))
        .unwrap_err();
        assert!(error.contains("完成或中止"));
        assert_eq!(
            continue_merge(
                &repo.root,
                &pending.head,
                &pending.merge_heads,
                &pending.message
            )
            .unwrap()
            .outcome,
            "merged"
        );
        assert_eq!(
            repo.parents(),
            vec![expected.target_oid, expected.source_oid]
        );
    }

    #[test]
    fn abort_keeps_git_protection_for_edits_made_after_resolution() {
        let repo = Repo::new();
        repo.divergent(true);
        merge(&repo.root, &repo.preview(), false).unwrap();
        let pending = repo.pending();
        fs::write(repo.root.join("file.txt"), "resolved\n").unwrap();
        stage_paths(&repo.root, &["file.txt".into()]).unwrap();
        fs::write(repo.root.join("file.txt"), "later edit\n").unwrap();
        assert!(abort_merge(&repo.root, &pending.head, &pending.merge_heads).is_err());
        assert_eq!(repo.pending().merge_heads, pending.merge_heads);
        assert_eq!(
            fs::read_to_string(repo.root.join("file.txt")).unwrap(),
            "later edit\n"
        );
    }

    #[test]
    fn signing_failure_preserves_pending_merge_for_retry() {
        let repo = Repo::new();
        repo.divergent(false);
        git(&repo.root, &["config", "commit.gpgSign", "true"]).unwrap();
        git(&repo.root, &["config", "gpg.format", "openpgp"]).unwrap();
        git(&repo.root, &["config", "user.signingKey", "test-only"]).unwrap();
        let missing_program = repo.root.join("missing-gpg-program");
        git(
            &repo.root,
            &["config", "gpg.program", missing_program.to_str().unwrap()],
        )
        .unwrap();
        let confirmed = repo.preview();
        let result = merge(&repo.root, &confirmed, false).unwrap();
        assert_eq!(result.outcome, "pending");
        assert!(result.warning.is_some());
        let pending = repo.pending();
        assert_eq!(pending.head, confirmed.target_oid);
        assert_eq!(
            continue_merge(
                &repo.root,
                &pending.head,
                &pending.merge_heads,
                &pending.message
            )
            .unwrap()
            .outcome,
            "pending"
        );
        git(&repo.root, &["config", "commit.gpgSign", "false"]).unwrap();
        assert_eq!(
            continue_merge(
                &repo.root,
                &pending.head,
                &pending.merge_heads,
                &pending.message
            )
            .unwrap()
            .outcome,
            "merged"
        );
    }
}
