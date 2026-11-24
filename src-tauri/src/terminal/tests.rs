use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::Value;
use std::{
    fs,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use tauri::ipc::InvokeResponseBody;

fn open(state: &TerminalState, id: &str, cwd: &Path) -> Result<mpsc::Receiver<Value>, String> {
    open_with_delay(state, id, cwd, Duration::ZERO)
}

fn open_with_delay(
    state: &TerminalState,
    id: &str,
    cwd: &Path,
    delay: Duration,
) -> Result<mpsc::Receiver<Value>, String> {
    let (sender, receiver) = mpsc::channel();
    let channel = Channel::new(move |message| {
        let InvokeResponseBody::Json(json) = message else {
            panic!("事件应为 JSON")
        };
        thread::sleep(delay);
        sender.send(serde_json::from_str(&json).unwrap()).unwrap();
        Ok(())
    });
    // 真实登录 zsh 使用测试目录中的配置，避免读写开发者的历史记录。
    let mut command = CommandBuilder::new("/bin/bash");
    command.env("SHELL", "/bin/zsh");
    command.env("ZDOTDIR", cwd);
    state.start(id, cwd, PtySize::default(), command, channel)?;
    Ok(receiver)
}

fn collect_exit(events: &mpsc::Receiver<Value>) -> (Vec<u8>, Option<u64>) {
    let mut output = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let event = events
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap();
        match event["type"].as_str() {
            Some("exit") => return (output, event["code"].as_u64()),
            Some("output") => {
                output.extend(STANDARD.decode(event["data"].as_str().unwrap()).unwrap())
            }
            _ => panic!("意外事件 {event}"),
        }
    }
}

#[test]
fn parallel_shells_keep_their_directory_environment_size_and_last_bytes() {
    let root = tempfile::tempdir().unwrap();
    let state = TerminalState::default();
    let a = root.path().canonicalize().unwrap().join("目录 ' $() ;");
    let b = root.path().canonicalize().unwrap().join("worktree");
    for dir in [&a, &b] {
        fs::create_dir(dir).unwrap();
    }
    let first = open(&state, "a", &a).unwrap();
    let second = open(&state, "b", &b).unwrap();
    assert!(open(&state, "a", &b).is_err());

    state
        .resize(
            "a",
            PtySize {
                cols: 117,
                rows: 38,
                ..PtySize::default()
            },
        )
        .unwrap();
    state.session("a").unwrap().write("export GW_TEST=独立; print -r -- \"$PWD|$TERM|$options[login]|$options[interactive]|$GW_TEST\"; stty size; printf '\\377\\376'; exit 7\r").unwrap();
    state
        .session("b")
        .unwrap()
        .write("print -r -- \"$PWD|$+GW_TEST\"; stty size; exit 3\r")
        .unwrap();
    let (a_out, a_code) = collect_exit(&first);
    let (b_out, b_code) = collect_exit(&second);
    let a_text = String::from_utf8_lossy(&a_out);
    let b_text = String::from_utf8_lossy(&b_out);
    assert!(
        a_text.contains(&format!("{}|xterm-256color|on|on|独立", a.display())),
        "{a_text}"
    );
    assert!(a_text.contains("38 117\r\n"), "{a_text}");
    assert!(a_out.windows(2).any(|bytes| bytes == [255, 254]));
    assert_eq!(a_code, Some(7));
    assert!(b_text.contains(&format!("{}|0", b.display())), "{b_text}");
    assert!(b_text.contains("24 80\r\n"), "{b_text}");
    assert_eq!(b_code, Some(3));
    state.close("a").unwrap();
}

fn wait_for<T>(mut condition: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        if let Some(value) = condition() {
            return value;
        }
        assert!(Instant::now() < deadline, "等待终端进程超时");
        thread::sleep(Duration::from_millis(10));
    }
}

fn foreground(state: &TerminalState, id: &str, cwd: &Path) -> i32 {
    // 子进程在已取得控制终端后记下 PID，避免 Ctrl+C 抢先打断提示符。
    state
        .session(id)
        .unwrap()
        .write("/bin/sh -c 'echo $$ > job; exec /bin/sleep 20'\r")
        .unwrap();
    wait_for(|| {
        fs::read_to_string(cwd.join("job"))
            .ok()?
            .trim()
            .parse()
            .ok()
    })
}

#[test]
fn interrupt_stops_the_foreground_job_and_preserves_the_shell() {
    let root = tempfile::tempdir().unwrap();
    let state = TerminalState::default();
    let events = open(&state, "a", root.path()).unwrap();
    let pid = foreground(&state, "a", root.path());
    state.session("a").unwrap().write("\x03").unwrap();
    wait_for(|| (unsafe { libc::kill(pid, 0) } == -1).then_some(()));
    state.session("a").unwrap().write("exit 23\r").unwrap();
    assert_eq!(collect_exit(&events).1, Some(23));
}

#[test]
fn closing_a_tab_window_or_app_reaps_shell_and_foreground_job() {
    for mode in [
        RegistryMode::Active,
        RegistryMode::WindowClosed,
        RegistryMode::Exiting,
    ] {
        let root = tempfile::tempdir().unwrap();
        let state = TerminalState::default();
        let events = open(&state, "tab", root.path()).unwrap();
        state
            .session("tab")
            .unwrap()
            .write("echo $$ > shell\r")
            .unwrap();
        let job = foreground(&state, "tab", root.path());
        let shell: i32 = fs::read_to_string(root.path().join("shell"))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        match mode {
            RegistryMode::Active => state.close("tab").unwrap(),
            RegistryMode::WindowClosed => state.close_window(),
            RegistryMode::Exiting => state.shutdown(),
        }
        for pid in [shell, job] {
            wait_for(|| (unsafe { libc::kill(pid, 0) } == -1).then_some(()));
        }
        let _ = collect_exit(&events);
        state.close("tab").unwrap();
        assert!(
            state
                .session("tab")
                .and_then(|session| session.write("pwd\r"))
                .is_err()
        );
        if mode != RegistryMode::Active {
            assert!(open(&state, "late", root.path()).is_err());
            state.reopen_window();
            if mode == RegistryMode::WindowClosed {
                let reopened = open(&state, "tab", root.path()).unwrap();
                state.session("tab").unwrap().write("exit 0\r").unwrap();
                assert_eq!(collect_exit(&reopened).1, Some(0));
            } else {
                assert!(open(&state, "late", root.path()).is_err());
            }
        }
    }
}

#[test]
fn shutdown_stops_disowned_jobs_in_the_terminal_session() {
    let root = tempfile::tempdir().unwrap();
    let state = TerminalState::default();
    let events = open(&state, "tab", root.path()).unwrap();
    state.session("tab").unwrap().write(
        "/bin/sh -c 'trap \"\" HUP TERM; echo $$ > background; exec /bin/sleep 30' </dev/null >/dev/null 2>&1 & disown\r",
    ).unwrap();
    let pid: libc::pid_t = wait_for(|| {
        fs::read_to_string(root.path().join("background"))
            .ok()?
            .trim()
            .parse()
            .ok()
    });
    let session_id = unsafe { libc::getsid(pid) };
    assert!(session_id > 0 && session_id != unsafe { libc::getsid(0) });
    state.shutdown();
    let _ = collect_exit(&events);
    let deadline = Instant::now() + Duration::from_secs(2);
    while unsafe { libc::getsid(pid) } == session_id {
        if Instant::now() >= deadline {
            // 红灯阶段也只回收本测试创建的后台进程。
            unsafe { libc::kill(pid, libc::SIGKILL) };
            panic!("后台任务在关闭后仍属于原终端会话");
        }
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn invalid_directory_is_rejected_without_reserving_the_id() {
    let root = tempfile::tempdir().unwrap();
    let state = TerminalState::default();
    for bad in [Path::new("."), &root.path().join("missing")] {
        assert!(open(&state, "tab", bad).is_err());
    }
    let events = open(&state, "tab", root.path()).unwrap();
    state.session("tab").unwrap().write("exit 0\r").unwrap();
    assert_eq!(collect_exit(&events).1, Some(0));
}

#[test]
fn slow_consumer_receives_the_entire_final_write_before_exit() {
    let dir = tempfile::tempdir().unwrap();
    let state = TerminalState::default();
    let events = open_with_delay(&state, "slow", dir.path(), Duration::from_millis(30)).unwrap();
    state
        .session("slow")
        .unwrap()
        .write("exec /usr/bin/head -c 32768 /dev/zero\r")
        .unwrap();
    let (out, code) = collect_exit(&events);
    assert_eq!(out.iter().filter(|byte| **byte == 0).count(), 32768);
    assert_eq!(code, Some(0));
}

fn receive_window(events: &mpsc::Receiver<Value>) -> usize {
    let mut event = events.recv_timeout(Duration::from_secs(5)).unwrap();
    let mut pending = 0;
    loop {
        assert_eq!(event["type"], "output");
        pending += STANDARD
            .decode(event["data"].as_str().unwrap())
            .unwrap()
            .len();
        assert!(pending <= 256 * 1024, "未确认输出超过窗口：{pending}");
        match events.recv_timeout(Duration::from_millis(180)) {
            Ok(next) => event = next,
            Err(mpsc::RecvTimeoutError::Timeout) if pending >= 256 * 1024 - 8192 => return pending,
            other => event = other.unwrap(),
        }
    }
}

#[test]
fn consumed_bytes_resume_a_backpressured_producer() {
    let root = tempfile::tempdir().unwrap();
    let state = TerminalState::default();
    let events = open(&state, "flow", root.path()).unwrap();
    state
        .session("flow")
        .unwrap()
        .write("/usr/bin/head -c 524288 /dev/zero; exit 13\r")
        .unwrap();
    let pending = receive_window(&events);
    state.ack("flow", pending);
    let mut zeros = 0;
    loop {
        let event = events.recv_timeout(Duration::from_secs(3)).unwrap();
        match event["type"].as_str() {
            Some("output") => {
                let bytes = STANDARD.decode(event["data"].as_str().unwrap()).unwrap();
                zeros += bytes.iter().filter(|byte| **byte == 0).count();
                state.ack("flow", bytes.len());
            }
            Some("exit") => {
                assert_eq!(event["code"], 13);
                break;
            }
            _ => panic!("意外事件 {event}"),
        }
    }
    assert!(zeros >= 524288 - pending);
}

#[test]
fn close_wakes_the_reader_when_no_more_bytes_are_acknowledged() {
    let root = tempfile::tempdir().unwrap();
    let state = TerminalState::default();
    let events = open(&state, "flow", root.path()).unwrap();
    state
        .session("flow")
        .unwrap()
        .write("/usr/bin/head -c 4194304 /dev/zero\r")
        .unwrap();
    receive_window(&events);
    state.close("flow").unwrap();
    let _ = collect_exit(&events);
    state.ack("flow", 8192);
}

#[test]
fn a_directory_removed_between_validation_and_exec_cannot_open_the_shell_elsewhere() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("vanishing");
    fs::create_dir(&target).unwrap();
    let mut command = CommandBuilder::new("/bin/bash");
    command.env("SHELL", "/bin/zsh");
    command.env("ZDOTDIR", root.path());
    prepare_login(&mut command, &target);
    fs::remove_dir(target).unwrap();
    let pair = native_pty_system().openpty(PtySize::default()).unwrap();
    let mut reader = pair.master.try_clone_reader().unwrap();
    let mut child = pair.slave.spawn_command(command).unwrap();
    drop(pair.slave);
    let _ = pair.master.take_writer().unwrap().write_all(b"exit 0\r");
    let mut output = Vec::new();
    reader.read_to_end(&mut output).unwrap();
    assert!(!child.wait().unwrap().success());
    assert!(String::from_utf8_lossy(&output).contains("vanishing"));
}
