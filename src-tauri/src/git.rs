use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
};

const MAX_DIFF_BYTES: u64 = 2 * 1024 * 1024;
type GitResult<T> = Result<T, String>;
type RepositoryLocks = Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>;
static REPOSITORY_LOCKS: OnceLock<RepositoryLocks> = OnceLock::new();

mod navigation;
use navigation::{GitBranch, GitWorktreeInfo, branches, checkout, common_directory, worktrees};

#[cfg(target_os = "macos")]
mod environment;

/// 仓库状态只传递元数据；文件正文在用户选择文件后按需读取。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepository {
    pub path: String,
    pub name: String,
    pub common_dir: String,
    pub repository_name: String,
    pub worktrees: Vec<GitWorktreeInfo>,
    pub branch: String,
    pub has_head: bool,
    pub files: Vec<GitChange>,
}

/// 保留索引区和工作区的独立状态，避免部分暂存的文件被错误合并。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    pub path: String,
    pub original_path: Option<String>,
    pub status_index: String,
    pub status_worktree: String,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeArea {
    Unstaged,
    Staged,
}

/// null 表示该版本不存在；notice 表示该文件不能按普通文本展示。
#[derive(Debug, Serialize)]
pub struct GitDiff {
    pub original: Option<String>,
    pub modified: Option<String>,
    pub notice: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub commit_id: String,
}

fn command(repo: &Path) -> Command {
    let mut command = Command::new("git");
    #[cfg(target_os = "macos")]
    environment::apply_path(&mut command);
    command
        .arg("--literal-pathspecs")
        .arg("-C")
        .arg(repo)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null());
    command
}

fn run_git(repo: &Path, args: &[&str]) -> GitResult<Output> {
    command(repo)
        .args(args)
        .output()
        .map_err(|error| format!("无法运行 Git，请确认已安装 Git：{error}"))
}

fn checked(output: Output) -> GitResult<Vec<u8>> {
    if output.status.success() {
        Ok(output.stdout)
    } else {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        Err(if error.is_empty() {
            String::from_utf8_lossy(&output.stdout).trim().to_owned()
        } else {
            error
        })
    }
}

fn git(repo: &Path, args: &[&str]) -> GitResult<Vec<u8>> {
    checked(run_git(repo, args)?)
}

fn utf8(bytes: Vec<u8>) -> GitResult<String> {
    String::from_utf8(bytes).map_err(|_| "此仓库包含非 UTF-8 路径，当前版本暂不支持。".into())
}

fn git_line(repo: &Path, args: &[&str]) -> GitResult<String> {
    // 仅移除 Git 添加的换行，保留目录或分支名称中的空白。
    let output = utf8(git(repo, args)?)?;
    Ok(output.strip_suffix('\n').unwrap_or(&output).to_owned())
}

fn repository_root(path: &str) -> GitResult<PathBuf> {
    let input = fs::canonicalize(path).map_err(|error| format!("无法打开目录：{error}"))?;
    let root = git_line(&input, &["rev-parse", "--show-toplevel"])?;
    fs::canonicalize(root).map_err(|error| format!("无法定位 Git 工作区：{error}"))
}

/// 同一仓库的工作区共享分支引用，因此按 common dir 排队读写，避免切换与提交互相覆盖。
fn with_repository<T>(path: &str, operation: impl FnOnce(&Path) -> GitResult<T>) -> GitResult<T> {
    let root = repository_root(path)?;
    let common_dir = common_directory(&root)?;
    let lock = REPOSITORY_LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "仓库锁不可用，请重启应用。")?
        .entry(common_dir)
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone();
    let _guard = lock.lock().map_err(|_| "仓库操作已中断，请重启应用。")?;
    operation(&root)
}

fn has_head(repo: &Path) -> GitResult<bool> {
    Ok(run_git(repo, &["rev-parse", "--verify", "HEAD"])?
        .status
        .success())
}

/// porcelain -z 的重命名记录先返回新路径，再返回原路径；路径不能按行分割。
fn parse_status(bytes: &[u8]) -> GitResult<Vec<GitChange>> {
    let mut records = bytes
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty());
    let mut files: Vec<GitChange> = Vec::new();
    let mut positions = HashMap::new();
    while let Some(record) = records.next() {
        if record.len() < 4 || record[2] != b' ' {
            return Err("无法解析 Git 文件状态。".into());
        }
        let x = record[0] as char;
        let y = record[1] as char;
        let original_path = if matches!(x, 'R' | 'C') || matches!(y, 'R' | 'C') {
            Some(utf8(
                records.next().ok_or("Git 重命名记录不完整。")?.to_vec(),
            )?)
        } else {
            None
        };
        let path = utf8(record[3..].to_vec())?;
        // git rm --cached 后原文件仍存在时，Git 会分别输出 D 和 ?? 两条同路径记录。
        if x == '?' {
            if let Some(&position) = positions.get(&path) {
                let existing: &mut GitChange = &mut files[position];
                existing.status_worktree = "?".into();
                continue;
            }
        }
        positions.insert(path.clone(), files.len());
        files.push(GitChange {
            path,
            original_path,
            status_index: x.to_string(),
            status_worktree: y.to_string(),
            conflicted: matches!(
                &record[..2],
                b"DD" | b"AU" | b"UD" | b"UA" | b"DU" | b"AA" | b"UU"
            ),
        });
    }
    Ok(files)
}

fn changes(repo: &Path) -> GitResult<Vec<GitChange>> {
    parse_status(&git(
        repo,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?)
}

fn status(repo: &Path) -> GitResult<GitRepository> {
    let has_head = has_head(repo)?;
    let symbolic = run_git(repo, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    let branch = if symbolic.status.success() {
        utf8(symbolic.stdout)?.trim_end_matches('\n').to_owned()
    } else if has_head {
        format!(
            "分离 HEAD · {}",
            git_line(repo, &["rev-parse", "--short", "HEAD"])?
        )
    } else {
        "尚无提交".into()
    };
    let common_dir = common_directory(repo)?;
    let worktrees = worktrees(repo)?;
    let repository_name = worktrees
        .first()
        .and_then(|worktree| Path::new(&worktree.path).file_name())
        .unwrap_or(common_dir.as_os_str())
        .to_string_lossy()
        .trim_end_matches(".git")
        .to_owned();
    Ok(GitRepository {
        common_dir: common_dir.to_string_lossy().into_owned(),
        repository_name,
        worktrees,
        path: repo.to_string_lossy().into_owned(),
        name: repo
            .file_name()
            .unwrap_or(repo.as_os_str())
            .to_string_lossy()
            .into_owned(),
        branch,
        has_head,
        files: changes(repo)?,
    })
}

fn validate_relative_path(path: &str) -> GitResult<()> {
    if path.is_empty()
        || !Path::new(path)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
    {
        return Err("文件路径必须是仓库内的相对路径。".into());
    }
    Ok(())
}

fn selected_change(repo: &Path, path: &str) -> GitResult<GitChange> {
    validate_relative_path(path)?;
    changes(repo)?
        .into_iter()
        .find(|file| file.path == path)
        .ok_or_else(|| "该文件已不在变更列表中，请刷新后重试。".into())
}

fn text_content(bytes: Vec<u8>) -> Result<String, &'static str> {
    if bytes.contains(&0) {
        return Err("二进制文件暂不支持文本 Diff，可直接暂存和提交。");
    }
    String::from_utf8(bytes)
        .map_err(|_| "此文件不是 UTF-8 文本，暂不支持文本 Diff，可直接暂存和提交。")
}

/// 先固定对象 ID 再检查大小，避免读取过程中 HEAD 或索引变化绕过体积限制。
fn blob_content(repo: &Path, spec: &str) -> GitResult<Result<String, &'static str>> {
    let object = git_line(repo, &["rev-parse", "--verify", spec])?;
    if git_line(repo, &["cat-file", "-t", &object])? != "blob" {
        return Ok(Err("子模块或目录变更暂不支持文本 Diff，可直接暂存和提交。"));
    }
    let size: u64 = git_line(repo, &["cat-file", "-s", &object])?
        .parse()
        .map_err(|_| "无法读取 Git 对象大小。")?;
    if size > MAX_DIFF_BYTES {
        return Ok(Err("文件超过 2 MiB，已跳过文本 Diff，可直接暂存和提交。"));
    }
    Ok(text_content(git(repo, &["cat-file", "blob", &object])?))
}

fn working_content(repo: &Path, path: &str) -> GitResult<Result<String, &'static str>> {
    let full = repo.join(path);
    let parent = fs::canonicalize(full.parent().unwrap())
        .map_err(|error| format!("无法读取文件目录：{error}"))?;
    if !parent.starts_with(repo) {
        return Ok(Err("该文件的父目录链接到仓库外，已跳过文本 Diff。"));
    }
    let metadata = fs::symlink_metadata(&full).map_err(|error| format!("无法读取文件：{error}"))?;
    if metadata.file_type().is_symlink() {
        let target = fs::read_link(full).map_err(|error| format!("无法读取符号链接：{error}"))?;
        return Ok(Ok(target.to_string_lossy().into_owned()));
    }
    if !metadata.is_file() {
        return Ok(Err("子模块或目录变更暂不支持文本 Diff，可直接暂存和提交。"));
    }
    if metadata.len() > MAX_DIFF_BYTES {
        return Ok(Err("文件超过 2 MiB，已跳过文本 Diff，可直接暂存和提交。"));
    }
    let mut bytes = Vec::new();
    fs::File::open(full)
        .map_err(|error| format!("无法打开文件：{error}"))?
        .take(MAX_DIFF_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("无法读取文件：{error}"))?;
    if bytes.len() as u64 > MAX_DIFF_BYTES {
        return Ok(Err("文件超过 2 MiB，已跳过文本 Diff，可直接暂存和提交。"));
    }
    Ok(text_content(bytes))
}

fn diff(repo: &Path, path: &str, area: ChangeArea) -> GitResult<GitDiff> {
    let file = selected_change(repo, path)?;
    let notice = |message: &str| {
        Ok(GitDiff {
            original: None,
            modified: None,
            notice: Some(message.into()),
        })
    };
    if file.conflicted {
        return notice("此文件包含合并冲突，请先在编辑器中解决冲突，再暂存和提交。");
    }
    // 子模块提交对象通常只存在于子模块对象库，不能交给父仓库 cat-file 读取。
    let index_entry = git(repo, &["ls-files", "--stage", "-z", "--", path])?;
    let head_entry = if matches!(area, ChangeArea::Staged) && has_head(repo)? {
        git(
            repo,
            &[
                "ls-tree",
                "-z",
                "HEAD",
                "--",
                file.original_path.as_deref().unwrap_or(path),
            ],
        )?
    } else {
        Vec::new()
    };
    if index_entry.starts_with(b"160000 ") || head_entry.starts_with(b"160000 ") {
        return notice("子模块变更暂不支持文本 Diff，可直接暂存和提交。");
    }
    let (original, modified) = match area {
        ChangeArea::Staged => {
            if matches!(file.status_index.as_str(), " " | "?") {
                return Err("该文件没有已暂存变更，请刷新后重试。".into());
            }
            let old_path = if matches!(file.status_index.as_str(), "R" | "C") {
                file.original_path.as_deref().unwrap_or(path)
            } else {
                path
            };
            let original = if file.status_index == "A" {
                None
            } else {
                Some(blob_content(repo, &format!("HEAD:{old_path}"))?)
            };
            let modified = if file.status_index == "D" {
                None
            } else {
                Some(blob_content(repo, &format!(":{path}"))?)
            };
            (original, modified)
        }
        ChangeArea::Unstaged => {
            if file.status_worktree == " " {
                return Err("该文件没有未暂存变更，请刷新后重试。".into());
            }
            let old_path = if matches!(file.status_worktree.as_str(), "R" | "C") {
                file.original_path.as_deref().unwrap_or(path)
            } else {
                path
            };
            let original = if file.status_worktree == "?" || file.status_index == "D" {
                None
            } else {
                Some(blob_content(repo, &format!(":{old_path}"))?)
            };
            let modified = if file.status_worktree == "D" {
                None
            } else {
                Some(working_content(repo, path)?)
            };
            (original, modified)
        }
    };
    for content in [original.as_ref(), modified.as_ref()].into_iter().flatten() {
        if let Err(message) = content {
            return notice(message);
        }
    }
    if original == modified {
        let mut args = vec![
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--summary",
        ];
        if matches!(area, ChangeArea::Staged) {
            args.push("--cached");
        }
        args.extend(["--", path]);
        if let Some(old_path) = file.original_path.as_deref() {
            args.push(old_path);
        }
        let summary = git_line(repo, &args)?;
        if !summary.trim().is_empty() {
            return notice(&format!(
                "文本内容未变化，仅文件属性或路径发生变化。\n{}",
                summary.trim()
            ));
        }
    }
    Ok(GitDiff {
        original: original.map(Result::unwrap),
        modified: modified.map(Result::unwrap),
        notice: None,
    })
}

/// 在独立索引中完成整批操作，成功后原子替换；Git 的标准锁阻止其他进程同时写索引。
struct IndexTransaction {
    index: PathBuf,
    lock: PathBuf,
    lock_owned: bool,
    directory: PathBuf,
    temporary: PathBuf,
    directory_created: bool,
}

impl IndexTransaction {
    fn new(repo: &Path) -> GitResult<Self> {
        static NEXT_INDEX: AtomicU64 = AtomicU64::new(0);
        let index = PathBuf::from(git_line(
            repo,
            &["rev-parse", "--path-format=absolute", "--git-path", "index"],
        )?);
        // Git 会沿索引符号链接加锁，需锁定真实文件才能与外部 Git 互斥。
        let index = if index.exists() {
            fs::canonicalize(index).map_err(|error| format!("无法定位 Git 索引：{error}"))?
        } else {
            index
        };
        let lock = index.with_file_name(format!(
            "{}.lock",
            index.file_name().unwrap().to_string_lossy()
        ));
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock)
            .map_err(|error| {
                format!("无法锁定 Git 索引，请确认没有其他 Git 操作正在进行：{error}")
            })?;
        let directory = index.with_file_name(format!(
            "git-workbench-index-{}-{}",
            std::process::id(),
            NEXT_INDEX.fetch_add(1, Ordering::Relaxed)
        ));
        let mut transaction = Self {
            temporary: directory.join("index"),
            index,
            lock,
            lock_owned: true,
            directory,
            directory_created: false,
        };
        fs::create_dir(&transaction.directory)
            .map_err(|error| format!("无法创建临时索引目录：{error}"))?;
        transaction.directory_created = true;
        if transaction.index.exists() {
            fs::copy(&transaction.index, &transaction.temporary)
                .map_err(|error| format!("无法复制 Git 索引：{error}"))?;
        }
        Ok(transaction)
    }

    fn run(&self, repo: &Path, args: &[&str], input: &[u8]) -> GitResult<Vec<u8>> {
        let mut command = command(repo);
        command.env("GIT_INDEX_FILE", &self.temporary);
        command_with_input(command, args, input)
    }

    fn publish(mut self) -> GitResult<()> {
        fs::copy(&self.temporary, &self.lock)
            .map_err(|error| format!("无法写入 Git 索引：{error}"))?;
        fs::rename(&self.lock, &self.index)
            .map_err(|error| format!("无法更新 Git 索引：{error}"))?;
        self.lock_owned = false;
        Ok(())
    }
}

impl Drop for IndexTransaction {
    fn drop(&mut self) {
        if self.lock_owned {
            let _ = fs::remove_file(&self.lock);
        }
        if self.directory_created {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }
}

/// 一批只读取一次状态，并在修改索引前验证全部文件，避免过期选择造成部分成功。
fn selected_changes(repo: &Path, paths: &[String]) -> GitResult<Vec<GitChange>> {
    if paths.is_empty() {
        return Err("请选择要操作的变更文件。".into());
    }
    for path in paths {
        validate_relative_path(path)?;
    }
    let mut files: HashMap<String, GitChange> = changes(repo)?
        .into_iter()
        .map(|file| (file.path.clone(), file))
        .collect();
    let mut selected = Vec::new();
    let mut visited = HashSet::new();
    for path in paths {
        if visited.insert(path) {
            selected.push(
                files
                    .remove(path)
                    .ok_or("部分文件已不在变更列表中，请刷新后重试。")?,
            );
        }
    }
    Ok(selected)
}

fn is_parent_path(parent: &str, child: &str) -> bool {
    child
        .strip_prefix(parent)
        .is_some_and(|suffix| suffix.starts_with('/'))
}

/// 文件与目录不能同时存在于索引；整批选择的删除项一起校验，不依赖前端操作顺序。
fn ensure_index_paths_available(repo: &Path, restored: &[&str], removed: &[&str]) -> GitResult<()> {
    let indexed = utf8(git(repo, &["ls-files", "-z"])?)?;
    let removed: HashSet<&str> = removed.iter().copied().collect();
    for indexed_path in indexed
        .split('\0')
        .filter(|path| !path.is_empty() && !removed.contains(path))
    {
        for restored_path in restored {
            if is_parent_path(restored_path, indexed_path)
                || is_parent_path(indexed_path, restored_path)
            {
                return Err(format!(
                    "路径“{restored_path}”与索引中的“{indexed_path}”冲突。请先处理对应文件的暂存状态，再重试。"
                ));
            }
        }
    }
    Ok(())
}

fn nul_paths(paths: &[&str]) -> Vec<u8> {
    paths
        .iter()
        .flat_map(|path| path.as_bytes().iter().copied().chain([0]))
        .collect()
}

/// 仅操作选择文件：删除记录精确移除自身，其他文件通过 Git 保留过滤器及子模块语义。
fn stage_paths(repo: &Path, paths: &[String]) -> GitResult<()> {
    let transaction = IndexTransaction::new(repo)?;
    let files = selected_changes(repo, paths)?;
    let mut removed = Vec::new();
    let mut added = Vec::new();
    for file in &files {
        if file.status_worktree == "D" {
            removed.push(file.path.as_str());
        } else {
            added.push(file.path.as_str());
            if file.status_worktree == "R" {
                if let Some(original) = file.original_path.as_deref() {
                    removed.push(original);
                }
            }
        }
    }
    let selected: Vec<&str> = files
        .iter()
        .map(|file| file.path.as_str())
        .chain(removed.iter().copied())
        .collect();
    ensure_index_paths_available(repo, &added, &selected)?;
    if !removed.is_empty() {
        transaction.run(
            repo,
            &["update-index", "--force-remove", "-z", "--stdin"],
            &nul_paths(&removed),
        )?;
    }
    if !added.is_empty() {
        transaction.run(
            repo,
            &["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
            &nul_paths(&added),
        )?;
    }
    transaction.publish()
}

/// 批量读取 HEAD 的精确文件记录并恢复索引，保留工作区和未选择的部分暂存内容。
fn unstage_paths(repo: &Path, paths: &[String]) -> GitResult<()> {
    let transaction = IndexTransaction::new(repo)?;
    let files = selected_changes(repo, paths)?;
    if files
        .iter()
        .any(|file| matches!(file.status_index.as_str(), " " | "?"))
    {
        return Err("部分文件没有已暂存变更，请刷新后重试。".into());
    }
    let paths: Vec<&str> = files
        .iter()
        .flat_map(|file| {
            std::iter::once(file.path.as_str()).chain(if file.status_index == "R" {
                file.original_path.as_deref()
            } else {
                None
            })
        })
        .collect();
    let head = run_git(repo, &["rev-parse", "--verify", "HEAD"])?;
    if !head.status.success() {
        transaction.run(
            repo,
            &["update-index", "--force-remove", "-z", "--stdin"],
            &nul_paths(&paths),
        )?;
        return transaction.publish();
    }
    let head = utf8(head.stdout)?.trim_end_matches('\n').to_owned();
    let null_object = "0".repeat(head.len());
    let mut records = Vec::new();
    for path in &paths {
        records.extend_from_slice(format!("0 {null_object}\t{path}\0").as_bytes());
    }
    let mut args = vec!["ls-tree", "-r", "-z", &head, "--"];
    args.extend(paths.iter().copied());
    let entries = git(repo, &args)?;
    let selected: HashSet<&str> = paths.iter().copied().collect();
    let mut restored = Vec::new();
    for entry in entries
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
    {
        let (_, path) = entry.split_at(
            entry
                .iter()
                .position(|byte| *byte == b'\t')
                .ok_or("无法解析 HEAD 文件记录。")?
                + 1,
        );
        let path =
            std::str::from_utf8(path).map_err(|_| "此仓库包含非 UTF-8 路径，当前版本暂不支持。")?;
        if selected.contains(path) {
            restored.push(path);
            records.extend_from_slice(entry);
            records.push(0);
        }
    }
    ensure_index_paths_available(repo, &restored, &paths)?;
    transaction.run(repo, &["update-index", "-z", "--index-info"], &records)?;
    transaction.publish()
}

fn git_with_input(repo: &Path, args: &[&str], input: &[u8]) -> GitResult<Vec<u8>> {
    command_with_input(command(repo), args, input)
}

fn command_with_input(mut command: Command, args: &[&str], input: &[u8]) -> GitResult<Vec<u8>> {
    let mut child = command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 Git：{error}"))?;
    let write_result = child
        .stdin
        .take()
        .ok_or("无法写入 Git 输入。")?
        .write_all(input);
    let output = child
        .wait_with_output()
        .map_err(|error| format!("无法等待 Git：{error}"))?;
    let result = checked(output)?;
    write_result.map_err(|error| format!("无法写入 Git 输入：{error}"))?;
    Ok(result)
}

fn commit(repo: &Path, summary: &str, description: &str) -> GitResult<CommitResult> {
    let summary = summary.trim();
    if summary.is_empty() {
        return Err("请填写提交说明。".into());
    }
    let files = changes(repo)?;
    if files.iter().any(|file| file.conflicted) {
        return Err("仓库存在未解决的冲突，请解决并暂存后重试。".into());
    }
    if !files
        .iter()
        .any(|file| !matches!(file.status_index.as_str(), " " | "?"))
    {
        return Err("没有已暂存的文件可提交。".into());
    }
    let message = if description.trim().is_empty() {
        format!("{summary}\n")
    } else {
        format!("{summary}\n\n{}\n", description.trim())
    };
    git_with_input(repo, &["commit", "-F", "-"], message.as_bytes())?;
    Ok(CommitResult {
        commit_id: git_line(repo, &["rev-parse", "HEAD"])?,
    })
}

async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> GitResult<T> + Send + 'static,
) -> GitResult<T> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("Git 任务执行失败：{error}"))?
}

/// 打开选定目录所属的普通仓库或 linked worktree。
#[tauri::command]
pub async fn git_open(path: String) -> GitResult<GitRepository> {
    blocking(move || with_repository(&path, status)).await
}

/// 读取当前分支及索引、工作区的独立文件状态。
#[tauri::command]
pub async fn git_status(repo_path: String) -> GitResult<GitRepository> {
    blocking(move || with_repository(&repo_path, status)).await
}

/// 按所选比较区域读取两份文本，并返回不适合文本展示的原因。
#[tauri::command]
pub async fn git_diff(repo_path: String, path: String, area: ChangeArea) -> GitResult<GitDiff> {
    blocking(move || with_repository(&repo_path, |repo| diff(repo, &path, area))).await
}

/// 仅暂存所选变更文件，不连带操作未选择的索引条目。
#[tauri::command]
pub async fn git_stage(repo_path: String, paths: Vec<String>) -> GitResult<()> {
    blocking(move || with_repository(&repo_path, |repo| stage_paths(repo, &paths))).await
}

/// 将所选索引条目恢复到 HEAD，保留工作区文件内容。
#[tauri::command]
pub async fn git_unstage(repo_path: String, paths: Vec<String>) -> GitResult<()> {
    blocking(move || with_repository(&repo_path, |repo| unstage_paths(repo, &paths))).await
}

/// 提交当前索引并返回真实提交 ID，保留 Git 配置和 hooks 行为。
#[tauri::command]
pub async fn git_commit(
    repo_path: String,
    summary: String,
    description: String,
) -> GitResult<CommitResult> {
    blocking(move || with_repository(&repo_path, |repo| commit(repo, &summary, &description))).await
}

/// 列出本地和远程分支，并标记其他工作区已占用的分支。
#[tauri::command]
pub async fn git_branches(repo_path: String) -> GitResult<Vec<GitBranch>> {
    blocking(move || with_repository(&repo_path, branches)).await
}

/// 使用 Git 的普通切换语义，保留脏文件保护与其他工作区的分支占用限制。
#[tauri::command]
pub async fn git_checkout(
    repo_path: String,
    full_name: String,
) -> GitResult<navigation::CheckoutResult> {
    blocking(move || with_repository(&repo_path, |repo| checkout(repo, &full_name))).await
}

#[cfg(test)]
mod tests;
