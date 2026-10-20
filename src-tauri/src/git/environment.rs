use std::{
    ffi::OsString,
    io::{self, Read, Seek, SeekFrom},
    os::unix::{ffi::OsStringExt, process::CommandExt},
    path::PathBuf,
    process::{Command, Stdio},
    sync::OnceLock,
    thread,
    time::{Duration, Instant},
};

static LOGIN_PATH: OnceLock<Option<OsString>> = OnceLock::new();
const PATH_SCRIPT: &str = "printf '\\0GIT_WORKBENCH_PATH\\0'; /usr/bin/printenv PATH; printf '\\0'";

/// Finder/Dock 不加载用户 Shell 配置；仅为 Git 子进程补充 PATH，且每次启动只解析一次。
pub(super) fn apply_path(command: &mut Command) {
    if let Some(path) = LOGIN_PATH.get_or_init(|| {
        let shell = std::env::var_os("SHELL")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .unwrap_or_else(|| "/bin/zsh".into());
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| "/".into());
        let mut shell_command = Command::new(shell);
        // 在主目录读取登录和交互配置，不执行仓库目录中的初始化配置。
        shell_command
            .current_dir(home)
            .args(["-i", "-l", "-c", PATH_SCRIPT]);
        match read_path(shell_command, Duration::from_secs(10)) {
            Ok(path) => Some(path),
            Err(error) => {
                eprintln!("读取登录 Shell PATH 失败，继续使用应用原有环境：{error}");
                None
            }
        }
    }) {
        command.env("PATH", path);
    }
}

/// 限时读取 PATH；临时文件避免 Shell 的后台子进程持有管道而阻塞退出。
fn read_path(mut command: Command, timeout: Duration) -> io::Result<OsString> {
    let mut stdout = tempfile::tempfile()?;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(stdout.try_clone()?)
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()?;
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => {
                thread::sleep(Duration::from_millis(20));
            }
            result => {
                // 终止本次解析的进程组，避免超时的配置脚本继续在后台运行。
                let _ = Command::new("/bin/kill")
                    .args(["-KILL", "--", &format!("-{}", child.id())])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
                let _ = child.kill();
                let _ = child.wait();
                return Err(result.err().unwrap_or_else(|| {
                    io::Error::new(io::ErrorKind::TimedOut, "登录 Shell 初始化超时")
                }));
            }
        }
    };
    if !status.success() {
        return Err(io::Error::other(format!("登录 Shell 异常退出：{status}")));
    }

    stdout.seek(SeekFrom::Start(0))?;
    let mut output = Vec::new();
    stdout.take(1024 * 1024).read_to_end(&mut output)?;
    // 用 NUL 分隔标记排除启动提示，保留 PATH 中的空格和非 UTF-8 字节。
    let mut fields = output.split(|byte| *byte == 0);
    let path = fields
        .position(|field| field == b"GIT_WORKBENCH_PATH")
        .and_then(|_| fields.next())
        .and_then(|field| field.strip_suffix(b"\n"))
        .filter(|path| !path.is_empty())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "未读取到有效的 PATH"))?;
    Ok(OsString::from_vec(path.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_failure_does_not_accept_partial_path_output() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", &format!("{PATH_SCRIPT}; exit 1")]);
        assert!(read_path(command, Duration::from_secs(2)).is_err());
    }

    #[test]
    fn missing_or_empty_shell_path_is_rejected() {
        for script in ["printf 'startup output'", PATH_SCRIPT] {
            let mut command = Command::new("/bin/sh");
            command.args(["-c", script]).env("PATH", "");
            assert_eq!(
                read_path(command, Duration::from_secs(2))
                    .unwrap_err()
                    .kind(),
                io::ErrorKind::InvalidData
            );
        }
    }

    #[test]
    fn stalled_shell_returns_before_initialization_finishes() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "exec /bin/sleep 30"]);
        let started = Instant::now();
        assert_eq!(
            read_path(command, Duration::from_millis(100))
                .unwrap_err()
                .kind(),
            io::ErrorKind::TimedOut
        );
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
