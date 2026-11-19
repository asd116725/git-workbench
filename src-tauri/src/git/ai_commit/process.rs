use super::WorkControl;
use std::{
    io::Read,
    process::{Child, ChildStdout, Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

#[derive(Debug)]
pub(super) enum ProcessError {
    Failed,
    Timeout,
    TooLarge(Option<u64>),
    Cancelled,
}

fn check(control: &WorkControl) -> Result<(), ProcessError> {
    control.check().map_err(|error| {
        if error.code == "cancelled" {
            ProcessError::Cancelled
        } else {
            ProcessError::Timeout
        }
    })
}

/// 读取凭证时只需判断是否越界，超限立即停止。
#[cfg(any(target_os = "macos", test))]
pub(super) fn read(
    command: Command,
    limit: usize,
    timeout: Duration,
    control: &WorkControl,
) -> Result<(ExitStatus, Vec<u8>), ProcessError> {
    read_command(command, limit, timeout, control, false)
}

/// Git 输出超限后只计数，完整读到 EOF 且进程成功才报告实际字节数。
pub(super) fn read_counted(
    command: Command,
    limit: usize,
    timeout: Duration,
    control: &WorkControl,
) -> Result<(ExitStatus, Vec<u8>), ProcessError> {
    read_command(command, limit, timeout, control, true)
}

#[derive(Default)]
struct Output {
    bytes: Vec<u8>,
    actual_bytes: u64,
}

impl Output {
    fn append(&mut self, chunk: &[u8], limit: usize, count_full: bool) -> Result<(), ProcessError> {
        self.actual_bytes += chunk.len() as u64;
        if self.actual_bytes <= limit as u64 {
            self.bytes.extend_from_slice(chunk);
        } else if count_full {
            self.bytes = Vec::new();
        } else {
            return Err(ProcessError::TooLarge(None));
        }
        Ok(())
    }
}

/// 管道正文只保留在受限内存中，同时限制进程的运行时间并清理子进程。
fn read_command(
    mut command: Command,
    limit: usize,
    timeout: Duration,
    control: &WorkControl,
    count_full: bool,
) -> Result<(ExitStatus, Vec<u8>), ProcessError> {
    check(control)?;
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| ProcessError::Failed)?;
    let stdout = child.stdout.take().expect("stdout 已配置为管道");
    let result = read_output(&mut child, stdout, limit, timeout, control, count_full);
    #[cfg(unix)]
    let _ = Command::new("/bin/kill")
        .args(["-KILL", "--", &format!("-{}", child.id())])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
    let _ = child.wait();
    let (status, output) = result?;
    if output.actual_bytes > limit as u64 {
        return if status.success() {
            Err(ProcessError::TooLarge(Some(output.actual_bytes)))
        } else {
            Err(ProcessError::Failed)
        };
    }
    Ok((status, output.bytes))
}

#[cfg(unix)]
fn read_output(
    child: &mut Child,
    mut stdout: ChildStdout,
    limit: usize,
    timeout: Duration,
    control: &WorkControl,
    count_full: bool,
) -> Result<(ExitStatus, Output), ProcessError> {
    use std::{io, os::fd::AsRawFd};
    let fd = stdout.as_raw_fd();
    // fd 由仍存活的 ChildStdout 持有；只修改文件状态标志，不转移描述符所有权。
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags == -1 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } == -1 {
        return Err(ProcessError::Failed);
    }
    let started = Instant::now();
    let mut output = Output::default();
    let mut finished = None;
    let mut eof = false;
    let mut buffer = [0; 8192];
    loop {
        loop {
            check(control)?;
            if started.elapsed() >= timeout {
                return Err(ProcessError::Timeout);
            }
            match stdout.read(&mut buffer) {
                Ok(0) => {
                    eof = true;
                    break;
                }
                Ok(count) => output.append(&buffer[..count], limit, count_full)?,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => return Err(ProcessError::Failed),
            }
        }
        // 凭证模式只排空已到达的字节，避免等待后台进程关闭继承的管道。
        if let Some(status) = finished {
            if eof || !count_full {
                return Ok((status, output));
            }
        } else {
            finished = child.try_wait().map_err(|_| ProcessError::Failed)?;
            if finished.is_some() {
                continue;
            }
        }
        thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(not(unix))]
fn read_output(
    child: &mut Child,
    mut stdout: ChildStdout,
    limit: usize,
    timeout: Duration,
    control: &WorkControl,
    count_full: bool,
) -> Result<(ExitStatus, Output), ProcessError> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let started = Instant::now();
    let reader_control = control.clone();
    thread::spawn(move || {
        let result = (|| {
            let mut output = Output::default();
            let mut buffer = [0; 8192];
            loop {
                check(&reader_control)?;
                if started.elapsed() >= timeout {
                    return Err(ProcessError::Timeout);
                }
                let count = match stdout.read(&mut buffer) {
                    Ok(0) => return Ok(output),
                    Ok(count) => count,
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => return Err(ProcessError::Failed),
                };
                output.append(&buffer[..count], limit, count_full)?;
            }
        })();
        let _ = sender.send(result);
    });
    let mut output = None;
    loop {
        check(control)?;
        if started.elapsed() >= timeout {
            return Err(ProcessError::Timeout);
        }
        if let Ok(value) = receiver.try_recv() {
            output = Some(value?);
        }
        if let Some(status) = child.try_wait().map_err(|_| ProcessError::Failed)?
            && let Some(output) = output
        {
            return Ok((status, output));
        }
        thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn detached_stdout_holder_does_not_defeat_deadline() {
        let mut command = Command::new("/usr/bin/python3");
        // 子进程脱离进程组并继承 stdout；即使父进程仍在等待，读取也必须按时结束。
        command.args(["-c", "import os,time\npid=os.fork()\nif pid == 0:\n os.setsid()\n time.sleep(2)\n os._exit(0)\ntime.sleep(30)"]);
        let started = Instant::now();
        let error = read(
            command,
            1024,
            Duration::from_millis(150),
            &WorkControl::standalone(Duration::from_secs(2)),
        )
        .unwrap_err();
        assert!(matches!(error, ProcessError::Timeout));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn counted_output_can_be_cancelled_after_exceeding_the_limit() {
        let directory = tempfile::tempdir().unwrap();
        let ready = directory.path().join("ready");
        let (sender, receiver) = tokio::sync::watch::channel(false);
        let control = WorkControl {
            cancellation: Some(receiver),
            deadline: Instant::now() + Duration::from_secs(5),
        };
        let mut command = Command::new("/bin/sh");
        command
            .args([
                "-c",
                "/usr/bin/head -c 1048576 /dev/zero && printf ready > \"$1\" && exec /bin/sleep 30",
                "fixture",
            ])
            .arg(&ready);
        let worker =
            thread::spawn(move || read_counted(command, 1024, Duration::from_secs(10), &control));
        let started = Instant::now();
        while !ready.exists() {
            assert!(started.elapsed() < Duration::from_secs(2));
            thread::sleep(Duration::from_millis(5));
        }
        sender.send(true).unwrap();
        assert!(matches!(
            worker.join().unwrap(),
            Err(ProcessError::Cancelled)
        ));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn fast_read_stops_at_the_first_overflow() {
        let mut command = Command::new("/usr/bin/yes");
        command.arg("fictional-output");
        assert!(matches!(
            read(
                command,
                1024,
                Duration::from_secs(2),
                &WorkControl::standalone(Duration::from_secs(2))
            ),
            Err(ProcessError::TooLarge(None))
        ));
    }

    #[test]
    fn counted_output_accepts_the_boundary_and_reports_exact_overflow() {
        let collect = |script, limit| {
            let mut command = Command::new("/bin/sh");
            command.args(["-c", script]);
            read_counted(
                command,
                limit,
                Duration::from_secs(2),
                &WorkControl::standalone(Duration::from_secs(2)),
            )
        };
        assert_eq!(collect("printf '123456789'", 9).unwrap().1, b"123456789");
        assert!(matches!(
            collect("printf '123456789'", 8),
            Err(ProcessError::TooLarge(Some(9)))
        ));
        assert!(matches!(
            collect("printf '123456789'; exit 1", 8),
            Err(ProcessError::Failed)
        ));
    }

    #[test]
    fn counted_output_keeps_both_deadlines_for_continuous_output() {
        let short = Duration::from_millis(80);
        let long = Duration::from_secs(2);
        for (timeout, deadline) in [(short, long), (long, short)] {
            let mut command = Command::new("/usr/bin/yes");
            command.arg("fictional-output");
            let started = Instant::now();
            assert!(matches!(
                read_counted(command, 1024, timeout, &WorkControl::standalone(deadline)),
                Err(ProcessError::Timeout)
            ));
            assert!(started.elapsed() < Duration::from_secs(1));
        }
    }
}
