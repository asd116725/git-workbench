use super::*;
use std::{
    io::{Seek, SeekFrom},
    thread,
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

const REMOTE_TIMEOUT: Duration = Duration::from_secs(120);
const BACKGROUND_FETCH_TIMEOUT: Duration = Duration::from_secs(15);

/// 计数仅依据本地已获取的引用；未知目标或缺失的上游引用用 null，不能冒充已同步。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteStatus {
    pub remotes: Vec<String>,
    pub upstream: Option<String>,
    pub upstream_ref: Option<String>,
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

fn upstream_config(repo: &Path, branch: &str) -> GitResult<(Option<String>, Option<String>)> {
    let remote = config_values(repo, &format!("branch.{branch}.remote"))?.pop();
    let merges = config_values(repo, &format!("branch.{branch}.merge"))?;
    let target = match merges.as_slice() {
        [target] => target.strip_prefix("refs/heads/").map(str::to_owned),
        _ => None,
    };
    Ok((remote, target))
}

pub(super) fn remote_status(repo: &Path) -> GitResult<GitRemoteStatus> {
    let remotes = remote_names(repo)?;
    let branch = current_branch(repo)?;
    let (upstream_remote, upstream_branch) = if let Some(branch) = &branch {
        upstream_config(repo, branch)?
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
        upstream_ref: None,
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
    let has_upstream = result.upstream.is_some();
    let target = if has_upstream {
        upstream_ref(repo, &format!("refs/heads/{branch}"))?
    } else if result.upstream_remote.is_some() {
        return Ok(result);
    } else if let Some(remote) = &result.default_remote {
        format!("refs/remotes/{remote}/{branch}")
    } else {
        return Ok(result);
    };
    if !target.is_empty() && commit_exists(repo, &target)? {
        let (ahead, behind) = commit_distance(repo, "HEAD", &target)?;
        result.ahead = Some(ahead);
        result.behind = Some(behind);
        result.upstream_ref =
            (has_upstream && target.starts_with("refs/remotes/")).then_some(target);
    }
    Ok(result)
}

/// 由 Git 按 fetch refspec 解析上游，兼容自定义跟踪引用路径。
fn upstream_ref(repo: &Path, branch_ref: &str) -> GitResult<String> {
    git_line(repo, &["for-each-ref", "--format=%(upstream)", branch_ref])
}

fn commit_distance(repo: &Path, local: &str, upstream: &str) -> GitResult<(u64, u64)> {
    let counts = git_line(
        repo,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("{local}...{upstream}"),
            "--",
        ],
    )?;
    let mut counts = counts.split_whitespace();
    let ahead = counts
        .next()
        .and_then(|value| value.parse().ok())
        .ok_or("无法读取待推送提交数。")?;
    let behind = counts
        .next()
        .and_then(|value| value.parse().ok())
        .ok_or("无法读取待拉取提交数。")?;
    Ok((ahead, behind))
}

/// 独立进程组与临时输出文件保证超时能释放仓库锁。
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

/// Git refspec 的通配段可为空，精确规则仅匹配完整引用。
fn matches_refspec(pattern: &str, reference: &str) -> bool {
    if let Some((prefix, suffix)) = pattern.split_once('*') {
        reference
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.ends_with(suffix))
    } else {
        pattern == reference
    }
}

fn is_fetch_excluded(configured: &[String], reference: &str) -> bool {
    configured.iter().any(|spec| {
        spec.strip_prefix('^')
            .is_some_and(|pattern| matches_refspec(pattern, reference))
    })
}

fn is_symbolic_ref(repo: &Path, reference: &str) -> GitResult<bool> {
    Ok(run_git(repo, &["symbolic-ref", "--quiet", reference])?
        .status
        .success())
}

/// 后台只使用目的地为远程跟踪引用的映射，并保留原负规则，防止触及本地分支或标签。
fn background_refspecs<'a>(
    repo: &Path,
    configured: &'a [String],
    symbolic_refs: &str,
) -> GitResult<(Vec<&'a str>, bool)> {
    let mut included = Vec::new();
    let mut skipped = false;
    for spec in configured {
        if spec.starts_with('^') {
            included.push(spec.as_str());
            continue;
        }
        let Some((_, target)) = spec.split_once(':') else {
            continue;
        };
        let safe = target.starts_with("refs/remotes/")
            && if target.contains('*') {
                !symbolic_refs.lines().any(|line| {
                    line.split_once('\t').is_some_and(|(name, referent)| {
                        !referent.is_empty()
                            && !referent.starts_with("refs/remotes/")
                            && matches_refspec(target, name)
                    })
                })
            } else {
                !is_symbolic_ref(repo, target)?
            };
        if safe {
            included.push(spec.as_str());
        } else {
            skipped = true;
        }
    }
    Ok((included, skipped))
}

fn fetch(repo: &Path, background: bool) -> GitResult<GitRemoteResult> {
    let remotes = remote_names(repo)?;
    if remotes.is_empty() {
        return Err("尚未配置远程仓库，请先添加 remote。".into());
    }
    // 单独指定真实远程，绕过 skipFetchAll 与同名 remote group；整组共享超时预算。
    let timeout = if background {
        BACKGROUND_FETCH_TIMEOUT
    } else {
        REMOTE_TIMEOUT
    };
    let deadline = Instant::now() + timeout;
    let active_upstream = if background {
        current_branch(repo)?
            .map(|branch| upstream_config(repo, &branch))
            .transpose()?
            .and_then(|(remote, target)| remote.zip(target))
            .map(|(remote, target)| (remote, format!("refs/heads/{target}")))
    } else {
        None
    };
    let symbolic_refs = if background {
        git_line(
            repo,
            &[
                "for-each-ref",
                "--format=%(refname)%09%(symref)",
                "refs/remotes",
            ],
        )?
    } else {
        String::new()
    };
    let mut errors = Vec::new();
    for remote in remotes {
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            errors.push(format!("获取已超时，尚未获取 {remote} 及后续远程。"));
            break;
        };
        let mut args = vec!["fetch", "--prune", "--no-recurse-submodules"];
        let configured;
        let mut refspecs = Vec::new();
        if background {
            configured = config_values(repo, &format!("remote.{remote}.fetch"))?;
            let (safe_specs, skipped) = background_refspecs(repo, &configured, &symbolic_refs)?;
            let has_positive = safe_specs.iter().any(|spec| !spec.starts_with('^'));
            let omitted_upstream = active_upstream.as_ref().is_some_and(|(name, target)| {
                name == &remote
                    && (is_fetch_excluded(&configured, target)
                        || !safe_specs.iter().any(|spec| {
                            spec.split_once(':').is_some_and(|(source, _)| {
                                matches_refspec(source.trim_start_matches('+'), target)
                            })
                        }))
            });
            if skipped || !has_positive || omitted_upstream {
                errors.push(format!(
                    "{remote}：部分远程引用无法安全地在后台获取，请手动获取。"
                ));
            }
            if !has_positive {
                continue;
            }
            refspecs = safe_specs;
            args.extend([
                "--refmap=",
                "--no-tags",
                "--no-prune-tags",
                "--no-write-fetch-head",
                "--no-auto-gc",
            ]);
        }
        args.extend(["--", &remote]);
        args.extend(refspecs);
        let command = remote_command(repo, &args);
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

/// 切换后重新联系远端，避免缓存计数为零时漏掉更新；仅对远程上游执行快进拉取。
pub(super) fn pull_after_checkout(
    repo: &Path,
    expected_branch: &str,
) -> GitResult<GitRemoteResult> {
    if current_branch(repo)?.as_deref() != Some(expected_branch) {
        return Err("当前分支在切换后发生变化，请检查后手动拉取。".into());
    }
    let state = remote_status(repo)?;
    if state.upstream_remote.is_none() || state.upstream_remote.as_deref() == Some(".") {
        return Ok(GitRemoteResult { warning: None });
    }
    pull(repo)
}

/// Git 写上游配置失败时仍可能返回成功，必须核对原分支的实际跟踪目标。
fn verify_published_upstream(
    repo: &Path,
    branch: &str,
    remote: &str,
    target: &str,
) -> GitResult<()> {
    let configured_remote = config_values(repo, &format!("branch.{branch}.remote"))?.pop();
    let configured_branches = config_values(repo, &format!("branch.{branch}.merge"))?;
    if configured_remote.as_deref() != Some(remote)
        || configured_branches != [format!("refs/heads/{target}")]
    {
        return Err("上游跟踪未建立，请检查 Git 配置后重试。".into());
    }
    Ok(())
}

fn run_before_deadline(command: Command, deadline: Instant) -> GitResult<Output> {
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .ok_or("远程操作超时，请检查网络或凭据后重试。")?;
    run_remote_command(command, remaining)
}

/// 仅获取本次推送的目标分支；取不到时区分目标删除与网络、凭据或引用更新失败。
fn fetch_push_target(
    repo: &Path,
    source: &str,
    target_ref: &str,
    check_ref: &str,
    alias: Option<&str>,
    deadline: Instant,
) -> GitResult<bool> {
    let refspec = format!("+{target_ref}:{check_ref}");
    let run = |args: &[&str]| {
        let mut command = command(repo);
        // 使用一次性别名读取 Git 已解析的推送 URL，避免它被 insteadOf 再次改写。
        if let Some(alias) = alias {
            command
                .arg(format!(
                    "--config-env=url.{source}.insteadOf=GIT_WORKBENCH_PUSH_SOURCE"
                ))
                .env("GIT_WORKBENCH_PUSH_SOURCE", alias);
        }
        command.args(args);
        run_before_deadline(command, deadline)
    };
    let source = alias.unwrap_or(source);
    let args = [
        "fetch",
        "--no-tags",
        "--no-prune",
        "--no-prune-tags",
        "--no-write-fetch-head",
        "--no-recurse-submodules",
        "--refmap=",
        "--",
        source,
        &refspec,
    ];
    let output = run(&args)?;
    match checked(output) {
        Ok(_) => Ok(true),
        Err(error) => {
            let target_missing =
                run(&["ls-remote", "--refs", "--", source, target_ref]).is_ok_and(|output| {
                    output.status.success()
                        && !String::from_utf8_lossy(&output.stdout).lines().any(|line| {
                            line.split_once('\t')
                                .is_some_and(|(_, name)| name == target_ref)
                        })
                });
            if target_missing {
                Ok(false)
            } else {
                Err(error)
            }
        }
    }
}

/// 缺失引用用空字符串作为 update-ref 的预期旧值，防止覆盖网络获取期间的新引用。
fn ref_oid(repo: &Path, reference: &str) -> GitResult<String> {
    let output = run_git(repo, &["rev-parse", "--verify", "--quiet", reference])?;
    if output.status.code() == Some(1) {
        return Ok(String::new());
    }
    Ok(utf8(checked(output)?)?.trim_end_matches('\n').to_owned())
}

/// 在改动任何远端前核对全部推送地址；只有获取地址对应的引用可用作普通上游。
fn check_push_targets(
    repo: &Path,
    remote: &str,
    branch_ref: &str,
    target_ref: &str,
    deadline: Instant,
) -> GitResult<()> {
    let fetch_url = git_line(repo, &["remote", "get-url", "--", remote])?;
    let push_urls = git_line(
        repo,
        &["remote", "get-url", "--push", "--all", "--", remote],
    )?;
    let temporary = tempfile::Builder::new()
        .prefix("push-")
        .tempdir()
        .map_err(|error| format!("无法准备推送检查：{error}"))?;
    let id = temporary
        .path()
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("无法准备推送检查。")?;
    // 独立的检查引用保存实际目标，即使没有 fetch 映射，也无需读取可能被外部 Git 改写的 FETCH_HEAD。
    let check_ref = format!("refs/git-workbench/{id}");
    let alias = format!("git-workbench-{id}");
    let result = (|| {
        for (index, url) in push_urls.lines().enumerate() {
            let shares_fetch_url = url == fetch_url;
            let source = if shares_fetch_url { remote } else { url };
            let tracking = if shares_fetch_url {
                let tracking = upstream_ref(repo, branch_ref)?;
                let configured = config_values(repo, &format!("remote.{remote}.fetch"))?;
                if tracking.starts_with("refs/remotes/")
                    && !is_fetch_excluded(&configured, target_ref)
                    && !is_symbolic_ref(repo, &tracking)?
                {
                    Some((ref_oid(repo, &tracking)?, tracking))
                } else {
                    None
                }
            } else {
                None
            };
            if !fetch_push_target(
                repo,
                source,
                target_ref,
                &check_ref,
                (!shares_fetch_url).then_some(alias.as_str()),
                deadline,
            )
            .map_err(|error| format!("推送前获取目标分支失败，未执行推送。\n{error}"))?
            {
                continue;
            }
            let fetched = git_line(repo, &["rev-parse", "--verify", &check_ref])?;
            let updated_tracking = if let Some((previous, tracking)) = tracking {
                git(
                    repo,
                    &["update-ref", "--no-deref", &tracking, &fetched, &previous],
                )
                .is_ok()
                    || (!is_symbolic_ref(repo, &tracking)? && ref_oid(repo, &tracking)? == fetched)
            } else {
                false
            };
            let (ahead, behind) = commit_distance(repo, branch_ref, &fetched)?;
            if behind == 0 {
                continue;
            }
            if !shares_fetch_url {
                return Err(format!(
                    "推送地址 {} 的目标分支与本地不同步：本地领先 {ahead} 个提交、落后 {behind} 个提交。请先获取并整合该目标分支，再推送。",
                    index + 1
                ));
            }
            if !updated_tracking {
                return Err(format!(
                    "本地领先 {ahead} 个提交、落后 {behind} 个提交。请先检查上游跟踪配置，再获取并整合目标分支。"
                ));
            }
            return Err(if ahead == 0 {
                format!("当前分支落后上游 {behind} 个提交，请先拉取再推送。")
            } else {
                format!(
                    "当前分支与上游已分叉：领先 {ahead} 个提交、落后 {behind} 个提交。请先通过「合并」整合上游分支，再推送。"
                )
            });
        }
        Ok(())
    })();
    let cleanup = git(repo, &["update-ref", "-d", &check_ref]);
    result.and(cleanup.map(|_| ()))
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
    let branch_ref = format!("refs/heads/{branch}");
    let target_ref = format!("refs/heads/{target}");
    let deadline = Instant::now() + REMOTE_TIMEOUT;
    if !set_upstream {
        check_push_targets(repo, remote, &branch_ref, &target_ref, deadline)?;
    }
    // 显式 refspec，不附带 tags 或递归子模块；实际推送仍由 Git 防止远端在预检后发生非快进更新。
    let refspec = format!("{branch_ref}:{target_ref}");
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
    let output = run_before_deadline(remote_command(repo, &args), deadline)?;
    let accepted = String::from_utf8_lossy(&output.stdout).lines().any(|line| {
        line.split_once('\t').is_some_and(|(flag, refs)| {
            matches!(flag, " " | "*" | "=") && refs.split('\t').next() == Some(refspec.as_str())
        })
    });
    match checked(output) {
        Ok(_) => Ok(GitRemoteResult {
            warning: if set_upstream {
                verify_published_upstream(repo, &branch, remote, target)
                    .err()
                    .map(|error| format!("提交已推送，但后续设置未完成：\n{error}"))
            } else {
                None
            },
        }),
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
pub async fn git_fetch(repo_path: String, background: Option<bool>) -> GitResult<GitRemoteResult> {
    blocking(move || {
        with_repository(&repo_path, |repo| {
            fetch(repo, background.unwrap_or_default())
        })
    })
    .await
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
