use super::*;
use std::io::{BufRead, BufReader};

const MANUAL_FETCH: &str = "部分远程引用无法安全地在后台获取，请手动获取。";
/// 每个候选都需要单独询问 Git；后台只为少量新引用在公共目录锁内做这项检查。
const MAX_SYMBOLIC_CHECKS: usize = 8;

/// 配置或传统脚本可能为真实引用更新设置审批。后台跳过这类仓库，显式获取会正常执行 hook。
fn has_reference_hook(repo: &Path) -> GitResult<bool> {
    let output = run_git(repo, &["hook", "list", "-z", "reference-transaction"])?;
    match output.status.code() {
        Some(0) => Ok(!output.stdout.is_empty()),
        Some(1) => Ok(false),
        Some(129) => {
            // 旧 Git 没有 hook list，改用 Git 解析的 core.hooksPath。
            let path = git_line(
                repo,
                &["rev-parse", "--path-format=absolute", "--git-path", "hooks"],
            )?;
            match fs::metadata(Path::new(&path).join("reference-transaction")) {
                #[cfg(unix)]
                Ok(file) => {
                    use std::os::unix::fs::PermissionsExt;
                    Ok(file.is_file() && file.permissions().mode() & 0o111 != 0)
                }
                #[cfg(not(unix))]
                Ok(file) => Ok(file.is_file()),
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                    ) =>
                {
                    Ok(false)
                }
                Err(error) => Err(error.to_string()),
            }
        }
        _ => checked(output).map(|_| false),
    }
}

/// 同名远程可能在网络传输期间被重新配置；地址使用 Git 展开 insteadOf 后的结果。
#[derive(PartialEq)]
struct RemoteConfig {
    url: String,
    options: Vec<(String, String)>,
}

impl RemoteConfig {
    fn read(repo: &Path, remote: &str) -> GitResult<Self> {
        let url = git_line(repo, &["remote", "get-url", "--", remote])?;
        let prefix = format!("remote.{remote}.");
        let config = utf8(git(
            repo,
            &["config", "--null", "--get-regexp", "^remote\\."],
        )?)?;
        let options = config
            .split_terminator('\0')
            .filter_map(|entry| {
                let (key, value) = entry.split_once('\n').unwrap_or((entry, ""));
                let option = key.strip_prefix(&prefix)?;
                (!option.contains('.')).then(|| (option.to_owned(), value.to_owned()))
            })
            .collect();
        Ok(Self { url, options })
    }
}

#[derive(PartialEq)]
struct Reference {
    oid: String,
    symbolic: String,
}

type References = HashMap<String, Reference>;

fn references(repo: &Path, prefix: &str) -> GitResult<References> {
    let records = git_line(
        repo,
        &[
            "for-each-ref",
            "--format=%(refname)%09%(objectname)%09%(symref)",
            prefix,
        ],
    )?;
    records
        .lines()
        .map(|line| {
            let mut parts = line.split('\t');
            let mut next = || {
                parts
                    .next()
                    .ok_or_else(|| "Git 分支记录不完整。".to_owned())
            };
            Ok((
                next()?.into(),
                Reference {
                    oid: next()?.into(),
                    symbolic: next()?.into(),
                },
            ))
        })
        .collect()
}

struct FetchPlan {
    config: RemoteConfig,
    before: References,
    refspecs: Vec<String>,
    skipped: bool,
}

impl FetchPlan {
    fn read(repo: &Path, remote: &str, prefix: &str) -> GitResult<Self> {
        let config = RemoteConfig::read(repo, remote)?;
        // 特殊传输帮助程序和部分克隆可能自行维护引用、配置或对象过滤器。
        let promisor = config.options.iter().any(|(key, _)| key == "promisor")
            && git_line(
                repo,
                &[
                    "config",
                    "--bool",
                    "--get",
                    &format!("remote.{remote}.promisor"),
                ],
            )? == "true";
        if config
            .options
            .iter()
            .any(|(key, _)| matches!(key.as_str(), "vcs" | "partialclonefilter"))
            || promisor
            || has_reference_hook(repo)?
        {
            return Err(MANUAL_FETCH.into());
        }
        let mut before = references(repo, "refs/remotes/")?;
        let configured: Vec<_> = config
            .options
            .iter()
            .filter(|(key, _)| key == "fetch")
            .map(|(_, spec)| spec.clone())
            .collect();
        let mut refspecs = Vec::new();
        let mut targets = Vec::new();
        let mut sources = Vec::new();
        let mut skipped = false;
        for spec in &configured {
            if spec.starts_with('^') {
                refspecs.push(spec.clone());
                continue;
            }
            let Some((source, target)) = spec.split_once(':') else {
                skipped = true;
                continue;
            };
            let source_ref = source.strip_prefix('+').unwrap_or(source);
            if !target.starts_with("refs/remotes/")
                || before.iter().any(|(name, reference)| {
                    !reference.symbolic.is_empty()
                        && matches_refspec(target, name)
                        && (!target.contains('*')
                            || !reference.symbolic.starts_with("refs/remotes/"))
                })
            {
                skipped = true;
                continue;
            }
            targets.push(target);
            sources.push(source_ref);
            refspecs.push(format!("{source}:{prefix}/{target}"));
        }
        if targets.is_empty() {
            return Err(MANUAL_FETCH.into());
        }
        if let Some(branch) = current_branch(repo)?
            && let (Some(upstream), Some(target)) = upstream_config(repo, &branch)?
            && upstream == remote
        {
            let target = format!("refs/heads/{target}");
            skipped |= is_fetch_excluded(&configured, &target)
                || !sources.iter().any(|source| {
                    matches_refspec(source, &target)
                        || target
                            .strip_prefix("refs/heads/")
                            .is_some_and(|short| matches_refspec(source, short))
                });
        }
        before.retain(|name, _| targets.iter().any(|target| matches_refspec(target, name)));
        Ok(Self {
            config,
            before,
            refspecs,
            skipped,
        })
    }

    /// 临时引用以旧值为起点，负规则、prune、重叠映射和非快进检查由 Git 原生处理。
    fn download(&self, repo: &Path, stage: &Stage, deadline: Instant) -> GitResult<()> {
        let mut seeds = String::new();
        for (name, reference) in &self.before {
            if reference.symbolic.is_empty() {
                seeds.push_str(&format!(
                    "create {}/{name} {}\n",
                    stage.prefix, reference.oid
                ));
            }
        }
        if !seeds.is_empty() {
            command_with_input(
                stage.private_command(repo),
                &["update-ref", "--no-deref", "--stdin"],
                seeds.as_bytes(),
            )?;
        }

        let alias = stage.name();
        let source = format!("git-workbench-source-{alias}");
        let mut cmd = stage.private_command(repo);
        // 绑定规划时的 URL 与传输参数，防止原远程在网络阶段临时指向其他仓库。
        // URL 及代理可能携带凭据，配置值和含 URL 的配置键均不放入进程参数。
        let inherited = std::env::var("GIT_CONFIG_COUNT")
            .ok()
            .map(|value| value.parse::<usize>())
            .transpose()
            .map_err(|error| error.to_string())?
            .unwrap_or_default();
        cmd.env(
            "GIT_CONFIG_COUNT",
            inherited.checked_add(1).ok_or(MANUAL_FETCH)?.to_string(),
        )
        .env(
            format!("GIT_CONFIG_KEY_{inherited}"),
            format!("url.{}.insteadOf", self.config.url),
        )
        .env(format!("GIT_CONFIG_VALUE_{inherited}"), &source)
        .args([
            "-c",
            &format!("remote.{alias}.url={source}"),
            "-c",
            &format!("remote.{alias}.followRemoteHEAD=never"),
        ]);
        for (index, (key, value)) in self.config.options.iter().enumerate() {
            if matches!(
                key.as_str(),
                "uploadpack" | "serveroption" | "proxy" | "proxyauthmethod"
            ) {
                let variable = format!("GIT_WORKBENCH_FETCH_OPTION_{index}");
                cmd.arg(format!("--config-env=remote.{alias}.{key}={variable}"))
                    .env(variable, value);
            }
        }
        cmd.args([
            "-c",
            "transfer.bundleURI=false",
            "-c",
            "fetch.bundleURI=",
            "fetch",
            // 精确规则缺失时 Git 会报错；对短源执行 prune 反而会先删掉 Git 稍后要更新的引用。
            if self
                .refspecs
                .iter()
                .any(|spec| !spec.starts_with('^') && spec.contains('*'))
            {
                "--prune"
            } else {
                "--no-prune"
            },
            "--no-tags",
            "--no-prune-tags",
            "--no-write-fetch-head",
            "--no-recurse-submodules",
            "--no-auto-gc",
            "--no-write-commit-graph",
            "--refmap=",
            "--",
            alias,
        ])
        .args(&self.refspecs);
        checked(run_before_deadline(cmd, deadline)?)?;
        Ok(())
    }
}

/// 未登记的临时 Git 目录共享原对象库。refs/worktree 只存放在这个目录，进程异常退出也不会向原仓的 --all 或镜像推送暴露引用。
struct Stage {
    directory: tempfile::TempDir,
    prefix: String,
    #[cfg(unix)]
    original: fs::File,
    #[cfg(not(unix))]
    original: fs::Metadata,
}

impl Stage {
    fn new(repo: &Path, common: &Path) -> GitResult<Self> {
        #[cfg(unix)]
        let original = fs::File::open(common);
        #[cfg(not(unix))]
        let original = fs::metadata(common);
        let original = original.map_err(|error| error.to_string())?;
        let directory = tempfile::Builder::new()
            .prefix("git-workbench-fetch-")
            .tempdir()
            .map_err(|error| error.to_string())?;
        let path = directory.path();
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(MANUAL_FETCH)?;
        let prefix = format!("refs/worktree/{name}");
        let git_dir = PathBuf::from(git_line(repo, &["rev-parse", "--absolute-git-dir"])?);
        fs::write(path.join("commondir"), format!("{}\n", common.display()))
            .map_err(|error| error.to_string())?;
        fs::copy(git_dir.join("HEAD"), path.join("HEAD")).map_err(|error| error.to_string())?;
        if common.join("reftable").is_dir() {
            fs::create_dir(path.join("reftable")).map_err(|error| error.to_string())?;
        }
        let worktree_config = git_dir.join("config.worktree");
        if worktree_config.is_file() {
            git(
                repo,
                &[
                    "config",
                    "--file",
                    path.join("config.worktree").to_str().ok_or(MANUAL_FETCH)?,
                    "include.path",
                    worktree_config.to_str().ok_or(MANUAL_FETCH)?,
                ],
            )?;
        }
        let stage = Self {
            directory,
            prefix,
            original,
        };
        // gitdir/onbranch 等条件配置的展开可能随临时目录改变；只在实际设置相同的情况下传输。
        let mut staged = command(repo);
        staged
            .env("GIT_DIR", stage.directory.path())
            .env("GIT_WORK_TREE", repo);
        if effective_config(command(repo))? != effective_config(staged)? {
            return Err(MANUAL_FETCH.into());
        }
        Ok(stage)
    }

    fn name(&self) -> &str {
        self.prefix.rsplit('/').next().unwrap()
    }

    fn same_repository(&self, common: &Path) -> GitResult<bool> {
        let current = fs::metadata(common).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let original = self
                .original
                .metadata()
                .map_err(|error| error.to_string())?;
            Ok(original.dev() == current.dev() && original.ino() == current.ino())
        }
        #[cfg(not(unix))]
        {
            Ok(self.original.created().map_err(|error| error.to_string())?
                == current.created().map_err(|error| error.to_string())?)
        }
    }

    fn private_command(&self, repo: &Path) -> Command {
        let mut cmd = self.limited_command(repo);
        cmd.env("GIT_DIR", self.directory.path())
            .env("GIT_WORK_TREE", repo);
        cmd
    }

    fn limited_command(&self, repo: &Path) -> Command {
        let mut cmd = command(repo);
        cmd.arg("--no-optional-locks")
            .args([
                "-c",
                "core.filesRefLockTimeout=100",
                "-c",
                "core.packedRefsTimeout=100",
                "-c",
                "reftable.lockTimeout=100",
            ])
            .arg("-c")
            .arg(format!(
                "core.hooksPath={}",
                self.directory.path().display()
            ));
        cmd
    }
}

/// 比较展开后的选项及其顺序；include 指令本身不影响传输，工作树设置可安全地引用原文件。
fn effective_config(mut cmd: Command) -> GitResult<Vec<Vec<u8>>> {
    let output = cmd
        .args(["config", "--null", "--list", "--includes"])
        .output()
        .map_err(|error| error.to_string())?;
    Ok(checked(output)?
        .split(|&byte| byte == 0)
        .filter(|record| !record.starts_with(b"include.") && !record.starts_with(b"includeif."))
        .map(<[u8]>::to_vec)
        .collect())
}

/// prepare 持有 Git 自己的引用锁，再确认符号引用类型；仅比较 OID 会误认指向同一提交的新别名。
fn publish(common: &Path, stage: &Stage, before: &References, after: &References) -> GitResult<()> {
    let reftable = common.join("reftable").is_dir();
    if reftable
        && after
            .keys()
            .filter(|name| !before.contains_key(*name))
            .take(MAX_SYMBOLIC_CHECKS + 1)
            .count()
            > MAX_SYMBOLIC_CHECKS
    {
        return Err(MANUAL_FETCH.into());
    }
    let mut records = String::from("start\n");
    let mut changed = Vec::new();
    for name in before
        .keys()
        .chain(after.keys().filter(|name| !before.contains_key(*name)))
    {
        let old = before.get(name);
        let new = after.get(name);
        if old == new
            || old.is_some_and(|reference| !reference.symbolic.is_empty()) && new.is_none()
        {
            continue;
        }
        if old
            .into_iter()
            .chain(new)
            .any(|reference| !reference.symbolic.is_empty())
        {
            return Err(MANUAL_FETCH.into());
        }
        let record = match (old, new) {
            (Some(old), Some(new)) => format!("update {name} {} {}\n", new.oid, old.oid),
            (None, Some(new)) => format!("create {name} {}\n", new.oid),
            (Some(old), None) => format!("delete {name} {}\n", old.oid),
            _ => unreachable!(),
        };
        records.push_str(&record);
        changed.push(name);
    }
    if changed.is_empty() {
        return Ok(());
    }
    records.push_str("prepare\n");
    let mut child = stage
        .limited_command(common)
        .args(["update-ref", "--no-deref", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let mut input = child.stdin.take().unwrap();
    let mut responses = BufReader::new(child.stdout.take().unwrap());
    let result = (|| -> GitResult<()> {
        input
            .write_all(records.as_bytes())
            .map_err(|error| error.to_string())?;
        for expected in ["start: ok\n", "prepare: ok\n"] {
            let mut response = String::new();
            responses
                .read_line(&mut response)
                .map_err(|error| error.to_string())?;
            if response != expected {
                return Err(MANUAL_FETCH.into());
            }
        }
        let locked = references(common, "refs/remotes/")?;
        let mut checks = Vec::new();
        for name in changed {
            if before.get(name) != locked.get(name) {
                return Err(MANUAL_FETCH.into());
            }
            // 旧 Git 的 create 可能接受悬空符号引用，而 for-each-ref 会略过它。仅检测新目的地。
            if !before.contains_key(name) && (reftable || has_loose_ref(common, name)?) {
                if checks.len() == MAX_SYMBOLIC_CHECKS {
                    return Err(MANUAL_FETCH.into());
                }
                checks.push(name);
            }
        }
        for name in checks {
            let symbolic = run_git(common, &["symbolic-ref", "--no-recurse", "--quiet", name])?;
            if symbolic.status.code() != Some(1) {
                return Err(MANUAL_FETCH.into());
            }
        }
        input
            .write_all(b"commit\n")
            .map_err(|error| error.to_string())
    })();
    // 显式 start 后关闭 stdin 会中止未提交的事务。
    drop(input);
    checked(
        child
            .wait_with_output()
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("{MANUAL_FETCH}\n{error}"))?;
    result
}

fn has_loose_ref(common: &Path, name: &str) -> GitResult<bool> {
    // files 后端的符号引用只能是 loose ref，新分支通常无需启动额外的 Git 进程。
    match fs::symlink_metadata(common.join(name)) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

/// 只在规划、发布时持有公共目录锁，慢速网络与临时引用的清理均不阻塞本地切换。
pub(super) fn fetch_remote(
    repo: &Path,
    common: &Path,
    remote: &str,
    deadline: Instant,
) -> GitResult<()> {
    let (stage, plan) = with_common_directory(common.into(), |_| {
        if common_directory(repo)? != common {
            return Err(MANUAL_FETCH.into());
        }
        let stage = Stage::new(repo, common)?;
        let plan = FetchPlan::read(repo, remote, &stage.prefix)?;
        Ok((stage, plan))
    })?;
    let result = (|| {
        plan.download(repo, &stage, deadline)?;
        let prefix = format!("{}/", stage.prefix);
        let mut after = References::new();
        for (name, reference) in references(stage.directory.path(), &prefix)? {
            let name = name
                .strip_prefix(&prefix)
                .filter(|name| name.starts_with("refs/remotes/"))
                .ok_or(MANUAL_FETCH)?;
            after.insert(name.to_owned(), reference);
        }
        with_common_directory(common.into(), |_| {
            if !stage.same_repository(common)?
                || common_directory(repo)? != common
                || RemoteConfig::read(repo, remote)? != plan.config
                || has_reference_hook(repo)?
            {
                return Err(MANUAL_FETCH.into());
            }
            publish(common, &stage, &plan.before, &after)
        })?;
        if plan.skipped {
            return Err(MANUAL_FETCH.into());
        }
        Ok(())
    })();
    let cleaned = stage.directory.close().map_err(|error| error.to_string());
    match (result, cleaned) {
        (Err(error), Err(cleanup_error)) => Err(format!("{error}\n{cleanup_error}")),
        (result, cleaned) => result.and(cleaned),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_uses_the_original_resolved_url_even_if_remote_is_reconfigured_and_restored() {
        let directory = tempfile::tempdir().unwrap();
        let repo = directory.path().join("local");
        let origin = directory.path().join("original");
        let other = directory.path().join("other");
        for path in [&repo, &origin, &other] {
            fs::create_dir(path).unwrap();
            git(path, &["init", "-b", "main"]).unwrap();
            git(
                path,
                &[
                    "-c",
                    "user.name=Fetch Test",
                    "-c",
                    "user.email=fetch@example.invalid",
                    "-c",
                    "core.hooksPath=/dev/null",
                    "-c",
                    "commit.gpgSign=false",
                    "commit",
                    "--allow-empty",
                    "-m",
                    path.file_name().unwrap().to_str().unwrap(),
                ],
            )
            .unwrap();
        }
        git(&repo, &["remote", "add", "origin", "planned:origin"]).unwrap();
        git(
            &repo,
            &[
                "config",
                &format!("url.{}.insteadOf", origin.display()),
                "planned:origin",
            ],
        )
        .unwrap();
        git(
            &repo,
            &[
                "config",
                &format!("url.{}.insteadOf", other.display()),
                origin.to_str().unwrap(),
            ],
        )
        .unwrap();
        let common = common_directory(&repo).unwrap();
        let stage = Stage::new(&repo, &common).unwrap();
        let visible_worktrees = git(&repo, &["worktree", "list", "--porcelain"]).unwrap();
        let plan = FetchPlan::read(&repo, "origin", &stage.prefix).unwrap();
        git(
            &repo,
            &["remote", "set-url", "origin", other.to_str().unwrap()],
        )
        .unwrap();
        plan.download(&repo, &stage, Instant::now() + BACKGROUND_FETCH_TIMEOUT)
            .unwrap();
        git(&repo, &["remote", "set-url", "origin", "planned:origin"]).unwrap();
        let staged = format!("{}/refs/remotes/origin/main", stage.prefix);
        assert_eq!(
            git_line(stage.directory.path(), &["rev-parse", &staged]).unwrap(),
            git_line(&origin, &["rev-parse", "HEAD"]).unwrap()
        );
        assert!(!commit_exists(&repo, "refs/remotes/origin/main").unwrap());
        assert_eq!(
            git_line(&repo, &["for-each-ref", "--format=%(refname)"]).unwrap(),
            "refs/heads/main"
        );
        assert_eq!(
            git_line(&repo, &["log", "--all", "--format=%s"]).unwrap(),
            "local"
        );
        assert_eq!(
            git(&repo, &["worktree", "list", "--porcelain"]).unwrap(),
            visible_worktrees
        );
        stage.directory.close().unwrap();
    }
}
