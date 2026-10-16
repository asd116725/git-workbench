// 发布版本在 Windows 上隐藏控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    git_workbench_lib::run()
}
