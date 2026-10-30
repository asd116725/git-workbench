use super::*;
use std::{
    io::{Seek, SeekFrom},
    thread,
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

const REMOTE_TIMEOUT: Duration = Duration::from_secs(120);

/// 计数仅依据本地已获取的引用；未知目标或缺失的上游引用用 null，不能冒充已同步。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteStatus {
    pub remotes: Vec<String>,
    pub upstream: Option<String>,
    pub upstream_remote: Option<String>,
    pub upstream_branch: Option<String>,
    pub default_remote: Option<String>,
    pub ahead: Option<u64>,
    pub behind: Option<u64>,
}

/// 操作已产生结果但后续步骤失败时保留成功事实，由界面提示警告并刷新。
#[derive(Debug, Serialize)]
pub struct GitRemoteResult {
    pub warning: Option<String>,
}

fn config_values(repo: &Path, key: &str) -> GitResult<Vec<String>> {
    let output = run_git(repo, &["config", "--get-all", key])?;
    if output.status.code() == Some(1) {
        return Ok(Vec::new());
    }
    Ok(utf8(checked(output)?)?.lines().map(str::to_owned).collect())
}

fn current_branch(repo: &Path) -> GitResult<Option<String>> {
    let output = run_git(repo, &["symbolic-ref", "--quiet", "HEAD"])?;
    if output.status.code() == Some(1) {
        return Ok(None);
    }
    Ok(Some(
        utf8(checked(output)?)?
            .trim_end_matches('\n')
            .strip_prefix("refs/heads/")
            .ok_or("当前 HEAD 不是本地分支。")?
            .into(),
    ))
}

fn commit_exists(repo: &Path, reference: &str) -> GitResult<bool> {
    Ok(run_git(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{reference}^{{commit}}"),
        ],
    )?
    .status
    .success())
}

fn remote_names(repo: &Path) -> GitResult<Vec<String>> {
    Ok(git_line(repo, &["remote"])?
        .lines()
        .map(str::to_owned)
        .collect())
}

pub(super) fn remote_status(repo: &Path) -> GitResult<GitRemoteStatus> {
    let remotes = remote_names(repo)?;
    let branch = current_branch(repo)?;
    let (upstream_remote, upstream_branch) = if let Some(branch) = &branch {
        let remote = config_values(repo, &format!("branch.{branch}.remote"))?.pop();
        let merges = config_values(repo, &format!("branch.{branch}.merge"))?;
        let merge = if merges.len() == 1 {
            merges.into_iter().next()
        } else {
            None
        };
        (
            remote,
            merge.and_then(|name| name.strip_prefix("refs/heads/").map(str::to_owned)),
        )
    } else {
        (None, None)
    };
    let upstream =
        upstream_remote
            .as_ref()
            .zip(upstream_branch.as_ref())
            .map(|(remote, branch)| {
                if remote == "." {
                    branch.clone()
                } else {
                    format!("{remote}/{branch}")
                }
            });
    let default_remote = upstream_remote
        .as_ref()
        .filter(|remote| remotes.contains(remote))
        .cloned()
        .or_else(|| {
            remotes
                .iter()
                .find(|remote| remote.as_str() == "origin")
                .cloned()
        })
        .or_else(|| (remotes.len() == 1).then(|| remotes[0].clone()));
    let mut result = GitRemoteStatus {
        remotes,
        upstream,
        upstream_remote,
        upstream_branch,
        default_remote,
        ahead: None,
        behind: None,
    };
    let Some(branch) = branch else {
        return Ok(result);
    };
    if result.remotes.is_empty()
        || !has_head(repo)?
        || result.upstream_remote.as_deref() == Some(".")
    {
        return Ok(result);
    }
    let target = if result.upstream.is_some() {
        // Git 根据 fetch refspec 解析上游，兼容非标准远程引用路径及已删除的引用。
        git_line(
            repo,
            &[
                "for-each-ref",
                "--format=%(upstream)",
                &format!("refs/heads/{branch}"),
            ],
        )?
    } else if result.upstream_remote.is_some() {
        return Ok(result);
    } else if let Some(remote) = &result.default_remote {
        format!("refs/remotes/{remote}/{branch}")
    } else {
        return Ok(result);
    };
    if !target.is_empty() && commit_exists(repo, &target)? {
        let counts = git_line(
            repo,
            &[
                "rev-list",
                "--left-right",
                "--count",
                &format!("HEAD...{target}"),
                "--",
            ],
        )?;
        let mut counts = counts.split_whitespace().map(str::parse::<u64>);
        result.ahead = Some(
            counts
                .next()
                .ok_or("无法读取待推送提交数。")?
                .map_err(|_| "无法读取待推送提交数。")?,
        );
        result.behind = Some(
            counts
                .next()
                .ok_or("无法读取待拉取提交数。")?
                .map_err(|_| "无法读取待拉取提交数。")?,
        );
    }
    Ok(result)
}

/// 网络和认证最多等待两分钟；独立进程组与临时输出文件保证超时能释放仓库锁。
fn run_remote_command(mut command: Command, timeout: Duration) -> GitResult<Output> {
    let mut stdout = tempfile::tempfile().map_err(|error| format!("无法准备 Git 输出：{error}"))?;
    let mut stderr = tempfile::tempfile().map_err(|error| format!("无法准备 Git 输出：{error}"))?;
    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("GIT_ASKPASS", "")
        .env("SSH_ASKPASS", "")
        .env("SSH_ASKPASS_REQUIRE", "never")
        .stdout(stdout.try_clone().map_err(|error| error.to_string())?)
        .stderr(stderr.try_clone().map_err(|error| error.to_string())?);
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法运行 Git：{error}"))?;
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(25)),
            result => {
                #[cfg(unix)]
                let _ = Command::new("/bin/kill")
                    .args(["-KILL", "--", &format!("-{}", child.id())])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
                #[cfg(windows)]
                let _ = Command::new("taskkill")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
                let _ = child.kill();
                let _ = child.wait();
                return Err(result
                    .err()
                    .map(|error| format!("Git 进程异常：{error}"))
                    .unwrap_or_else(|| {
                        "远程操作超时，请检查网络或凭据后重试；远程状态可能已经更新，请先获取确认。"
                            .into()
                    }));
            }
        }
    };
    let read = |file: &mut fs::File| -> GitResult<Vec<u8>> {
        file.seek(SeekFrom::Start(0))
            .map_err(|error| error.to_string())?;
        let mut bytes = Vec::new();
        file.take(2 * 1024 * 1024)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        Ok(bytes)
    };
    Ok(Output {
        status,
        stdout: read(&mut stdout)?,
        stderr: read(&mut stderr)?,
    })
}

fn remote_command(repo: &Path, args: &[&str]) -> Command {
    let mut command = command(repo);
    command.args(args);
    command
}

fn ensure_branch_ready(repo: &Path) -> GitResult<String> {
    if operation(repo)?.is_some() {
        return Err("请先完成或中止当前 Git 操作，再拉取或推送。".into());
    }
    let branch = current_branch(repo)?.ok_or("当前处于分离 HEAD 状态，请先切换到本地分支。")?;
    if !has_head(repo)? {
        return Err("当前分支尚无提交，请先完成首次提交。".into());
    }
    Ok(branch)
}

fn fetch(repo: &Path) -> GitResult<GitRemoteResult> {
    let remotes = remote_names(repo)?;
    if remotes.is_empty() {
        return Err("尚未配置远程仓库，请先添加 remote。".into());
    }
    // 单独指定真实远程，绕过 skipFetchAll 与同名 remote group；整组共享超时预算。
    let deadline = Instant::now() + REMOTE_TIMEOUT;
    let mut errors = Vec::new();
    for remote in remotes {
        let command = remote_command(
            repo,
            &["fetch", "--prune", "--no-recurse-submodules", "--", &remote],
        );
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            errors.push(format!("获取已超时，尚未获取 {remote} 及后续远程。"));
            break;
        };
        if let Err(error) = run_remote_command(command, remaining).and_then(checked) {
            errors.push(format!("{remote}：{error}"));
        }
    }
    if !errors.is_empty() {
        return Err(format!("未能完成全部远程的获取：\n{}", errors.join("\n")));
    }
    Ok(GitRemoteResult { warning: None })
}

fn pull(repo: &Path) -> GitResult<GitRemoteResult> {
    let current_branch = ensure_branch_ready(repo)?;
    let state = remote_status(repo)?;
    let remote = state
        .upstream_remote
        .as_deref()
        .ok_or("当前分支尚未设置上游，请先推送并建立跟踪关系。")?;
    if !state.remotes.iter().any(|name| name == remote) {
        return Err("上游没有对应的远程仓库，请先设置有效的远程上游分支。".into());
    }
    let branch = state
        .upstream_branch
        .ok_or("当前分支没有唯一的远程上游分支，请先调整跟踪配置。")?;
    let before = git_line(repo, &["rev-parse", "HEAD"])?;
    let mut command = remote_command(
        repo,
        &[
            "-c",
            "merge.autoStash=false",
            "-c",
            "rebase.autoStash=false",
            // config-env 从末尾拆分等号，合法分支名包含 '=' 时仍能准确覆盖配置键。
            &format!(
                "--config-env=branch.{current_branch}.mergeOptions=GIT_WORKBENCH_EMPTY_CONFIG"
            ),
            "pull",
            "--ff-only",
            "--no-rebase",
            "--no-squash",
            "--no-autostash",
            "--no-recurse-submodules",
            "--",
            remote,
            &format!("refs/heads/{branch}"),
        ],
    );
    command.env("GIT_WORKBENCH_EMPTY_CONFIG", "");
    let output = run_remote_command(command, REMOTE_TIMEOUT)?;
    match checked(output) {
        Ok(_) => Ok(GitRemoteResult { warning: None }),
        Err(error) if git_line(repo, &["rev-parse", "HEAD"])? != before => Ok(GitRemoteResult {
            warning: Some(format!("分支已更新，但拉取的后续步骤失败：\n{error}")),
        }),
        Err(error) => Err(format!(
            "拉取失败：仅支持快进更新；分支分叉时请先获取，再通过「合并」整合上游分支。\n{error}"
        )),
    }
}

fn push(repo: &Path, selected_remote: Option<&str>) -> GitResult<GitRemoteResult> {
    let branch = ensure_branch_ready(repo)?;
    let state = remote_status(repo)?;
    let (remote, target, set_upstream) = if let Some(remote) = &state.upstream_remote {
        if selected_remote.is_some_and(|selected| selected != remote) {
            return Err("当前分支的上游已变化，请刷新后重新推送。".into());
        }
        (
            remote.as_str(),
            state
                .upstream_branch
                .as_deref()
                .ok_or("当前分支没有唯一的远程上游分支，请先调整跟踪配置。")?,
            false,
        )
    } else {
        (
            selected_remote
                .or(state.default_remote.as_deref())
                .ok_or("请选择用于首次推送的远程仓库。")?,
            branch.as_str(),
            true,
        )
    };
    if !state.remotes.iter().any(|name| name == remote) {
        return Err("推送目标没有对应的远程仓库，请先设置有效的远程上游分支。".into());
    }
    // 显式 refspec，不附带 tags 或递归子模块，避免用户配置扩大或转移推送范围。
    let refspec = format!("refs/heads/{branch}:refs/heads/{target}");
    let mut args = vec![
        "push",
        "--porcelain",
        "--no-follow-tags",
        "--no-recurse-submodules",
    ];
    if set_upstream {
        args.push("--set-upstream");
    }
    args.extend(["--", remote, &refspec]);
    let output = run_remote_command(remote_command(repo, &args), REMOTE_TIMEOUT)?;
    let accepted = String::from_utf8_lossy(&output.stdout).lines().any(|line| {
        line.split_once('\t').is_some_and(|(flag, refs)| {
            matches!(flag, " " | "*" | "=") && refs.split('\t').next() == Some(refspec.as_str())
        })
    });
    match checked(output) {
        Ok(_) => Ok(GitRemoteResult { warning: None }),
        Err(error) if accepted => Ok(GitRemoteResult {
            warning: Some(format!("提交已推送，但后续设置未完成：\n{error}")),
        }),
        Err(error) => Err(format!(
            "推送失败，请检查网络、凭据或远程分支状态。若远程有新提交，请先获取并拉取或合并。\n{error}"
        )),
    }
}

/// 获取全部已配置远程的新引用，不改动工作区和当前分支。
#[tauri::command]
pub async fn git_fetch(repo_path: String) -> GitResult<GitRemoteResult> {
    blocking(move || with_repository(&repo_path, fetch)).await
}

/// 只快进到当前上游，禁用配置中的自动变基与自动暂存。
#[tauri::command]
pub async fn git_pull(repo_path: String) -> GitResult<GitRemoteResult> {
    blocking(move || with_repository(&repo_path, pull)).await
}

/// 只推送当前分支；首次发布时建立上游跟踪，后续固定使用该目标。
#[tauri::command]
pub async fn git_push(repo_path: String, remote: Option<String>) -> GitResult<GitRemoteResult> {
    blocking(move || with_repository(&repo_path, |repo| push(repo, remote.as_deref()))).await
}

#[cfg(test)]
mod tests;
