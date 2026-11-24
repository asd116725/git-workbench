use portable_pty::{Child, ExitStatus};
use std::{
    io,
    os::fd::RawFd,
    ptr, thread,
    time::{Duration, Instant},
};

/// portable-pty 调用 setsid 后，Shell 的 PID 就是该终端的会话 ID。
fn session_id(child: &dyn Child) -> libc::pid_t {
    child.process_id().expect("本地 PTY 子进程应有 PID") as libc::pid_t
}

fn signal(pid: libc::pid_t, signal: libc::c_int) -> io::Result<()> {
    if unsafe { libc::kill(pid, signal) } == 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }
    Err(error)
}

/// 按会话 ID 清理各作业组，包括已 disown、关闭标准输入输出或被重挂父进程的任务。
fn signal_jobs(session: libc::pid_t, sig: libc::c_int) -> io::Result<()> {
    let count = unsafe { libc::proc_listallpids(ptr::null_mut(), 0) };
    if count <= 0 {
        return Err(io::Error::last_os_error());
    }
    let mut processes = vec![0 as libc::pid_t; count as usize + 64];
    loop {
        let count = unsafe {
            libc::proc_listallpids(
                processes.as_mut_ptr().cast(),
                std::mem::size_of_val(processes.as_slice()) as libc::c_int,
            )
        };
        if count <= 0 {
            return Err(io::Error::last_os_error());
        }
        if (count as usize) < processes.len() {
            processes.truncate(count as usize);
            break;
        }
        processes.resize(processes.len() * 2, 0);
    }
    let mut result = Ok(());
    for pid in processes {
        if pid > 0 && pid != session && unsafe { libc::getsid(pid) } == session {
            let stopped = signal(pid, sig);
            result = result.and(stopped);
        }
    }
    result
}

/// 先观察退出，保留待回收的 Shell PID 作为会话标识，清理作业后再回收。
fn exit_pending(pid: libc::pid_t) -> io::Result<bool> {
    let mut event: libc::siginfo_t = unsafe { std::mem::zeroed() };
    loop {
        let result = unsafe {
            libc::waitid(
                libc::P_PID,
                pid as libc::id_t,
                &mut event,
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        };
        if result == 0 {
            return Ok(unsafe { event.si_pid() } == pid);
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

fn reap(child: &mut dyn Child, pid: libc::pid_t) -> io::Result<ExitStatus> {
    let jobs = signal_jobs(pid, libc::SIGKILL);
    let status = child.wait()?;
    jobs.map(|()| status)
}

pub(super) fn reap_if_exited(child: &mut dyn Child) -> io::Result<Option<ExitStatus>> {
    let pid = session_id(child);
    if exit_pending(pid)? {
        return reap(child, pid).map(Some);
    }
    Ok(None)
}

fn wait_for_exit(pid: libc::pid_t, fd: RawFd, timeout: Duration) -> io::Result<bool> {
    let deadline = Instant::now() + timeout;
    while !exit_pending(pid)? {
        if Instant::now() >= deadline {
            return Ok(false);
        }
        // Darwin 可能等待终端排空才报告退出，主动关闭时可以丢弃这些输出。
        unsafe { libc::tcflush(fd, libc::TCOFLUSH) };
        thread::sleep(Duration::from_millis(10));
    }
    Ok(true)
}

/// 优先给作业和 Shell 正常结束的机会，收到退出事件前回收 Shell 和剩余作业。
pub(super) fn terminate(child: &mut dyn Child, fd: RawFd) -> io::Result<()> {
    let pid = session_id(child);
    match exit_pending(pid) {
        Ok(true) => return reap(child, pid).map(|_| ()),
        Ok(false) => {}
        Err(error) if error.raw_os_error() == Some(libc::ECHILD) => return Ok(()),
        Err(error) => return Err(error),
    }
    let _ = signal_jobs(pid, libc::SIGTERM);
    signal(pid, libc::SIGHUP)?;
    if !wait_for_exit(pid, fd, Duration::from_millis(150))? {
        signal(pid, libc::SIGKILL)?;
        if !wait_for_exit(pid, fd, Duration::from_millis(400))? {
            signal_jobs(pid, libc::SIGKILL)?;
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "等待终端进程退出超时",
            ));
        }
    }
    reap(child, pid).map(|_| ())
}
