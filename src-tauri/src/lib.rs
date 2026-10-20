mod git;

#[cfg(target_os = "macos")]
use tauri::{Manager, RunEvent, WindowEvent};

/// 启动桌面窗口，并通过固定命令向前端开放本地 Git 操作。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
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
        ]);

    #[cfg(target_os = "macos")]
    let builder = builder.on_window_event(|window, event| {
        // 关闭主窗口只隐藏，保留 WebView、仓库上下文和未提交草稿；显式退出仍由系统处理。
        if window.label() == "main"
            && let WindowEvent::CloseRequested { api, .. } = event
        {
            api.prevent_close();
            if let Err(error) = window.hide() {
                eprintln!("隐藏主窗口失败：{error}");
            }
        }
    });

    builder
        .build(tauri::generate_context!())
        .expect("桌面应用启动失败")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = _event
                && let Some(window) = _app.get_webview_window("main")
            {
                // Dock 再次打开时复用现有窗口，同时恢复最小化状态并聚焦。
                let _ = window.unminimize();
                if let Err(error) = window.show().and_then(|_| window.set_focus()) {
                    eprintln!("显示主窗口失败：{error}");
                }
            }
        });
}
