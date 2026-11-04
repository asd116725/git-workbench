use super::*;
use tempfile::TempDir;

struct Fixture {
    directory: TempDir,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        git(&root, &["init", "-b", "main"]).unwrap();
        git(&root, &["config", "user.name", "Discard Test"]).unwrap();
        git(&root, &["config", "user.email", "discard@example.invalid"]).unwrap();
        git(&root, &["config", "commit.gpgSign", "false"]).unwrap();
        git(&root, &["config", "core.hooksPath", "/dev/null"]).unwrap();
        Self { directory, root }
    }
    fn write(&self, name: &str, content: impl AsRef<[u8]>) {
        let path = self.root.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }
    fn commit(&self) {
        git(&self.root, &["add", "-A"]).unwrap();
        git(&self.root, &["commit", "-m", "base"]).unwrap();
    }
    fn preview(&self, paths: &[&str]) -> GitResult<DiscardPreview> {
        let transaction = IndexTransaction::new(&self.root)?;
        preview(
            &self.root,
            &transaction,
            &paths.iter().map(|path| (*path).into()).collect::<Vec<_>>(),
        )
    }
    fn discard(&self, expected: DiscardPreview, include: bool) -> GitResult<usize> {
        discard_with_trash(&self.root, expected, include, |_| {
            panic!("不应移动新增文件")
        })
    }
}

#[test]
fn preserves_staged_content_and_index_bytes_for_modified_deleted_and_binary_files() {
    let fixture = Fixture::new();
    fixture.write("partial.txt", "HEAD");
    fixture.write("deleted.txt", "restore");
    fixture.write("binary.bin", [0, 1, 2]);
    fixture.commit();
    fixture.write("partial.txt", "STAGED");
    git(&fixture.root, &["add", "partial.txt"]).unwrap();
    fixture.write("partial.txt", "WORKING");
    fixture.write("binary.bin", [0, 8, 9]);
    fs::remove_file(fixture.root.join("deleted.txt")).unwrap();
    fixture.write("unselected.txt", "keep");
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    let expected = fixture
        .preview(&["partial.txt", "deleted.txt", "binary.bin"])
        .unwrap();
    assert_eq!(fixture.discard(expected, true).unwrap(), 3);
    assert_eq!(
        fs::read(fixture.root.join("partial.txt")).unwrap(),
        b"STAGED"
    );
    assert_eq!(
        fs::read(fixture.root.join("deleted.txt")).unwrap(),
        b"restore"
    );
    assert_eq!(
        fs::read(fixture.root.join("binary.bin")).unwrap(),
        [0, 1, 2]
    );
    assert_eq!(
        fs::read(fixture.root.join("unselected.txt")).unwrap(),
        b"keep"
    );
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
}

#[test]
fn untracked_selection_is_explicit_and_staged_deletion_stays_staged() {
    let fixture = Fixture::new();
    fixture.write("recreated.txt", "old");
    fixture.commit();
    git(&fixture.root, &["rm", "--cached", "recreated.txt"]).unwrap();
    fixture.write("新\n文件.txt", "new");
    let paths = ["recreated.txt", "新\n文件.txt"];
    let expected = fixture.preview(&paths).unwrap();
    assert!(expected.files.iter().all(|file| file.untracked));
    assert_eq!(fixture.discard(expected, false).unwrap(), 0);
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    let bin = tempfile::tempdir().unwrap();
    let mut moved = 0;
    let count = discard_with_trash(
        &fixture.root,
        fixture.preview(&paths).unwrap(),
        true,
        |path| {
            moved += 1;
            fs::rename(path, bin.path().join(moved.to_string())).unwrap();
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(count, 2);
    assert_eq!(fs::read(bin.path().join("1")).unwrap(), b"old");
    assert_eq!(fs::read(bin.path().join("2")).unwrap(), b"new");
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
}

#[test]
fn rejects_changes_since_confirmation_and_an_existing_index_lock() {
    let fixture = Fixture::new();
    fixture.write("file.txt", "base");
    fixture.commit();
    fixture.write("file.txt", "first");
    let expected = fixture.preview(&["file.txt"]).unwrap();
    fixture.write("file.txt", "later");
    assert!(
        fixture
            .discard(expected, true)
            .unwrap_err()
            .contains("重新预览")
    );
    assert_eq!(fs::read(fixture.root.join("file.txt")).unwrap(), b"later");
    let expected = fixture.preview(&["file.txt"]).unwrap();
    git(&fixture.root, &["add", "file.txt"]).unwrap();
    fixture.write("file.txt", "another");
    assert!(
        fixture
            .discard(expected, true)
            .unwrap_err()
            .contains("重新预览")
    );
    let expected = fixture.preview(&["file.txt"]).unwrap();
    fs::write(fixture.root.join(".git/index.lock"), "external").unwrap();
    assert!(
        fixture
            .discard(expected, true)
            .unwrap_err()
            .contains("无法锁定")
    );
    assert_eq!(
        fs::read(fixture.root.join(".git/index.lock")).unwrap(),
        b"external"
    );
}

#[test]
fn handles_literal_paths_and_staged_renames_without_reverting_the_index() {
    let fixture = Fixture::new();
    fixture.write("old.txt", "staged rename");
    fixture.write(":(glob)*.txt", "literal");
    fixture.commit();
    git(&fixture.root, &["mv", "old.txt", "新\n名.txt"]).unwrap();
    fixture.write("新\n名.txt", "working");
    fixture.write(":(glob)*.txt", "working");
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    fixture
        .discard(
            fixture.preview(&["新\n名.txt", ":(glob)*.txt"]).unwrap(),
            true,
        )
        .unwrap();
    assert_eq!(
        fs::read(fixture.root.join("新\n名.txt")).unwrap(),
        b"staged rename"
    );
    assert_eq!(
        fs::read(fixture.root.join(":(glob)*.txt")).unwrap(),
        b"literal"
    );
    assert!(!fixture.root.join("old.txt").exists());
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
}

#[test]
fn trash_failure_is_reported_without_deleting_the_file() {
    let fixture = Fixture::new();
    fixture.write("tracked", "base");
    fixture.commit();
    fixture.write("tracked", "changed");
    fixture.write("new", "keep on failure");
    let expected = fixture.preview(&["tracked", "new"]).unwrap();
    let error = discard_with_trash(&fixture.root, expected, true, |_| {
        Err("trash unavailable".into())
    })
    .unwrap_err();
    assert!(error.contains("已撤销 1 个文件"));
    assert_eq!(
        fs::read(fixture.root.join("new")).unwrap(),
        b"keep on failure"
    );
}

#[test]
fn refuses_staged_only_files_directories_submodules_and_operations() {
    let fixture = Fixture::new();
    fixture.write("file", "base");
    fixture.commit();
    fixture.write("file", "staged");
    git(&fixture.root, &["add", "file"]).unwrap();
    assert!(fixture.preview(&["file"]).is_err());
    fs::remove_file(fixture.root.join("file")).unwrap();
    fixture.write("file/child", "keep");
    assert!(fixture.preview(&["file"]).unwrap_err().contains("目录"));
    assert_eq!(fs::read(fixture.root.join("file/child")).unwrap(), b"keep");
    assert!(fixture.preview(&["../outside"]).is_err());
    let head = git_line(&fixture.root, &["rev-parse", "HEAD"]).unwrap();
    fs::write(fixture.root.join(".git/MERGE_HEAD"), head).unwrap();
    assert!(
        fixture
            .preview(&["file/child"])
            .unwrap_err()
            .contains("当前 Git 操作")
    );
}

#[cfg(unix)]
#[test]
fn symlinks_do_not_touch_targets_or_traverse_parent_links() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let fixture = Fixture::new();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("target"), "outside").unwrap();
    symlink("initial-target", fixture.root.join("link")).unwrap();
    fixture.write("script", "script");
    fixture.write("dir/file", "base");
    fixture.commit();
    fs::remove_file(fixture.root.join("link")).unwrap();
    symlink(outside.path().join("target"), fixture.root.join("link")).unwrap();
    fs::set_permissions(
        fixture.root.join("script"),
        fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    fixture
        .discard(fixture.preview(&["link", "script"]).unwrap(), true)
        .unwrap();
    assert_eq!(
        fs::read_link(fixture.root.join("link")).unwrap(),
        PathBuf::from("initial-target")
    );
    assert_eq!(fs::read(outside.path().join("target")).unwrap(), b"outside");
    assert_eq!(
        fs::metadata(fixture.root.join("script"))
            .unwrap()
            .permissions()
            .mode()
            & 0o111,
        0
    );
    fs::remove_dir_all(fixture.root.join("dir")).unwrap();
    symlink(outside.path(), fixture.root.join("dir")).unwrap();
    assert!(
        fixture
            .preview(&["dir/file"])
            .unwrap_err()
            .contains("父目录")
    );
}

#[test]
fn unborn_worktree_supports_new_files_without_creating_an_index() {
    let fixture = Fixture::new();
    fixture.write("new", "unborn");
    let expected = fixture.preview(&["new"]).unwrap();
    assert!(expected.files[0].untracked);
    assert!(!fixture.root.join(".git/index").exists());
    assert!(fixture.directory.path().exists());
}

#[test]
fn refuses_gitlinks_without_recursing_into_submodules() {
    let fixture = Fixture::new();
    fixture.write("base", "base");
    fixture.commit();
    let head = git_line(&fixture.root, &["rev-parse", "HEAD"]).unwrap();
    git(
        &fixture.root,
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            "160000",
            &head,
            "module",
        ],
    )
    .unwrap();
    git(&fixture.root, &["commit", "-m", "gitlink"]).unwrap();
    let error = fixture.preview(&["module"]).unwrap_err();
    assert!(error.contains("子模块"), "{error}");
}

#[test]
fn linked_worktree_discard_preserves_main_worktree_and_its_index() {
    let fixture = Fixture::new();
    fixture.write("file", "base");
    fixture.commit();
    let holder = tempfile::tempdir().unwrap();
    let linked = holder.path().join("linked");
    git(
        &fixture.root,
        &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
    )
    .unwrap();
    fixture.write("file", "main edit");
    git(&fixture.root, &["add", "file"]).unwrap();
    fs::write(linked.join("file"), "linked edit").unwrap();
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    with_repository(linked.to_str().unwrap(), |repo| {
        let expected = {
            let transaction = IndexTransaction::new(repo)?;
            preview(repo, &transaction, &["file".into()])?
        };
        discard_with_trash(repo, expected, true, |_| panic!("不应删除文件"))
    })
    .unwrap();
    assert_eq!(fs::read(linked.join("file")).unwrap(), b"base");
    assert_eq!(fs::read(fixture.root.join("file")).unwrap(), b"main edit");
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
}
