use super::*;

/// 工作区列表保留已丢失目录、锁定原因和裸仓库，供界面展示不可用状态。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeInfo {
    pub path: String,
    pub name: String,
    pub branch: String,
    pub detached: bool,
    pub bare: bool,
    pub is_main: bool,
    pub locked: Option<String>,
    pub prunable: Option<String>,
    pub available: bool,
}

/// fullName 是切换操作的唯一标识；远程分支的 localName 按实际 remote 名称去除前缀。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub full_name: String,
    pub name: String,
    pub kind: &'static str,
    pub current: bool,
    pub worktree_path: Option<String>,
    pub upstream: Option<String>,
    pub local_name: Option<String>,
    pub last_commit: BranchCommit,
}

/// 使用提交者时间排序，与 Git 的分支最近提交顺序一致；作者用于界面署名。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCommit {
    pub short_hash: String,
    pub author: String,
    pub subject: String,
    pub committed_at: i64,
}

#[derive(Debug, Serialize)]
pub struct CheckoutResult {
    pub branch: String,
    pub warning: Option<String>,
}

pub(super) fn common_directory(repo: &Path) -> GitResult<PathBuf> {
    let path = git_line(
        repo,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    fs::canonicalize(path).map_err(|error| format!("无法定位 Git 公共目录：{error}"))
}

/// -z 用空字段分隔工作区、NUL 分隔属性，路径和锁定原因里的换行不能作为分隔符。
fn parse_worktrees(bytes: &[u8]) -> GitResult<Vec<GitWorktreeInfo>> {
    let text = utf8(bytes.to_vec())?;
    let mut result = Vec::new();
    for record in text.split("\0\0").filter(|record| !record.is_empty()) {
        let mut fields = record.split('\0');
        let path = fields
            .next()
            .and_then(|field| field.strip_prefix("worktree "))
            .ok_or("无法解析 Git 工作区列表。")?;
        let canonical = fs::canonicalize(path).ok();
        let mut worktree = GitWorktreeInfo {
            path: canonical
                .as_deref()
                .unwrap_or_else(|| Path::new(path))
                .to_string_lossy()
                .into_owned(),
            name: String::new(),
            branch: "尚无提交".into(),
            detached: false,
            bare: false,
            is_main: result.is_empty(),
            locked: None,
            prunable: None,
            available: canonical.is_some_and(|path| path.is_dir()),
        };
        let mut head = "";
        for field in fields {
            if let Some(branch) = field.strip_prefix("branch refs/heads/") {
                worktree.branch = branch.into();
            } else if let Some(object) = field.strip_prefix("HEAD ") {
                head = object;
            } else if field == "bare" {
                worktree.bare = true;
            } else if field == "detached" {
                worktree.detached = true;
            } else if field == "locked" || field.starts_with("locked ") {
                worktree.locked = Some(field.strip_prefix("locked ").unwrap_or("").into());
            } else if field == "prunable" || field.starts_with("prunable ") {
                worktree.prunable = Some(field.strip_prefix("prunable ").unwrap_or("").into());
            }
        }
        if worktree.detached {
            worktree.branch = format!("分离 HEAD · {}", &head[..head.len().min(7)]);
        }
        if worktree.bare {
            worktree.branch = "裸仓库".into();
        }
        worktree.available &= !worktree.bare
            && worktree.prunable.is_none()
            && Path::new(&worktree.path).join(".git").exists();
        result.push(worktree);
    }
    let main_name = result
        .first()
        .and_then(|worktree| Path::new(&worktree.path).file_name())
        .map(|name| name.to_owned());
    for worktree in &mut result {
        let path = Path::new(&worktree.path);
        let name = path.file_name().unwrap_or(path.as_os_str());
        worktree.name = if worktree.is_main {
            "主工作区".into()
        } else if Some(name) == main_name.as_deref() {
            path.parent()
                .and_then(Path::file_name)
                .unwrap_or(name)
                .to_string_lossy()
                .into_owned()
        } else {
            name.to_string_lossy().into_owned()
        };
    }
    Ok(result)
}

pub(super) fn worktrees(repo: &Path) -> GitResult<Vec<GitWorktreeInfo>> {
    parse_worktrees(&git(repo, &["worktree", "list", "--porcelain", "-z"])?)
}

pub(super) fn branches(repo: &Path) -> GitResult<Vec<GitBranch>> {
    let worktrees = worktrees(repo)?;
    let current = worktrees
        .iter()
        .find(|worktree| Path::new(&worktree.path) == repo);
    let remote_output = git_line(repo, &["remote"])?;
    let mut remotes: Vec<&str> = remote_output.lines().collect();
    // remote 名称本身允许斜线；先匹配最长名称，避免把 team/origin 当成 team。
    remotes.sort_by_key(|remote| std::cmp::Reverse(remote.len()));
    let output = utf8(git(
        repo,
        &[
            "for-each-ref",
            "--sort=refname",
            "--sort=-committerdate",
            "--format=%(refname)%00%(symref)%00%(upstream)%00%(objectname:short=7)%00%(authorname)%00%(subject)%00%(committerdate:unix)%00",
            "refs/heads/",
            "refs/remotes/",
        ],
    )?)?;
    let mut result = Vec::new();
    for line in output.lines() {
        let mut fields = line.split('\0');
        let full_name = fields.next().ok_or("无法解析 Git 分支列表。")?;
        let symbolic = fields.next().ok_or("Git 分支记录不完整。")?;
        let upstream = fields.next().ok_or("Git 分支记录不完整。")?;
        if !symbolic.is_empty() {
            continue;
        }
        let last_commit = BranchCommit {
            short_hash: fields.next().ok_or("Git 分支缺少提交 hash。")?.into(),
            author: fields.next().ok_or("Git 分支缺少提交作者。")?.into(),
            subject: fields.next().ok_or("Git 分支缺少提交说明。")?.into(),
            committed_at: fields
                .next()
                .ok_or("Git 分支缺少提交时间。")?
                .parse()
                .map_err(|_| "无法解析 Git 分支提交时间。")?,
        };
        let (kind, name, local_name) = if let Some(name) = full_name.strip_prefix("refs/heads/") {
            ("local", name, None)
        } else if let Some(name) = full_name.strip_prefix("refs/remotes/") {
            let local_name = remotes
                .iter()
                .find_map(|remote| name.strip_prefix(&format!("{remote}/")))
                .map(str::to_owned);
            ("remote", name, local_name)
        } else {
            continue;
        };
        let occupied = worktrees
            .iter()
            .find(|worktree| !worktree.detached && !worktree.bare && worktree.branch == name);
        result.push(GitBranch {
            full_name: full_name.into(),
            name: name.into(),
            kind,
            current: kind == "local"
                && current.is_some_and(|worktree| !worktree.detached && worktree.branch == name),
            worktree_path: (kind == "local")
                .then(|| occupied.map(|worktree| worktree.path.clone()))
                .flatten(),
            upstream: (!upstream.is_empty()).then(|| upstream.into()),
            local_name,
            last_commit,
        });
    }
    // 远程分支若已对应本地跟踪分支，也给出其占用位置，避免展示成可新建分支。
    for index in 0..result.len() {
        if result[index].kind == "remote" {
            result[index].worktree_path = result
                .iter()
                .find(|branch| {
                    branch.kind == "local"
                        && Some(&branch.name) == result[index].local_name.as_ref()
                        && branch.upstream.as_deref() == Some(result[index].full_name.as_str())
                })
                .and_then(|branch| branch.worktree_path.clone());
        }
    }
    Ok(result)
}

/// post-checkout hook 在分支切换后运行；非零退出时核验 HEAD，避免把已完成的切换误报为失败。
fn switch_branch(
    repo: &Path,
    args: &[&str],
    name: &str,
    expected_upstream: Option<&str>,
) -> GitResult<Option<String>> {
    let before = git_line(repo, &["symbolic-ref", "--quiet", "HEAD"]).ok();
    match git(repo, args) {
        Ok(_) => Ok(None),
        Err(error) => {
            let target = format!("refs/heads/{name}");
            if before.as_deref() != Some(target.as_str())
                && git_line(repo, &["symbolic-ref", "--quiet", "HEAD"]).as_deref()
                    == Ok(target.as_str())
            {
                let mut warning = format!(
                    "分支已切换，但 Git 返回了错误（可能来自 post-checkout hook）：\n{error}"
                );
                if let Some(expected) = expected_upstream {
                    if git_line(repo, &["rev-parse", "--symbolic-full-name", "@{upstream}"])
                        .as_deref()
                        != Ok(expected)
                    {
                        warning.push_str(
                            "\n所选远程分支的跟踪关系未建立，请检查本地分支的 upstream 配置。",
                        );
                    }
                }
                Ok(Some(warning))
            } else {
                Err(error)
            }
        }
    }
}

/// 只接受刚枚举到的完整引用，不把界面输入拼成命令或 Git 的 revision 表达式。
pub(super) fn checkout(repo: &Path, full_name: &str) -> GitResult<CheckoutResult> {
    let branches = branches(repo)?;
    let selected = branches
        .iter()
        .find(|branch| branch.full_name == full_name)
        .ok_or("该分支已不存在，请刷新分支列表后重试。")?;
    if let Some(path) = &selected.worktree_path {
        if Path::new(path) != repo {
            return Err(format!(
                "该分支已被工作区“{path}”占用，请从左侧切换到该工作区。"
            ));
        }
    }
    let (branch, warning) = if selected.kind == "local" {
        let warning = switch_branch(
            repo,
            &["switch", "--no-guess", "--", &selected.name],
            &selected.name,
            None,
        )?;
        (selected.name.clone(), warning)
    } else {
        let local_name = selected
            .local_name
            .as_deref()
            .ok_or("该远程分支没有对应的 remote 配置，无法建立跟踪分支。")?;
        let warning = if let Some(existing) = branches
            .iter()
            .find(|branch| branch.kind == "local" && branch.name == local_name)
        {
            if existing.upstream.as_deref() != Some(full_name) {
                return Err(format!(
                    "本地分支“{local_name}”已存在且未跟踪所选远程分支，请直接选择本地分支或先调整跟踪关系。"
                ));
            }
            if let Some(path) = &existing.worktree_path {
                if Path::new(path) != repo {
                    return Err(format!("本地分支“{local_name}”已被工作区“{path}”占用。"));
                }
            }
            switch_branch(
                repo,
                &["switch", "--no-guess", "--", local_name],
                local_name,
                Some(full_name),
            )?
        } else {
            switch_branch(
                repo,
                &[
                    "switch",
                    "--no-guess",
                    "--track=direct",
                    "-c",
                    local_name,
                    "--",
                    full_name,
                ],
                local_name,
                Some(full_name),
            )?
        };
        (local_name.into(), warning)
    };
    // switch 已成功后不再读取状态，避免读取失败让用户误以为分支没有切换。
    Ok(CheckoutResult { branch, warning })
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
