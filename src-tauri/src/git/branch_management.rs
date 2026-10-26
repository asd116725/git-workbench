use super::*;

/// 创建成功后切换可能失败，不能把已存在的新分支误报为创建失败。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCreateBranchResult {
    pub branch: String,
    pub switched: bool,
    pub warning: Option<String>,
}

/// 删除确认绑定目标分支和当前 HEAD，过期预览必须重新确认风险。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDeleteBranchPreview {
    pub target_ref: String,
    pub target_name: String,
    pub target_oid: String,
    pub head_ref: Option<String>,
    pub head_oid: String,
    pub head_name: String,
    pub unmerged_commits: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDeleteBranchResult {
    pub branch: String,
    pub warning: Option<String>,
}

fn ensure_idle(repo: &Path) -> GitResult<()> {
    if operation(repo)?.is_some() {
        return Err("请先完成或中止当前 Git 操作，再创建或删除分支。".into());
    }
    Ok(())
}

fn ref_exists(repo: &Path, reference: &str) -> GitResult<bool> {
    let output = run_git(repo, &["show-ref", "--verify", "--quiet", reference])?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => checked(output).map(|_| false),
    }
}

/// 只接受字面分支名称，拒绝 Git 会扩展的 @{-1} 等检出历史表达式。
fn validate_name(repo: &Path, name: &str) -> GitResult<()> {
    let normalized = git_line(repo, &["check-ref-format", "--branch", name])
        .map_err(|_| "分支名称无效，请避免空格、连续点号、@{、反斜线等 Git 不允许的字符。")?;
    if normalized != name {
        return Err("请输入完整分支名称，不支持检出历史表达式。".into());
    }
    if ref_exists(repo, &format!("refs/heads/{name}"))? {
        return Err(format!("本地分支“{name}”已存在，请使用其他名称。"));
    }
    Ok(())
}

/// 先创建引用再尝试普通切换，未提交文件阻止切换时仍保留新分支。
pub(super) fn create_branch(
    repo: &Path,
    name: &str,
    start_ref: &str,
    switch: bool,
) -> GitResult<GitCreateBranchResult> {
    ensure_idle(repo)?;
    validate_name(repo, name)?;
    let remote = if start_ref == "HEAD" {
        if !has_head(repo)? {
            return Err("当前分支尚无提交，请先完成首次提交或选择其他起点分支。".into());
        }
        false
    } else {
        let selected = branches(repo)?
            .into_iter()
            .find(|branch| branch.full_name == start_ref)
            .ok_or("起点分支已不存在，请重新选择。")?;
        if selected.kind == "remote" && selected.local_name.is_none() {
            return Err("该远程分支没有对应的 remote 配置，无法建立跟踪关系。".into());
        }
        selected.kind == "remote"
    };
    let target_ref = format!("refs/heads/{name}");
    let start_oid = git_line(
        repo,
        &["rev-parse", "--verify", &format!("{start_ref}^{{commit}}")],
    )?;
    let result = git(
        repo,
        &[
            "branch",
            if remote {
                "--track=direct"
            } else {
                "--no-track"
            },
            "--",
            name,
            start_ref,
        ],
    );
    if let Err(error) = result {
        // Git 可能已写入引用，但后续分支配置写入失败，此时保留实际创建结果。
        if git_line(repo, &["rev-parse", "--verify", &target_ref]).as_deref()
            == Ok(start_oid.as_str())
        {
            return Ok(GitCreateBranchResult {
                branch: name.into(),
                switched: false,
                warning: Some(format!("分支已创建，但后续设置未完成：\n{error}")),
            });
        }
        return Err(error);
    }
    if !switch {
        return Ok(GitCreateBranchResult {
            branch: name.into(),
            switched: false,
            warning: None,
        });
    }
    match checkout(repo, &target_ref) {
        Ok(result) => Ok(GitCreateBranchResult {
            branch: result.branch,
            switched: true,
            warning: result.warning,
        }),
        Err(error) => Ok(GitCreateBranchResult {
            branch: name.into(),
            switched: false,
            warning: Some(format!(
                "分支已创建，但未能切换到新分支；请处理错误后手动切换：\n{error}"
            )),
        }),
    }
}

/// 合入状态只与当前 HEAD 比较，不把已推送到 upstream 当作可安全删除。
pub(super) fn delete_preview(repo: &Path, full_name: &str) -> GitResult<GitDeleteBranchPreview> {
    ensure_idle(repo)?;
    let selected = branches(repo)?
        .into_iter()
        .find(|branch| branch.kind == "local" && branch.full_name == full_name)
        .ok_or("只能删除已存在的本地分支，请刷新分支列表后重试。")?;
    if selected.current {
        return Err("不能删除当前分支，请先切换到其他分支。".into());
    }
    if let Some(path) = selected.worktree_path {
        return Err(format!("该分支正在被工作区“{path}”使用，不能删除。"));
    }
    if !has_head(repo)? {
        return Err("当前分支尚无提交，无法核对合入状态；请先选择有提交的分支。".into());
    }
    let head_ref = git_line(repo, &["symbolic-ref", "--quiet", "HEAD"]).ok();
    let head_oid = git_line(repo, &["rev-parse", "--verify", "HEAD^{commit}"])?;
    let target_oid = git_line(
        repo,
        &["rev-parse", "--verify", &format!("{full_name}^{{commit}}")],
    )?;
    let unmerged_commits = git_line(
        repo,
        &["rev-list", "--count", &target_oid, "--not", &head_oid],
    )?
    .parse()
    .map_err(|_| "无法读取尚未合入的提交数量。")?;
    let head_name = head_ref
        .as_deref()
        .and_then(|reference| reference.strip_prefix("refs/heads/"))
        .map(str::to_owned)
        .unwrap_or_else(|| format!("当前 HEAD · {}", &head_oid[..7]));
    Ok(GitDeleteBranchPreview {
        target_ref: selected.full_name,
        target_name: selected.name,
        target_oid,
        head_ref,
        head_oid,
        head_name,
        unmerged_commits,
    })
}

/// 重新读取真实状态后使用 Git 删除分支，同时保留其配置清理与工作区占用检查。
pub(super) fn delete_branch(
    repo: &Path,
    confirmed: &GitDeleteBranchPreview,
    force: bool,
) -> GitResult<GitDeleteBranchResult> {
    let current = delete_preview(repo, &confirmed.target_ref)?;
    if current.target_oid != confirmed.target_oid
        || current.head_ref != confirmed.head_ref
        || current.head_oid != confirmed.head_oid
        || current.unmerged_commits != confirmed.unmerged_commits
    {
        return Err("分支或当前 HEAD 已变化，请重新读取删除预览并确认。".into());
    }
    if current.unmerged_commits > 0 && !force {
        return Err(format!(
            "该分支有 {} 个提交尚未合入 {}，请明确确认后再强制删除。",
            current.unmerged_commits, current.head_name
        ));
    }
    // branch -d 优先检查 upstream；这里已按当前 HEAD 核对风险，再保留 Git 自身的占用检查与配置清理。
    let warning = match git(repo, &["branch", "-D", "--", &current.target_name]) {
        Ok(_) => None,
        Err(error) if !ref_exists(repo, &current.target_ref)? => {
            Some(format!("分支已删除，但后续清理未完成：\n{error}"))
        }
        Err(error) => return Err(error),
    };
    Ok(GitDeleteBranchResult {
        branch: current.target_name,
        warning,
    })
}

/// 创建分支后按用户选择切换，复用同一公共 Git 目录的写锁。
#[tauri::command]
pub async fn git_create_branch(
    repo_path: String,
    name: String,
    start_ref: String,
    checkout: bool,
) -> GitResult<GitCreateBranchResult> {
    blocking(move || {
        with_repository(&repo_path, |repo| {
            create_branch(repo, &name, &start_ref, checkout)
        })
    })
    .await
}

/// 删除预览仅读取风险信息，不修改分支、索引或工作区。
#[tauri::command]
pub async fn git_delete_branch_preview(
    repo_path: String,
    full_name: String,
) -> GitResult<GitDeleteBranchPreview> {
    blocking(move || with_repository(&repo_path, |repo| delete_preview(repo, &full_name))).await
}

/// 执行前重新校验预览，强制删除仍不得绕过当前分支及工作区占用保护。
#[tauri::command]
pub async fn git_delete_branch(
    repo_path: String,
    preview: GitDeleteBranchPreview,
    force: bool,
) -> GitResult<GitDeleteBranchResult> {
    blocking(move || with_repository(&repo_path, |repo| delete_branch(repo, &preview, force))).await
}
