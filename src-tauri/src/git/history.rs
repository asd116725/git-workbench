use super::*;
use std::io::{BufRead, BufReader};

const PAGE_SIZE: usize = 50;
const COMMIT_FORMAT: &str = "%H%x00%h%x00%s%x00%an%x00%ae%x00%ct%x00%P%x00%B";

#[derive(Debug, Serialize)]
pub struct HistoryRef {
    pub oid: Option<String>,
}

/// 历史列表只携带提交元数据，文件和正文在选中后读取。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub oid: String,
    pub short_hash: String,
    pub subject: String,
    pub author_name: String,
    pub author_email: String,
    pub committed_at: i64,
    pub parents: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub commits: Vec<CommitSummary>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub old_mode: String,
    pub new_mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub commit: CommitSummary,
    pub message: String,
    pub parent_oid: Option<String>,
    pub parent_index: usize,
    pub files: Vec<CommitFile>,
}

struct CommitRecord {
    summary: CommitSummary,
    message: String,
}

struct FileRecord {
    file: CommitFile,
    old_oid: String,
    new_oid: String,
}

fn resolve_reference(repo: &Path, reference: Option<&str>) -> GitResult<HistoryRef> {
    let reference = reference.unwrap_or("HEAD");
    if reference != "HEAD"
        && (!(reference.starts_with("refs/heads/") || reference.starts_with("refs/remotes/"))
            || !run_git(repo, &["check-ref-format", reference])?
                .status
                .success())
    {
        return Err("请选择完整的本地或远程分支引用。".into());
    }
    let output = run_git(
        repo,
        &["rev-parse", "--verify", &format!("{reference}^{{commit}}")],
    )?;
    if output.status.success() {
        return Ok(HistoryRef {
            oid: Some(utf8(output.stdout)?.trim().into()),
        });
    }
    // 只有尚无提交的 HEAD 是正常空态，失效的筛选分支不能悄悄退回当前分支。
    if reference == "HEAD"
        && run_git(repo, &["symbolic-ref", "--quiet", "HEAD"])?
            .status
            .success()
        && !has_head(repo)?
    {
        return Ok(HistoryRef { oid: None });
    }
    Err("历史分支不存在或没有可读取的提交，请重新选择分支。".into())
}

/// 后续请求只能使用完整对象 ID，避免分支移动或删除改变正在浏览的历史。
fn validate_commit(repo: &Path, oid: &str) -> GitResult<()> {
    if !matches!(oid.len(), 40 | 64) || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("历史提交必须使用完整的 Git 对象 ID。".into());
    }
    if git_line(repo, &["cat-file", "-t", oid])? != "commit" {
        return Err("所选对象不是 Git 提交。".into());
    }
    Ok(())
}

fn read_record(reader: &mut impl BufRead) -> GitResult<Option<CommitRecord>> {
    let mut fields = Vec::with_capacity(8);
    for index in 0..8 {
        let mut bytes = Vec::new();
        let read = reader
            .read_until(0, &mut bytes)
            .map_err(|error| format!("无法读取提交记录：{error}"))?;
        if read == 0 && index == 0 {
            return Ok(None);
        }
        if bytes.pop() != Some(0) {
            return Err("Git 提交记录不完整。".into());
        }
        fields.push(String::from_utf8(bytes).map_err(|_| "提交记录无法转换为 UTF-8。")?);
    }
    let mut fields = fields.into_iter();
    Ok(Some(CommitRecord {
        summary: CommitSummary {
            oid: fields.next().unwrap(),
            short_hash: fields.next().unwrap(),
            subject: fields.next().unwrap(),
            author_name: fields.next().unwrap(),
            author_email: fields.next().unwrap(),
            committed_at: fields
                .next()
                .unwrap()
                .parse()
                .map_err(|_| "Git 提交时间格式无效。")?,
            parents: fields
                .next()
                .unwrap()
                .split_whitespace()
                .map(str::to_owned)
                .collect(),
        },
        message: fields.next().unwrap().trim_end_matches('\n').into(),
    }))
}

fn history_command(repo: &Path) -> Command {
    let mut command = command(repo);
    command.args([
        "-c",
        "log.showSignature=false",
        "-c",
        "log.showNotes=false",
        "log",
        "-z",
        "--no-color",
        "--no-decorate",
        "--no-notes",
        "--encoding=UTF-8",
        "--abbrev=7",
        "--date-order",
        &format!("--format={COMMIT_FORMAT}"),
    ]);
    command
}

fn commit_record(repo: &Path, oid: &str) -> GitResult<CommitRecord> {
    validate_commit(repo, oid)?;
    let bytes = checked(
        history_command(repo)
            .args(["--max-count=1", oid, "--"])
            .output()
            .map_err(|error| format!("无法读取提交：{error}"))?,
    )?;
    read_record(&mut bytes.as_slice())?.ok_or_else(|| "提交记录不存在。".into())
}

fn query_key(query: &str) -> String {
    query
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn page_offset(snapshot: &str, query: &str, cursor: Option<&str>) -> GitResult<usize> {
    let Some(cursor) = cursor else {
        return Ok(0);
    };
    let mut parts = cursor.splitn(3, ':');
    let oid = parts.next();
    let offset = parts.next().and_then(|value| value.parse().ok());
    let key = parts.next();
    if oid != Some(snapshot) || key != Some(query_key(query).as_str()) || offset.is_none() {
        return Err("历史分页条件已变化，请重新加载提交列表。".into());
    }
    Ok(offset.unwrap())
}

fn matches_query(record: &CommitRecord, query: &str) -> bool {
    query.is_empty()
        || [
            &record.summary.oid,
            &record.summary.subject,
            &record.summary.author_name,
            &record.summary.author_email,
            &record.message,
        ]
        .iter()
        .any(|value| value.to_lowercase().contains(query))
}

/// 固定 tip 后流式扫描完整历史；游标绑定查询，且只推进到最后实际返回的提交。
fn history(
    repo: &Path,
    snapshot: &str,
    query: &str,
    cursor: Option<&str>,
) -> GitResult<HistoryPage> {
    validate_commit(repo, snapshot)?;
    let query = query.to_lowercase();
    let offset = page_offset(snapshot, &query, cursor)?;
    let mut command = history_command(repo);
    command
        .args([&format!("--skip={offset}"), snapshot, "--"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法读取提交历史：{error}"))?;
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    let mut stderr = child.stderr.take().unwrap();
    // 同时消费错误流，防止 Git 警告较多时阻塞正文读取。
    let errors = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).map(|_| bytes)
    });
    let mut stopped_early = false;
    let result = (|| {
        let mut commits = Vec::with_capacity(PAGE_SIZE);
        let mut scanned = offset;
        let mut returned_offset = offset;
        while let Some(record) = read_record(&mut reader)? {
            scanned += 1;
            if !matches_query(&record, &query) {
                continue;
            }
            if commits.len() == PAGE_SIZE {
                stopped_early = true;
                return Ok(HistoryPage {
                    commits,
                    next_cursor: Some(format!(
                        "{snapshot}:{returned_offset}:{}",
                        query_key(&query)
                    )),
                });
            }
            commits.push(record.summary);
            returned_offset = scanned;
        }
        Ok(HistoryPage {
            commits,
            next_cursor: None,
        })
    })();
    if stopped_early || result.is_err() {
        let _ = child.kill();
    }
    drop(reader);
    let status = child
        .wait()
        .map_err(|error| format!("无法等待 Git 历史读取：{error}"))?;
    let error = errors
        .join()
        .map_err(|_| "Git 错误输出读取已中断。")?
        .map_err(|error| error.to_string())?;
    if result.is_ok() && !stopped_early && !status.success() {
        return Err(String::from_utf8_lossy(&error).trim().to_owned());
    }
    result
}

fn parent_for(record: &CommitRecord, parent_index: usize) -> GitResult<Option<String>> {
    if record.summary.parents.is_empty() && parent_index == 0 {
        return Ok(None);
    }
    record
        .summary
        .parents
        .get(parent_index)
        .cloned()
        .map(Some)
        .ok_or_else(|| "所选父提交不存在，请重新选择。".into())
}

/// raw -z 同时给出模式、对象 ID 和原始路径；重命名后按旧、新对象分别读取。
fn changed_files(repo: &Path, oid: &str, parent: Option<&str>) -> GitResult<Vec<FileRecord>> {
    let mut args = vec![
        "diff-tree",
        "--raw",
        "-r",
        "-z",
        "--no-commit-id",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--find-renames",
        "--no-abbrev",
    ];
    if let Some(parent) = parent {
        args.extend([parent, oid]);
    } else {
        args.extend(["--root", oid]);
    }
    args.push("--");
    let bytes = git(repo, &args)?;
    let mut fields = bytes
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty());
    let mut files = Vec::new();
    while let Some(header) = fields.next() {
        let header = std::str::from_utf8(header).map_err(|_| "Git 文件状态格式无效。")?;
        let parts: Vec<_> = header.trim_start_matches(':').split_whitespace().collect();
        if !header.starts_with(':') || parts.len() != 5 {
            return Err("Git 文件状态记录不完整。".into());
        }
        let status = parts[4]
            .chars()
            .next()
            .ok_or("Git 文件状态缺失。")?
            .to_string();
        let first = utf8(fields.next().ok_or("Git 文件路径缺失。")?.to_vec())?;
        let (path, old_path) = if matches!(status.as_str(), "R" | "C") {
            (
                utf8(fields.next().ok_or("Git 重命名目标路径缺失。")?.to_vec())?,
                Some(first),
            )
        } else {
            (first, None)
        };
        files.push(FileRecord {
            file: CommitFile {
                path,
                old_path,
                status,
                old_mode: parts[0].into(),
                new_mode: parts[1].into(),
            },
            old_oid: parts[2].into(),
            new_oid: parts[3].into(),
        });
    }
    Ok(files)
}

fn detail(repo: &Path, oid: &str, parent_index: usize) -> GitResult<CommitDetail> {
    let record = commit_record(repo, oid)?;
    let parent_oid = parent_for(&record, parent_index)?;
    let files = changed_files(repo, oid, parent_oid.as_deref())?
        .into_iter()
        .map(|record| record.file)
        .collect();
    Ok(CommitDetail {
        commit: record.summary,
        message: record.message,
        parent_oid,
        parent_index,
        files,
    })
}

fn historical_content(
    repo: &Path,
    oid: &str,
    mode: &str,
) -> GitResult<Result<Option<String>, String>> {
    if mode == "000000" {
        return Ok(Ok(None));
    }
    if mode == "160000" {
        return Ok(Err("子模块变更暂不支持文本 Diff。".into()));
    }
    Ok(match blob_content(repo, oid)? {
        Ok(text) => Ok(Some(text)),
        Err(notice) => Err(notice.replace("，可直接暂存和提交", "")),
    })
}

fn historical_diff(repo: &Path, oid: &str, parent_index: usize, path: &str) -> GitResult<GitDiff> {
    validate_relative_path(path)?;
    let record = commit_record(repo, oid)?;
    let parent = parent_for(&record, parent_index)?;
    let selected = changed_files(repo, oid, parent.as_deref())?
        .into_iter()
        .find(|record| record.file.path == path)
        .ok_or("文件不在当前提交的变更列表中。")?;
    let original = historical_content(repo, &selected.old_oid, &selected.file.old_mode)?;
    let modified = historical_content(repo, &selected.new_oid, &selected.file.new_mode)?;
    let notice = |text: String| {
        Ok(GitDiff {
            original: None,
            modified: None,
            notice: Some(text),
        })
    };
    let (original, modified) = match (original, modified) {
        (Ok(original), Ok(modified)) => (original, modified),
        (Err(message), _) | (_, Err(message)) => return notice(message),
    };
    if original == modified {
        return notice(if selected.file.old_mode != selected.file.new_mode {
            format!(
                "文本内容未变化，文件模式从 {} 变为 {}。",
                selected.file.old_mode, selected.file.new_mode
            )
        } else {
            "文本内容未变化，仅文件路径发生变化。".into()
        });
    }
    Ok(GitDiff {
        original,
        modified,
        notice: None,
    })
}

/// 引用解析很短，可与仓库写操作串行；之后的历史扫描不持有公共仓库锁。
#[tauri::command]
pub async fn git_history_ref(
    repo_path: String,
    reference: Option<String>,
) -> GitResult<HistoryRef> {
    blocking(move || {
        with_repository(&repo_path, |repo| {
            resolve_reference(repo, reference.as_deref())
        })
    })
    .await
}

/// 使用固定提交快照分页，不访问工作区或索引内容。
#[tauri::command]
pub async fn git_history(
    repo_path: String,
    snapshot: String,
    query: String,
    cursor: Option<String>,
) -> GitResult<HistoryPage> {
    blocking(move || {
        history(
            &repository_root(&repo_path)?,
            &snapshot,
            &query,
            cursor.as_deref(),
        )
    })
    .await
}

/// 按选定父提交读取变更文件；根提交使用空树作为比较基准。
#[tauri::command]
pub async fn git_commit_detail(
    repo_path: String,
    oid: String,
    parent_index: usize,
) -> GitResult<CommitDetail> {
    blocking(move || detail(&repository_root(&repo_path)?, &oid, parent_index)).await
}

/// 两侧内容均来自 Git 对象，工作区脏文件和索引不会影响历史 Diff。
#[tauri::command]
pub async fn git_commit_diff(
    repo_path: String,
    oid: String,
    parent_index: usize,
    path: String,
) -> GitResult<GitDiff> {
    blocking(move || historical_diff(&repository_root(&repo_path)?, &oid, parent_index, &path))
        .await
}

#[cfg(test)]
mod tests;
