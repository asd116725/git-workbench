mod folder;
mod git;
#[cfg(target_os = "macos")]
mod terminal;

#[cfg(target_os = "macos")]
use tauri::{Manager, RunEvent, WindowEvent, webview::PageLoadEvent};

/// 启动桌面窗口，并通过固定命令向前端开放本地 Git 操作。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(git::GitWatchState::default())
        .manage(git::ai_commit::AiCommitState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            folder::open_folder,
            git::git_open,
            git::git_status,
            git::git_remove_worktree,
            git::git_diff,
            git::git_stage,
            git::git_unstage,
            git::discard::git_discard_preview,
            git::discard::git_discard,
            git::git_commit,
            git::git_branches,
            git::git_checkout,
            git::remote::git_fetch,
            git::remote::git_pull,
            git::remote::git_push,
            git::branch_management::git_create_branch,
            git::branch_management::git_delete_branch_preview,
            git::branch_management::git_delete_branch,
            git::merge::git_merge_preview,
            git::merge::git_merge,
            git::merge::git_merge_continue,
            git::merge::git_merge_abort,
            git::history::git_history_ref,
            git::history::git_history,
            git::history::git_commit_detail,
            git::history::git_commit_diff,
            git::watch::git_watch,
            git::ai_commit::ai_commit_check_key,
            git::ai_commit::ai_commit_generate,
            git::ai_commit::ai_commit_validate,
            git::ai_commit::ai_commit_cancel,
            #[cfg(target_os = "macos")]
            terminal::terminal_start,
            #[cfg(target_os = "macos")]
            terminal::terminal_write,
            #[cfg(target_os = "macos")]
            terminal::terminal_ack,
            #[cfg(target_os = "macos")]
            terminal::terminal_resize,
            #[cfg(target_os = "macos")]
            terminal::terminal_close,
        ]);

    #[cfg(target_os = "macos")]
    let builder = builder
        .manage(terminal::TerminalState::default())
        .on_page_load(|webview, payload| {
            // 新文档没有旧会话 ID，导航或整页重载时结束失去控制端的 Shell。
            if webview.label() == "main" && payload.event() == PageLoadEvent::Started {
                webview.state::<terminal::TerminalState>().reset_sessions();
            }
        })
        .on_window_event(|window, event| {
            // 隐藏主窗口以保留仓库和草稿，同时终止内置终端作业。
            if window.label() == "main"
                && let WindowEvent::CloseRequested { api, .. } = event
            {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    eprintln!("隐藏主窗口失败：{error}");
                } else {
                    window.state::<terminal::TerminalState>().close_window();
                }
            }
        });

    builder
        .build(tauri::generate_context!())
        .expect("桌面应用启动失败")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let RunEvent::Exit = _event {
                _app.state::<terminal::TerminalState>().shutdown();
            }
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = _event
                && let Some(window) = _app.get_webview_window("main")
            {
                // Dock 再次打开时复用现有窗口，同时恢复最小化状态并聚焦。
                _app.state::<terminal::TerminalState>().reopen_window();
                let _ = window.unminimize();
                if let Err(error) = window.show().and_then(|_| window.set_focus()) {
                    eprintln!("显示主窗口失败：{error}");
                }
            }
        });
}
