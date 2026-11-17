use super::{FileContent, GitDiff, GitResult, blob_content, git, utf8, working_content};
use serde::Serialize;
use std::{fs, io::ErrorKind, path::Path};

/// text 与 notice 都为空表示该侧不存在；空文件则保留空字符串。
#[derive(Debug, Default, Serialize)]
pub struct ConflictVersion {
    text: Option<String>,
    notice: Option<String>,
}

impl ConflictVersion {
    fn from_content(content: FileContent) -> Self {
        match content {
            Ok(content) => Self {
                notice: (content.text.is_none() && content.image.is_some())
                    .then(|| "图片文件无法显示文本冲突。".to_owned()),
                text: content.text,
            },
            Err(message) => Self {
                text: None,
                // 冲突尚未解决，不沿用普通 Diff 中“可直接暂存和提交”的提示。
                notice: Some(message.replace("，可直接暂存和提交。", "。")),
            },
        }
    }
}

/// ours/theirs 取自未合并索引的 2/3 阶段；工作区独立读取，保留正在编辑的结果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictPreview {
    ours: ConflictVersion,
    theirs: ConflictVersion,
    working: ConflictVersion,
    marker_size: usize,
}

pub(super) fn diff(repo: &Path, path: &str) -> GitResult<GitDiff> {
    let entries = utf8(git(repo, &["ls-files", "--unmerged", "-z", "--", path])?)?;
    let mut ours = ConflictVersion::default();
    let mut theirs = ConflictVersion::default();
    for entry in entries.split('\0').filter(|entry| !entry.is_empty()) {
        let header = entry.split_once('\t').ok_or("无法读取冲突索引。")?.0;
        let mut fields = header.split_whitespace();
        let mode = fields.next().ok_or("无法读取冲突索引。")?;
        let oid = fields.next().ok_or("无法读取冲突索引。")?;
        let target = match fields.next() {
            Some("2") => &mut ours,
            Some("3") => &mut theirs,
            _ => continue,
        };
        *target = if mode == "160000" {
            ConflictVersion {
                text: None,
                notice: Some("子模块冲突需在外部工具中查看。".into()),
            }
        } else {
            ConflictVersion::from_content(blob_content(repo, oid, None)?)
        };
    }
    let working = match fs::symlink_metadata(repo.join(path)) {
        Ok(_) => ConflictVersion::from_content(working_content(repo, path)?),
        Err(error) if error.kind() == ErrorKind::NotFound => ConflictVersion::default(),
        Err(error) => return Err(format!("无法读取文件：{error}")),
    };
    let attributes = utf8(git(
        repo,
        &["check-attr", "-z", "conflict-marker-size", "--", path],
    )?)?;
    let marker_size = attributes
        .split('\0')
        .nth(2)
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|size| *size > 0 && *size <= super::MAX_DIFF_BYTES as usize)
        .unwrap_or(7);
    let mut result = GitDiff::from_contents(None, None);
    result.conflict_preview = Some(ConflictPreview {
        ours,
        theirs,
        working,
        marker_size,
    });
    Ok(result)
}
