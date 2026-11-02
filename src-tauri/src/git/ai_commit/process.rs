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
    TooLarge,
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

/// 管道正文始终留在内存；输出、运行时间与子进程组都受限，禁止记录原始失败内容。
pub(super) fn read(
    mut command: Command,
    limit: usize,
    timeout: Duration,
    control: &WorkControl,
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
    let result = read_output(&mut child, stdout, limit, timeout, control);
    // 不等待管道 EOF：脱离进程组的后台程序可能仍持有 stdout，关闭本端即可结束读取。
    #[cfg(unix)]
    let _ = Command::new("/bin/kill")
        .args(["-KILL", "--", &format!("-{}", child.id())])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
    let _ = child.wait();
    result
}

#[cfg(unix)]
fn read_output(
    child: &mut Child,
    mut stdout: ChildStdout,
    limit: usize,
    timeout: Duration,
    control: &WorkControl,
) -> Result<(ExitStatus, Vec<u8>), ProcessError> {
    use std::{io, os::fd::AsRawFd};
    let fd = stdout.as_raw_fd();
    // fd 由仍存活的 ChildStdout 持有；只修改文件状态标志，不转移描述符所有权。
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags == -1 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } == -1 {
        return Err(ProcessError::Failed);
    }
    let started = Instant::now();
    let mut bytes = Vec::new();
    let mut finished = None;
    loop {
        check(control)?;
        if started.elapsed() >= timeout {
            return Err(ProcessError::Timeout);
        }
        let mut buffer = [0; 8192];
        loop {
            check(control)?;
            match stdout.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    if bytes.len() + count > limit {
                        return Err(ProcessError::TooLarge);
                    }
                    bytes.extend_from_slice(&buffer[..count]);
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => return Err(ProcessError::Failed),
            }
        }
        // 观察到退出后再排空一次已到达的字节；不被后台进程是否关闭管道所阻塞。
        if let Some(status) = finished {
            return Ok((status, bytes));
        }
        finished = child.try_wait().map_err(|_| ProcessError::Failed)?;
        if finished.is_none() {
            thread::sleep(Duration::from_millis(10));
        }
    }
}

#[cfg(not(unix))]
fn read_output(
    child: &mut Child,
    stdout: ChildStdout,
    limit: usize,
    timeout: Duration,
    control: &WorkControl,
) -> Result<(ExitStatus, Vec<u8>), ProcessError> {
    let (sender, receiver) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.take(limit as u64 + 1).read_to_end(&mut bytes);
        let output = if bytes.len() > limit {
            Err(ProcessError::TooLarge)
        } else {
            result.map(|_| bytes).map_err(|_| ProcessError::Failed)
        };
        let _ = sender.send(output);
    });
    let started = Instant::now();
    let mut output = None;
    loop {
        check(control)?;
        if started.elapsed() >= timeout {
            return Err(ProcessError::Timeout);
        }
        if let Ok(value) = receiver.try_recv() {
            output = Some(value?);
        }
        if let Some(status) = child.try_wait().map_err(|_| ProcessError::Failed)? {
            if let Some(bytes) = output {
                return Ok((status, bytes));
            }
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
    fn process_cancellation_stops_an_active_child_and_output_is_bounded() {
        let directory = tempfile::tempdir().unwrap();
        let ready = directory.path().join("ready");
        let (sender, receiver) = tokio::sync::watch::channel(false);
        let control = WorkControl {
            cancellation: Some(receiver),
            deadline: Instant::now() + Duration::from_secs(5),
        };
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", "printf ready > \"$1\"; exec /bin/sleep 30", "fixture"])
            .arg(&ready);
        let worker = thread::spawn(move || read(command, 1024, Duration::from_secs(10), &control));
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

        let mut command = Command::new("/usr/bin/yes");
        command.arg("fictional-output");
        assert!(matches!(
            read(
                command,
                1024,
                Duration::from_secs(2),
                &WorkControl::standalone(Duration::from_secs(2))
            ),
            Err(ProcessError::TooLarge)
        ));
    }
}
