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
    /// null 表示尚无法读取；对象中的空上游表示已确认此分支未配置跟踪关系。
    pub branch_sync: Option<GitBranchSync>,
}

/// 计数只比较当前分支与本地已获取的上游引用，不触发网络访问。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchSync {
    pub upstream: Option<String>,
    pub ahead: Option<u64>,
    pub behind: Option<u64>,
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
    /// 相对本分支上游的本地引用计数；无上游、上游不可用或远程分支均为 null。
    pub ahead: Option<u64>,
    pub behind: Option<u64>,
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
            branch_sync: None,
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

fn worktree_metadata(repo: &Path) -> GitResult<Vec<GitWorktreeInfo>> {
    parse_worktrees(&git(repo, &["worktree", "list", "--porcelain", "-z"])?)
}

pub(super) fn worktrees(repo: &Path) -> GitResult<Vec<GitWorktreeInfo>> {
    let mut worktrees = worktree_metadata(repo)?;
    // worktree 配置和条件 include 可改变上游；此时须在各目录中让 Git 求值。
    let contextual = git_line(
        repo,
        &[
            "config",
            "--get-regexp",
            r"^(extensions\.worktreeconfig|includeif\..*\.path)$",
        ],
    )
    .is_ok();
    let shared_sync = (!contextual)
        .then(|| worktree_branch_sync(repo, "refs/heads/").ok())
        .flatten();
    // 同步状态属于附加信息，读取失败不应阻止展示或切换工作区。
    for worktree in &mut worktrees {
        if worktree.available && !worktree.detached && !worktree.bare {
            worktree.branch_sync = if contextual {
                worktree_branch_sync(
                    Path::new(&worktree.path),
                    &format!("refs/heads/{}", worktree.branch),
                )
                .ok()
                .and_then(|mut sync| sync.remove(&worktree.branch))
            } else {
                shared_sync
                    .as_ref()
                    .and_then(|sync| sync.get(&worktree.branch))
                    .cloned()
            };
        }
    }
    Ok(worktrees)
}

/// 仅批量读取所选本地分支的跟踪信息，不加载工作区文件状态。
fn worktree_branch_sync(repo: &Path, reference: &str) -> GitResult<HashMap<String, GitBranchSync>> {
    let output = command(repo)
        .env("LC_ALL", "C")
        .args([
            "for-each-ref",
            "--format=%(refname)%00%(upstream)%00%(upstream:track,nobracket)%00%(upstream:trackshort)%00",
            reference,
        ])
        .output()
        .map_err(|error| format!("无法运行 Git，请确认已安装 Git：{error}"))?;
    let output = utf8(checked(output)?)?;
    let mut result = HashMap::new();
    for line in output.lines() {
        let mut fields = line.split('\0');
        let name = fields
            .next()
            .and_then(|name| name.strip_prefix("refs/heads/"))
            .ok_or("无法解析 Git 分支列表。")?;
        let upstream = fields.next().ok_or("Git 分支记录不完整。")?;
        let tracking = fields.next().ok_or("Git 分支记录不完整。")?;
        let short = fields.next().ok_or("Git 分支记录不完整。")?;
        let counts = (!upstream.is_empty())
            .then(|| tracking_counts(tracking, short))
            .flatten();
        result.insert(
            name.into(),
            GitBranchSync {
                upstream: (!upstream.is_empty()).then(|| upstream.into()),
                ahead: counts.map(|counts| counts.0),
                behind: counts.map(|counts| counts.1),
            },
        );
    }
    Ok(result)
}

/// 只有 Git 明确给出同步状态时才返回零，未知跟踪状态不能伪装成已同步。
fn tracking_counts(tracking: &str, short: &str) -> Option<(u64, u64)> {
    match short {
        "=" if tracking.is_empty() => Some((0, 0)),
        ">" => Some((tracking.strip_prefix("ahead ")?.parse().ok()?, 0)),
        "<" => Some((0, tracking.strip_prefix("behind ")?.parse().ok()?)),
        "<>" => {
            let (ahead, behind) = tracking.strip_prefix("ahead ")?.split_once(", behind ")?;
            Some((ahead.parse().ok()?, behind.parse().ok()?))
        }
        _ => None,
    }
}

pub(super) fn branches(repo: &Path) -> GitResult<Vec<GitBranch>> {
    let worktrees = worktree_metadata(repo)?;
    let current = worktrees
        .iter()
        .find(|worktree| Path::new(&worktree.path) == repo);
    let remote_output = git_line(repo, &["remote"])?;
    let mut remotes: Vec<&str> = remote_output.lines().collect();
    // remote 名称本身允许斜线；先匹配最长名称，避免把 team/origin 当成 team。
    remotes.sort_by_key(|remote| std::cmp::Reverse(remote.len()));
    // 一次枚举计算所有分支；仅固定此命令的语言，确保 tracking 机器字段可解析。
    let output = command(repo)
        .env("LC_ALL", "C")
        .args([
            "for-each-ref",
            "--sort=refname",
            "--sort=-committerdate",
            "--format=%(refname)%00%(symref)%00%(upstream)%00%(objectname:short=7)%00%(authorname)%00%(subject)%00%(committerdate:unix)%00%(upstream:track,nobracket)%00%(upstream:trackshort)%00",
            "refs/heads/",
            "refs/remotes/",
        ])
        .output()
        .map_err(|error| format!("无法运行 Git，请确认已安装 Git：{error}"))?;
    let output = utf8(checked(output)?)?;
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
        let tracking = fields.next().ok_or("Git 分支记录不完整。")?;
        let tracking_short = fields.next().ok_or("Git 分支记录不完整。")?;
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
        let counts = (kind == "local" && !upstream.is_empty())
            .then(|| tracking_counts(tracking, tracking_short))
            .flatten();
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
            ahead: counts.map(|counts| counts.0),
            behind: counts.map(|counts| counts.1),
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
#[path = "navigation_tests.rs"]
mod tests;
