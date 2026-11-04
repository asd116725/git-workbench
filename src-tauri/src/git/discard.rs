use super::*;
use sha2::{Digest, Sha256};

/// 确认框只携带精确路径及状态摘要，不向前端传递文件正文。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardFile {
    pub path: String,
    pub untracked: bool,
}

/// 摘要绑定索引、分支及文件内容，确认后发生变化时必须重新预览。
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardPreview {
    pub files: Vec<DiscardFile>,
    pub snapshot: String,
}

fn hash_part(hash: &mut Sha256, bytes: &[u8]) {
    hash.update((bytes.len() as u64).to_le_bytes());
    hash.update(bytes);
}

/// 不穿过父目录符号链接，也不递归清理目录，避免影响未确认的文件或外部仓库。
fn hash_working_file(repo: &Path, path: &str, hash: &mut Sha256) -> GitResult<()> {
    validate_relative_path(path)?;
    let relative = Path::new(path);
    let mut parent = repo.to_path_buf();
    for part in relative.parent().unwrap().components() {
        parent.push(part);
        match fs::symlink_metadata(&parent) {
            Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
                return Err(format!("无法撤销“{path}”：父目录不是普通目录。"));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(format!("无法读取文件：{error}")),
        }
    }
    let full = repo.join(path);
    hash_part(hash, path.as_bytes());
    let metadata = match fs::symlink_metadata(&full) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            hash_part(hash, b"missing");
            return Ok(());
        }
        Err(error) => return Err(format!("无法读取文件：{error}")),
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        hash_part(hash, &metadata.permissions().mode().to_le_bytes());
    }
    if metadata.file_type().is_symlink() {
        hash_part(hash, b"symlink");
        let target = fs::read_link(full).map_err(|error| format!("无法读取符号链接：{error}"))?;
        hash_part(hash, target.as_os_str().as_encoded_bytes());
    } else if metadata.is_file() {
        hash_part(hash, b"file");
        let mut file = fs::File::open(full).map_err(|error| format!("无法打开文件：{error}"))?;
        let mut content = Sha256::new();
        let mut buffer = [0; 65536];
        loop {
            let count = file
                .read(&mut buffer)
                .map_err(|error| format!("无法读取文件：{error}"))?;
            if count == 0 {
                break;
            }
            content.update(&buffer[..count]);
        }
        hash_part(hash, &content.finalize());
    } else {
        return Err(format!("无法撤销“{path}”：目录或子模块需单独处理。"));
    }
    Ok(())
}

/// 在索引锁内核对真实 Git 状态，并绑定分支、索引和所选工作文件的内容。
fn preview(
    repo: &Path,
    transaction: &IndexTransaction,
    paths: &[String],
) -> GitResult<DiscardPreview> {
    if operation(repo)?.is_some() {
        return Err("请先完成或中止当前 Git 操作，再撤销修改。".into());
    }
    let changes = selected_changes(repo, paths)?;
    let entries = transaction.run(repo, &["ls-files", "--stage", "-z"], &[])?;
    let mut modes = HashMap::new();
    for entry in entries
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
    {
        let (metadata, path) = entry.split_at(
            entry
                .iter()
                .position(|byte| *byte == b'\t')
                .ok_or("无法解析 Git 文件状态。")?,
        );
        modes.insert(&path[1..], &metadata[..6]);
    }
    let mut hash = Sha256::new();
    hash_part(&mut hash, repo.as_os_str().as_encoded_bytes());
    hash_part(&mut hash, &entries);
    hash_part(
        &mut hash,
        &run_git(repo, &["symbolic-ref", "--quiet", "HEAD"])?.stdout,
    );
    hash_part(
        &mut hash,
        &run_git(repo, &["rev-parse", "--verify", "HEAD"])?.stdout,
    );
    let mut files = Vec::new();
    for file in changes {
        if file.conflicted || !matches!(file.status_worktree.as_str(), "M" | "D" | "T" | "?") {
            return Err(format!(
                "无法撤销“{path}”：文件状态已变化或不支持，请刷新后重试。",
                path = file.path
            ));
        }
        let untracked = file.status_worktree == "?";
        if !untracked
            && !matches!(
                modes.get(file.path.as_bytes()).copied(),
                Some(b"100644" | b"100755" | b"120000")
            )
        {
            return Err(format!(
                "无法撤销“{path}”：目录或子模块需单独处理。",
                path = file.path
            ));
        }
        hash_part(&mut hash, file.status_index.as_bytes());
        hash_part(&mut hash, file.status_worktree.as_bytes());
        hash_working_file(repo, &file.path, &mut hash)?;
        files.push(DiscardFile {
            path: file.path,
            untracked,
        });
    }
    Ok(DiscardPreview {
        files,
        snapshot: format!("{:x}", hash.finalize()),
    })
}

/// 只恢复工作区，不发布临时索引；废纸篓失败时绝不退回永久删除。
fn discard_with_trash(
    repo: &Path,
    expected: DiscardPreview,
    include_untracked: bool,
    mut trash_file: impl FnMut(&Path) -> GitResult<()>,
) -> GitResult<usize> {
    let transaction = IndexTransaction::new(repo)?;
    let paths = expected
        .files
        .iter()
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    if preview(repo, &transaction, &paths)? != expected {
        return Err("文件或暂存状态已变化，请重新预览并确认撤销。".into());
    }
    let mut completed = 0;
    for file in expected
        .files
        .iter()
        .filter(|file| include_untracked || !file.untracked)
    {
        let result = if file.untracked {
            trash_file(&repo.join(&file.path))
        } else {
            transaction
                .run(
                    repo,
                    &["checkout-index", "--force", "-z", "--stdin"],
                    &nul_paths(&[&file.path]),
                )
                .map(|_| ())
        };
        if let Err(error) = result {
            return Err(format!(
                "已撤销 {completed} 个文件，处理“{path}”失败：{error}",
                path = file.path
            ));
        }
        completed += 1;
    }
    Ok(completed)
}

/// 预览单文件或当前分组的精确路径，确认期间不持有仓库锁。
#[tauri::command]
pub async fn git_discard_preview(
    repo_path: String,
    paths: Vec<String>,
) -> GitResult<DiscardPreview> {
    blocking(move || {
        with_repository(&repo_path, |repo| {
            let transaction = IndexTransaction::new(repo)?;
            preview(repo, &transaction, &paths)
        })
    })
    .await
}

/// macOS 使用系统文件 API，避免请求 Finder 自动化权限；失败不永久删除。
fn move_to_trash(path: &Path) -> GitResult<()> {
    let context = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    let context = {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut context = context;
        context.set_delete_method(DeleteMethod::NsFileManager);
        context
    };
    context
        .delete(path)
        .map_err(|error| format!("无法移到废纸篓：{error}"))
}

/// 执行用户确认的未暂存撤销；新文件进入系统废纸篓。
#[tauri::command]
pub async fn git_discard(
    repo_path: String,
    preview: DiscardPreview,
    include_untracked: bool,
) -> GitResult<usize> {
    blocking(move || {
        with_repository(&repo_path, |repo| {
            discard_with_trash(repo, preview, include_untracked, move_to_trash)
        })
    })
    .await
}

#[cfg(test)]
#[path = "discard_tests.rs"]
mod tests;
