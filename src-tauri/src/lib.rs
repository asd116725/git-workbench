mod git;

/// 启动桌面窗口，并通过固定命令向前端开放本地 Git 操作。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            git::git_open,
            git::git_status,
            git::git_diff,
            git::git_stage,
            git::git_unstage,
            git::git_commit,
            git::git_branches,
            git::git_checkout,
        ])
        .run(tauri::generate_context!())
        .expect("桌面应用启动失败");
}
