use std::path::Path;
use std::process::Command;

/// 仅打开实际存在的目录，避免把 URL 或文件交给系统默认应用执行。
fn open_directory(path: &Path) -> Result<(), String> {
    let directory = path
        .canonicalize()
        .map_err(|error| format!("无法访问文件夹：{error}"))?;
    if !directory.is_dir() {
        return Err("指定路径不是文件夹。".to_owned());
    }

    #[cfg(target_os = "macos")]
    let mut command = Command::new("/usr/bin/open");
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer.exe");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = Command::new("xdg-open");

    command.arg(&directory);
    // Explorer 复用已有窗口时退出码可能为 1，因此 Windows 只核对进程能否启动。
    #[cfg(target_os = "windows")]
    {
        command
            .spawn()
            .map_err(|error| format!("打开文件夹失败：{error}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = command
            .output()
            .map_err(|error| format!("打开文件夹失败：{error}"))?;
        if !output.status.success() {
            return Err(format!(
                "打开文件夹失败：{}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(())
    }
}

/// 系统文件管理器在阻塞线程启动，避免影响桌面窗口响应。
#[tauri::command]
pub async fn open_folder(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || open_directory(Path::new(&path)))
        .await
        .map_err(|error| format!("打开文件夹失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::open_directory;

    #[test]
    fn rejects_files_before_starting_system_application() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("带空格 file.txt");
        std::fs::write(&file, "content").unwrap();
        assert_eq!(open_directory(&file).unwrap_err(), "指定路径不是文件夹。");
    }

    #[test]
    fn rejects_missing_directories() {
        let directory = tempfile::tempdir().unwrap();
        let missing = directory.path().join("missing");
        assert!(
            open_directory(&missing)
                .unwrap_err()
                .starts_with("无法访问文件夹：")
        );
    }
}
