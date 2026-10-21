use super::*;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    sync::{
        atomic::AtomicBool,
        mpsc::{self, Receiver, TrySendError},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State};

const EVENT_NAME: &str = "git:repository-changed";
const BATCH_WINDOW: Duration = Duration::from_millis(100);

/// 事件只通知仓库已变脏，刷新时机由前端统一调度；错误也必须显示给用户。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryChanged {
    repo_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// 只保留当前工作区的监听，切换或停止时同步释放原生监听与处理线程。
#[derive(Default)]
pub struct GitWatchState(Arc<Mutex<Option<RepositoryWatch>>>);

struct RepositoryWatch {
    watcher: Option<RecommendedWatcher>,
    stopped: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

struct WatchPaths {
    root: PathBuf,
    git_dir: PathBuf,
    common_dir: PathBuf,
}

impl WatchPaths {
    fn new(root: PathBuf) -> GitResult<Self> {
        let git_dir = git_line(&root, &["rev-parse", "--absolute-git-dir"])?;
        Ok(Self {
            git_dir: fs::canonicalize(git_dir)
                .map_err(|error| format!("无法定位 Git 元数据目录：{error}"))?,
            common_dir: common_directory(&root)?,
            root,
        })
    }

    /// 元数据独立判断，避免 linked worktree 的公共引用被当成工作区忽略路径。
    fn is_metadata(&self, path: &Path) -> Option<bool> {
        for directory in [&self.git_dir, &self.common_dir] {
            if let Ok(relative) = path.strip_prefix(directory) {
                if relative.starts_with("modules") {
                    // 子模块名可包含目录，嵌套子模块还会再出现 modules，不能按固定层数截断。
                    for parent in path
                        .ancestors()
                        .skip(1)
                        .take_while(|parent| *parent != directory)
                    {
                        let is_git_dir = (parent.join("HEAD").is_file()
                            || parent.join("config").is_file())
                            && (parent.join("objects").is_dir()
                                || parent.join("commondir").is_file());
                        if is_git_dir {
                            return Some(important_metadata(path.strip_prefix(parent).unwrap()));
                        }
                    }
                }
                return Some(important_metadata(relative));
            }
        }
        None
    }

    fn changed(&self, paths: HashSet<PathBuf>) -> GitResult<bool> {
        let mut worktree_paths = Vec::new();
        for path in paths {
            if path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with(".watchman-cookie-"))
            {
                continue;
            }
            match self.is_metadata(&path) {
                Some(true) => return Ok(true),
                Some(false) => continue,
                None => {}
            }
            if let Ok(relative) = path.strip_prefix(&self.root) {
                if relative.as_os_str().is_empty() || relative == Path::new(".git") {
                    return Ok(true);
                }
                worktree_paths.push(
                    relative
                        .to_str()
                        .ok_or("文件监听发现非 UTF-8 路径，当前版本暂不支持。")?
                        .to_owned(),
                );
            }
        }
        if worktree_paths.is_empty() {
            return Ok(false);
        }
        let ignored = ignored_paths(&self.root, &worktree_paths)?;
        if worktree_paths.iter().any(|path| !ignored.contains(path)) {
            return Ok(true);
        }
        // --no-index 可处理子模块内部路径；再检查索引，不能漏掉强制跟踪的忽略文件。
        let mut args = vec!["ls-files", "--cached", "-z", "--"];
        args.extend(worktree_paths.iter().map(String::as_str));
        Ok(!git(&self.root, &args)?.is_empty())
    }
}

fn important_metadata(path: &Path) -> bool {
    if path.components().any(|part| {
        let name = part.as_os_str().to_string_lossy();
        name.ends_with(".lock") || name.starts_with(".watchman-cookie-")
    }) {
        return false;
    }
    let Some(first) = path.components().next() else {
        return false;
    };
    if first.as_os_str() == "worktrees" {
        let child: PathBuf = path.components().skip(2).collect();
        return child.as_os_str().is_empty()
            || matches!(child.to_str(), Some("gitdir" | "commondir" | "locked"))
            || important_metadata(&child);
    }
    matches!(
        first.as_os_str().to_str(),
        Some(
            "HEAD"
                | "index"
                | "refs"
                | "packed-refs"
                | "config"
                | "config.worktree"
                | "shallow"
                | "MERGE_HEAD"
                | "MERGE_MSG"
                | "CHERRY_PICK_HEAD"
                | "REVERT_HEAD"
                | "REBASE_HEAD"
                | "rebase-merge"
                | "rebase-apply"
                | "sequencer"
        )
    ) || path == Path::new("info/exclude")
}

/// 使用 Git 自身的忽略规则，兼容仓库、全局和嵌套 .gitignore，路径用 NUL 分隔。
fn ignored_paths(repo: &Path, paths: &[String]) -> GitResult<HashSet<String>> {
    let input = paths.join("\0") + "\0";
    let mut child = command(repo)
        .args([
            "--no-literal-pathspecs",
            "check-ignore",
            "--no-index",
            "--stdin",
            "-z",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法检查文件忽略规则：{error}"))?;
    let mut stdin = child.stdin.take().ok_or("无法写入 Git 输入。")?;
    // 大批路径可能同时填满输入与输出管道，独立写入避免互相等待。
    let writer = thread::spawn(move || stdin.write_all(input.as_bytes()));
    let output = child.wait_with_output();
    let written = writer.join().map_err(|_| "文件忽略检查已中断。")?;
    let output = output.map_err(|error| format!("无法读取文件忽略规则：{error}"))?;
    let output = if output.status.code() == Some(1) {
        output.stdout
    } else {
        checked(output)?
    };
    written.map_err(|error| format!("无法写入文件忽略检查：{error}"))?;
    Ok(utf8(output)?
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .collect())
}

impl RepositoryWatch {
    fn start(root: PathBuf, emit: impl Fn(RepositoryChanged) + Send + 'static) -> GitResult<Self> {
        let paths = WatchPaths::new(root)?;
        let stopped = Arc::new(AtomicBool::new(false));
        let overflowed = Arc::new(AtomicBool::new(false));
        let (sender, receiver) = mpsc::sync_channel(1024);
        let callback_overflow = Arc::clone(&overflowed);
        let mut watcher = notify::recommended_watcher(move |event| {
            if let Err(TrySendError::Full(_)) = sender.try_send(event) {
                callback_overflow.store(true, Ordering::Release);
            }
        })
        .map_err(|error| format!("无法启动仓库文件监听：{error}"))?;
        watcher
            .watch(&paths.root, RecursiveMode::Recursive)
            .map_err(|error| format!("无法监听工作区：{error}"))?;
        if !paths.common_dir.starts_with(&paths.root) {
            watcher
                .watch(&paths.common_dir, RecursiveMode::Recursive)
                .map_err(|error| format!("无法监听 Git 公共目录：{error}"))?;
        }
        if !paths.git_dir.starts_with(&paths.root) && !paths.git_dir.starts_with(&paths.common_dir)
        {
            watcher
                .watch(&paths.git_dir, RecursiveMode::Recursive)
                .map_err(|error| format!("无法监听 Git 工作区元数据：{error}"))?;
        }
        let worker_stopped = Arc::clone(&stopped);
        let worker = thread::Builder::new()
            .name("git-file-events".into())
            .spawn(move || process_events(paths, receiver, worker_stopped, overflowed, emit))
            .map_err(|error| format!("无法启动文件监听任务：{error}"))?;
        Ok(Self {
            watcher: Some(watcher),
            stopped,
            worker: Some(worker),
        })
    }
}

impl Drop for RepositoryWatch {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        self.watcher.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

/// 小批合并只减少忽略规则查询；1 秒防抖、焦点与 5 秒冷却均由前端负责。
fn process_events(
    paths: WatchPaths,
    receiver: Receiver<notify::Result<Event>>,
    stopped: Arc<AtomicBool>,
    overflowed: Arc<AtomicBool>,
    emit: impl Fn(RepositoryChanged),
) {
    while !stopped.load(Ordering::Acquire) {
        let Ok(first) = receiver.recv() else { break };
        let deadline = Instant::now() + BATCH_WINDOW;
        let mut events = vec![first];
        while events.len() < 1024 && Instant::now() < deadline {
            match receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                Ok(event) => events.push(event),
                Err(_) => break,
            }
        }
        let mut changed_paths = HashSet::new();
        let mut error = overflowed
            .swap(false, Ordering::AcqRel)
            .then(|| "文件变化过多，部分监听事件已丢失，正在重新读取仓库状态。".to_owned());
        for event in events {
            match event {
                Ok(event) if event.need_rescan() => {
                    error = Some("系统文件监听要求重新扫描，正在重新读取仓库状态。".into());
                }
                Ok(event) if !event.kind.is_access() => changed_paths.extend(event.paths),
                Ok(_) => {}
                Err(reason) => error = Some(format!("仓库文件监听异常：{reason}")),
            }
        }
        let changed = match paths.changed(changed_paths) {
            Ok(changed) => changed,
            Err(reason) => {
                error = Some(reason);
                true
            }
        };
        if (changed || error.is_some()) && !stopped.load(Ordering::Acquire) {
            emit(RepositoryChanged {
                repo_path: paths.root.to_string_lossy().into_owned(),
                error,
            });
        }
    }
}

/// 切换当前工作区监听；传入 null 则停止，正常事件和异常均通过同一事件通道返回。
#[tauri::command]
pub async fn git_watch(
    repo_path: Option<String>,
    app: AppHandle,
    state: State<'_, GitWatchState>,
) -> GitResult<()> {
    let state = Arc::clone(&state.0);
    blocking(move || {
        let mut current = state
            .lock()
            .map_err(|_| "文件监听状态不可用，请重启应用。")?;
        *current = None;
        if let Some(path) = repo_path {
            *current = Some(RepositoryWatch::start(
                repository_root(&path)?,
                move |event| {
                    if let Err(error) = app.emit(EVENT_NAME, event) {
                        eprintln!("无法发送仓库变化通知：{error}");
                    }
                },
            )?);
        }
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::{EventKind, event::Flag};
    use std::sync::mpsc::RecvTimeoutError;

    struct Fixture {
        directory: tempfile::TempDir,
        root: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let directory = tempfile::tempdir().unwrap();
            let root = fs::canonicalize(directory.path())
                .unwrap()
                .join("repository");
            fs::create_dir(&root).unwrap();
            git(&root, &["init", "-b", "main"]).unwrap();
            git(&root, &["config", "user.name", "Watcher Test"]).unwrap();
            git(&root, &["config", "user.email", "watcher@example.invalid"]).unwrap();
            fs::write(root.join("tracked.txt"), "initial\n").unwrap();
            fs::write(root.join(".gitignore"), "node_modules/\nignored.txt\n").unwrap();
            git(&root, &["add", "."]).unwrap();
            git(
                &root,
                &[
                    "-c",
                    "commit.gpgSign=false",
                    "-c",
                    "core.hooksPath=/dev/null",
                    "commit",
                    "-m",
                    "initial",
                ],
            )
            .unwrap();
            Self { directory, root }
        }

        fn paths(&self) -> WatchPaths {
            WatchPaths::new(self.root.clone()).unwrap()
        }
    }

    fn watch(root: &Path) -> (RepositoryWatch, Receiver<RepositoryChanged>) {
        let (sender, receiver) = mpsc::channel();
        let watcher = RepositoryWatch::start(root.into(), move |event| {
            sender.send(event).unwrap();
        })
        .unwrap();
        (watcher, receiver)
    }

    fn expect_change(receiver: &Receiver<RepositoryChanged>, root: &Path) {
        let event = receiver.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(Path::new(&event.repo_path), root);
        assert_eq!(event.error, None);
        while receiver.recv_timeout(Duration::from_millis(150)).is_ok() {}
    }

    #[test]
    fn filters_ignored_files_but_keeps_force_tracked_files_and_directories() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.root.join("node_modules")).unwrap();
        let ignored = fixture.root.join("node_modules/package.js");
        fs::write(&ignored, "ignored").unwrap();
        let paths = fixture.paths();
        assert!(!paths.changed(HashSet::from([ignored.clone()])).unwrap());
        git(
            &fixture.root,
            &["add", "--force", "node_modules/package.js"],
        )
        .unwrap();
        assert!(paths.changed(HashSet::from([ignored.clone()])).unwrap());
        assert!(
            paths
                .changed(HashSet::from([fixture.root.join("node_modules")]))
                .unwrap()
        );
        fs::remove_file(&ignored).unwrap();
        assert!(paths.changed(HashSet::from([ignored])).unwrap());
        assert!(
            paths
                .changed(HashSet::from([fixture.root.join("new file\n中文.txt")]))
                .unwrap()
        );
    }

    #[test]
    fn ignores_locks_objects_logs_and_watchman_noise() {
        let fixture = Fixture::new();
        let paths = fixture.paths();
        for relative in [
            ".git/index.lock",
            ".git/refs/heads/main.lock",
            ".git/objects/ab/cd",
            ".git/logs/HEAD",
            ".git/worktrees/other/logs/HEAD",
            ".git/git-workbench-index-1/index",
            ".watchman-cookie-123",
        ] {
            assert!(
                !paths
                    .changed(HashSet::from([fixture.root.join(relative)]))
                    .unwrap(),
                "{relative}"
            );
        }
        for relative in [
            ".git/index",
            ".git/HEAD",
            ".git/refs/heads/topic",
            ".git/packed-refs",
            ".git/config",
            ".git/info/exclude",
            ".git/worktrees/other/HEAD",
        ] {
            assert!(
                paths
                    .changed(HashSet::from([fixture.root.join(relative)]))
                    .unwrap(),
                "{relative}"
            );
        }
    }

    #[test]
    fn native_events_cover_create_rename_delete_stage_unstage_and_stop() {
        let fixture = Fixture::new();
        let (watcher, receiver) = watch(&fixture.root);
        fs::write(fixture.root.join("created.txt"), "new\n").unwrap();
        expect_change(&receiver, &fixture.root);
        git(&fixture.root, &["add", "created.txt"]).unwrap();
        expect_change(&receiver, &fixture.root);
        git(&fixture.root, &["reset", "HEAD", "--", "created.txt"]).unwrap();
        expect_change(&receiver, &fixture.root);
        fs::rename(
            fixture.root.join("created.txt"),
            fixture.root.join("renamed.txt"),
        )
        .unwrap();
        expect_change(&receiver, &fixture.root);
        fs::remove_file(fixture.root.join("renamed.txt")).unwrap();
        expect_change(&receiver, &fixture.root);
        drop(watcher);
        fs::write(fixture.root.join("after-stop.txt"), "no listener").unwrap();
        assert!(matches!(
            receiver.recv_timeout(Duration::from_millis(150)),
            Err(RecvTimeoutError::Disconnected)
        ));
    }

    #[test]
    fn linked_worktree_watches_actual_index_and_common_refs() {
        let fixture = Fixture::new();
        let linked = fixture.directory.path().join("linked");
        git(
            &fixture.root,
            &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
        )
        .unwrap();
        let linked = fs::canonicalize(linked).unwrap();
        let (watcher, receiver) = watch(&linked);
        fs::write(linked.join("tracked.txt"), "linked modification\n").unwrap();
        expect_change(&receiver, &linked);
        git(&linked, &["add", "tracked.txt"]).unwrap();
        expect_change(&receiver, &linked);
        git(&fixture.root, &["branch", "another-branch"]).unwrap();
        expect_change(&receiver, &linked);
        drop(watcher);
        let (watcher, receiver) = watch(&fixture.root);
        fs::write(fixture.root.join("tracked.txt"), "main modification\n").unwrap();
        expect_change(&receiver, &fixture.root);
        drop(watcher);
    }

    #[test]
    fn absorbed_submodule_commit_and_nested_metadata_trigger_refresh() {
        let fixture = Fixture::new();
        let source = Fixture::new();
        let submodule_name = "group/tools";
        git(
            &fixture.root,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                source.root.to_str().unwrap(),
                submodule_name,
            ],
        )
        .unwrap();
        git(
            &fixture.root,
            &[
                "-c",
                "commit.gpgSign=false",
                "-c",
                "core.hooksPath=/dev/null",
                "commit",
                "-m",
                "add submodule",
            ],
        )
        .unwrap();
        let submodule = fixture.root.join(submodule_name);
        let module_dir =
            PathBuf::from(git_line(&submodule, &["rev-parse", "--absolute-git-dir"]).unwrap());
        assert!(module_dir.starts_with(fixture.root.join(".git/modules")));
        assert!(submodule.join(".git").is_file());
        let nested_dir = module_dir.join("modules/nested/team/tools");
        fs::create_dir_all(nested_dir.join("objects")).unwrap();
        fs::write(nested_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::write(
            nested_dir.join("config"),
            "[core]\nrepositoryformatversion = 0\n",
        )
        .unwrap();
        let paths = fixture.paths();
        for directory in [&module_dir, &nested_dir] {
            for relative in ["HEAD", "index", "refs/heads/topic", "packed-refs", "config"] {
                assert_eq!(
                    paths.is_metadata(&directory.join(relative)),
                    Some(true),
                    "{relative}"
                );
            }
            for relative in [
                "HEAD.lock",
                "index.lock",
                "refs/heads/main.lock",
                "objects/aa/HEAD",
                "logs/HEAD",
            ] {
                assert_eq!(
                    paths.is_metadata(&directory.join(relative)),
                    Some(false),
                    "{relative}"
                );
            }
        }
        let (watcher, receiver) = watch(&fixture.root);
        git(
            &submodule,
            &[
                "-c",
                "user.name=Watcher Test",
                "-c",
                "user.email=watcher@example.invalid",
                "-c",
                "commit.gpgSign=false",
                "-c",
                "core.hooksPath=/dev/null",
                "commit",
                "--allow-empty",
                "-m",
                "move submodule HEAD only",
            ],
        )
        .unwrap();
        expect_change(&receiver, &fixture.root);
        let files = changes(&fixture.root).unwrap();
        assert!(
            files
                .iter()
                .any(|file| file.path == submodule_name && file.status_worktree == "M")
        );
        drop(watcher);
    }

    #[test]
    fn ignored_events_and_status_reads_do_not_trigger_refresh_loops() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.root.join("node_modules")).unwrap();
        let (watcher, receiver) = watch(&fixture.root);
        fs::write(fixture.root.join("node_modules/noise.js"), "ignored").unwrap();
        fs::write(fixture.root.join(".git/index.lock"), "lock").unwrap();
        fs::remove_file(fixture.root.join(".git/index.lock")).unwrap();
        assert!(matches!(
            receiver.recv_timeout(Duration::from_millis(500)),
            Err(RecvTimeoutError::Timeout)
        ));
        let before = fs::read(fixture.root.join(".git/index")).unwrap();
        for _ in 0..3 {
            status(&fixture.root).unwrap();
        }
        assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), before);
        assert!(matches!(
            receiver.recv_timeout(Duration::from_millis(500)),
            Err(RecvTimeoutError::Timeout)
        ));
        drop(watcher);
    }

    #[test]
    fn watch_errors_rescan_and_queue_overflow_are_reported() {
        let fixture = Fixture::new();
        for (event, overflow) in [
            (Err(notify::Error::generic("test watcher failure")), false),
            (
                Ok(Event::new(EventKind::Other).set_flag(Flag::Rescan)),
                false,
            ),
            (Ok(Event::new(EventKind::Any)), true),
        ] {
            let (sender, receiver) = mpsc::channel();
            sender.send(event).unwrap();
            drop(sender);
            let messages = Mutex::new(Vec::new());
            process_events(
                fixture.paths(),
                receiver,
                Arc::new(AtomicBool::new(false)),
                Arc::new(AtomicBool::new(overflow)),
                |message| messages.lock().unwrap().push(message),
            );
            let messages = messages.into_inner().unwrap();
            assert_eq!(messages.len(), 1);
            assert!(messages[0].error.is_some());
        }
    }
}
