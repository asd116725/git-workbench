use base64::{Engine, engine::general_purpose::STANDARD};
use portable_pty::{Child, CommandBuilder, ExitStatus, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex},
    thread,
    time::Duration,
};
use tauri::{State, ipc::Channel};

mod process;

/// 同一 Channel 依次发送原始字节和退出状态，避免分块截断 UTF-8 或控制序列。
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub(crate) enum TerminalEvent {
    Output { data: String },
    Exit { code: Option<u32> },
    Error { message: String },
}

#[derive(Default)]
struct Registry {
    sessions: HashMap<String, Arc<Session>>,
    mode: RegistryMode,
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum RegistryMode {
    #[default]
    Active,
    WindowClosed,
    Exiting,
}

impl Registry {
    /// 同一 ID 重新打开时，旧线程只能移除自己的会话。
    fn remove(&mut self, id: &str, session: &Arc<Session>) {
        if self
            .sessions
            .get(id)
            .is_some_and(|entry| Arc::ptr_eq(entry, session))
        {
            self.sessions.remove(id);
        }
    }
}

#[derive(Default)]
pub(crate) struct TerminalState {
    registry: Arc<Mutex<Registry>>,
}

#[derive(Default)]
struct OutputWindow {
    pending: usize,
    closed: bool,
}

struct Session {
    window: Mutex<OutputWindow>,
    consumed: Condvar,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
}

impl Session {
    fn write(&self, data: &str) -> Result<(), String> {
        self.writer
            .lock()
            .unwrap()
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())
    }

    /// 按 xterm 已消费的原始字节控制在途数据，后台标签也不能无限占用 IPC 队列。
    fn send_output(&self, channel: &Channel<TerminalEvent>, bytes: &[u8]) -> Result<bool, String> {
        let mut window = self
            .consumed
            .wait_while(self.window.lock().unwrap(), |window| {
                !window.closed && window.pending + bytes.len() > 256 * 1024
            })
            .unwrap();
        if window.closed {
            return Ok(false);
        }
        window.pending += bytes.len();
        drop(window);
        channel
            .send(TerminalEvent::Output {
                data: STANDARD.encode(bytes),
            })
            .map_err(|error| error.to_string())?;
        Ok(true)
    }

    /// 和输出线程串行回收，关闭后唤醒因背压暂停的读端。
    fn terminate(&self) -> io::Result<()> {
        let mut child = self.child.lock().unwrap();
        let fd = self.master.lock().unwrap().as_raw_fd().unwrap();
        process::terminate(child.as_mut(), fd)?;
        self.window.lock().unwrap().closed = true;
        self.consumed.notify_all();
        Ok(())
    }

    /// Shell 退出后清理仍占用会话的作业，排空退出前已经到达的输出。
    fn read_output(
        &self,
        mut reader: Box<dyn Read + Send>,
        channel: &Channel<TerminalEvent>,
    ) -> Result<Option<ExitStatus>, String> {
        // reader 是同一主端的副本，self 在整个读取期间持有原 FD。
        let fd = self.master.lock().unwrap().as_raw_fd().unwrap();
        let mut poll_fd = libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        };
        let mut buffer = [0; 8192];
        let mut exited = None;
        let mut remaining = usize::MAX;
        loop {
            if exited.is_none() {
                let mut child = self.child.lock().unwrap();
                if self.window.lock().unwrap().closed {
                    return Ok(None);
                }
                exited = process::reap_if_exited(child.as_mut()).map_err(|e| e.to_string())?;
                if exited.is_some() {
                    // Darwin 的 TIOCOUTQ（sys/ttycom.h）返回从端已写的输出量，FIONREAD 返回输入量。
                    const TIOCOUTQ: libc::c_ulong = 0x40047473;
                    let mut available: libc::c_int = 0;
                    if unsafe { libc::ioctl(fd, TIOCOUTQ, &mut available) } < 0 {
                        return Err(io::Error::last_os_error().to_string());
                    }
                    remaining = available as usize;
                }
            }
            if remaining == 0 {
                return Ok(exited);
            }
            let timeout_ms = if exited.is_some() { 0 } else { 500 };
            let result = unsafe { libc::poll(&mut poll_fd, 1, timeout_ms) };
            if result < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(error.to_string());
            }
            if result == 0 {
                if exited.is_some() {
                    return Ok(exited);
                }
                continue;
            }
            let limit = buffer.len().min(remaining);
            match reader.read(&mut buffer[..limit]) {
                Ok(0) if exited.is_some() => return Ok(exited),
                Ok(0) => thread::sleep(Duration::from_millis(20)),
                Ok(len) => {
                    if !self.send_output(channel, &buffer[..len])? {
                        return Ok(None);
                    }
                    remaining -= len;
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error.to_string()),
            }
        }
    }
}

impl TerminalState {
    fn ack(&self, id: &str, bytes: usize) {
        if let Ok(session) = self.session(id) {
            let mut window = session.window.lock().unwrap();
            window.pending = window.pending.saturating_sub(bytes);
            session.consumed.notify_one();
        }
    }

    fn start(
        &self,
        id: &str,
        cwd: &Path,
        size: PtySize,
        mut command: CommandBuilder,
        channel: Channel<TerminalEvent>,
    ) -> Result<(), String> {
        if !cwd.is_absolute() || !cwd.is_dir() {
            return Err("终端工作目录必须是已存在的绝对目录".into());
        }
        let mut registry = self.registry.lock().unwrap();
        match registry.mode {
            RegistryMode::Active => {}
            RegistryMode::WindowClosed => return Err("主窗口已关闭".into()),
            RegistryMode::Exiting => return Err("应用正在退出".into()),
        }
        if registry.sessions.contains_key(id) {
            return Err("终端会话已存在".into());
        }

        let pair = native_pty_system()
            .openpty(size)
            .map_err(|e| format!("创建终端失败：{e}"))?;
        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        prepare_login(&mut command, cwd);
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| format!("启动登录 Shell 失败：{e}"))?;
        let session = Arc::new(Session {
            window: Mutex::default(),
            consumed: Condvar::new(),
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
        });

        let worker = session.clone();
        let sessions = self.registry.clone();
        let key = id.to_owned();
        let spawned = thread::Builder::new()
            .name("terminal-output".into())
            .spawn(move || {
                // 保留从端到尾部排空，避免内核在最后一个从端关闭时丢弃排队输出。
                let slave = pair.slave;
                let result = worker.read_output(reader, &channel);
                drop(slave);
                let code = match result {
                    Ok(status) => status
                        .filter(|s| s.signal().is_none())
                        .map(|s| s.exit_code()),
                    Err(message) => {
                        let _ = worker.terminate();
                        let _ = channel.send(TerminalEvent::Error { message });
                        None
                    }
                };
                sessions.lock().unwrap().remove(&key, &worker);
                let _ = channel.send(TerminalEvent::Exit { code });
            });
        if let Err(error) = spawned {
            drop(registry);
            let _ = session.terminate();
            return Err(format!("启动终端读取线程失败：{error}"));
        }
        registry.sessions.insert(id.to_owned(), session);
        Ok(())
    }

    fn session(&self, id: &str) -> Result<Arc<Session>, String> {
        self.registry
            .lock()
            .unwrap()
            .sessions
            .get(id)
            .cloned()
            .ok_or_else(|| "终端会话已结束".into())
    }

    fn resize(&self, id: &str, size: PtySize) -> Result<(), String> {
        self.session(id)?
            .master
            .lock()
            .unwrap()
            .resize(size)
            .map_err(|e| e.to_string())
    }

    fn close(&self, id: &str) -> Result<(), String> {
        if let Ok(session) = self.session(id) {
            session
                .terminate()
                .map_err(|e| format!("关闭终端失败：{e}"))?;
            self.registry.lock().unwrap().remove(id, &session);
        }
        Ok(())
    }

    /// WebView 换页后上一文档已丢失会话句柄，回收旧会话并允许新页面启动 Shell。
    pub(crate) fn reset_sessions(&self) {
        self.clear(None);
    }

    /// 隐藏主窗口时终止作业，并阻止尚在队列中的启动请求创建新会话。
    pub(crate) fn close_window(&self) {
        self.clear(Some(RegistryMode::WindowClosed));
    }

    /// Dock 恢复窗口后可以从原来的标签启动新会话。
    pub(crate) fn reopen_window(&self) {
        let mut registry = self.registry.lock().unwrap();
        if registry.mode == RegistryMode::WindowClosed {
            registry.mode = RegistryMode::Active;
        }
    }

    /// 真正退出时阻止已排队的启动请求在清理后再创建 Shell。
    pub(crate) fn shutdown(&self) {
        self.clear(Some(RegistryMode::Exiting));
    }

    fn clear(&self, mode: Option<RegistryMode>) {
        let sessions = {
            let mut registry = self.registry.lock().unwrap();
            if let Some(mode) = mode
                && registry.mode != RegistryMode::Exiting
            {
                registry.mode = mode;
            }
            registry.sessions.clone()
        };
        for (id, session) in sessions {
            match session.terminate() {
                Ok(()) => self.registry.lock().unwrap().remove(&id, &session),
                Err(error) => eprintln!("清理终端会话失败：{error}"),
            }
        }
    }
}

/// portable-pty 会把启动时消失的目录换成 HOME。将路径作为独立参数传给 cd，
/// 成功后用登录 Shell 约定的 argv[0] 原地替换进程，并由真实 TTY 启用交互模式。
fn prepare_login(command: &mut CommandBuilder, cwd: &Path) {
    let shell = command.get_shell();
    let shell = if Path::new(&shell).is_absolute() {
        &shell
    } else {
        "/bin/zsh"
    };
    command.cwd("/");
    command.env("TERM", "xterm-256color");
    command.args([
        "--noprofile",
        "--norc",
        "-p",
        "-c",
        r#"builtin cd -P -- "$1" && exec -a "-${2##*/}" "$2""#,
        "git-workbench",
    ]);
    command.arg(cwd);
    command.arg(shell);
}

fn terminal_size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if cols == 0 || rows == 0 {
        return Err("终端行列数必须大于零".into());
    }
    Ok(PtySize {
        cols,
        rows,
        ..PtySize::default()
    })
}

/// 在主线程注册会话，与 WebView 开始换页的清理事件保持顺序。
#[tauri::command]
pub(crate) fn terminal_start(
    state: State<'_, TerminalState>,
    id: String,
    cwd: PathBuf,
    cols: u16,
    rows: u16,
    channel: Channel<TerminalEvent>,
) -> Result<(), String> {
    state.start(
        &id,
        &cwd,
        terminal_size(cols, rows)?,
        CommandBuilder::new("/bin/bash"),
        channel,
    )
}

/// 写入原始 UTF-8 输入；大段粘贴可能阻塞在 PTY 上，交给阻塞任务池处理。
#[tauri::command]
pub(crate) async fn terminal_write(
    state: State<'_, TerminalState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let session = state.session(&id)?;
    tauri::async_runtime::spawn_blocking(move || session.write(&data))
        .await
        .map_err(|e| e.to_string())?
}

/// 确认 xterm 已消费的原始字节数；忽略窗口关闭后迟到的确认。
#[tauri::command]
pub(crate) fn terminal_ack(state: State<'_, TerminalState>, id: String, bytes: u32) {
    state.ack(&id, bytes as usize);
}

/// 将可见行列数同步到内核，使交互程序能收到 SIGWINCH。
#[tauri::command]
pub(crate) fn terminal_resize(
    state: State<'_, TerminalState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.resize(&id, terminal_size(cols, rows)?)
}

/// 主动关闭指定会话，自然退出和重复关闭均视为成功。
#[tauri::command(async)]
pub(crate) fn terminal_close(state: State<'_, TerminalState>, id: String) -> Result<(), String> {
    state.close(&id)
}

#[cfg(test)]
mod tests;
