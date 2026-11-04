use super::*;
use tempfile::TempDir;

struct Fixture(TempDir);

impl Fixture {
    fn new() -> Self {
        Self::with_suffix("")
    }

    fn with_suffix(suffix: &str) -> Self {
        let fixture = Self(tempfile::Builder::new().suffix(suffix).tempdir().unwrap());
        fixture.git(&["init", "-b", "main"]);
        fixture.git(&["config", "user.name", "AI Fixture"]);
        fixture.git(&["config", "user.email", "fixture@example.invalid"]);
        fixture.git(&["config", "commit.gpgSign", "false"]);
        fixture.git(&["config", "core.autocrlf", "false"]);
        fixture.git(&["config", "core.hooksPath", "/dev/null"]);
        fixture
    }

    fn path(&self) -> &Path {
        self.0.path()
    }

    fn git(&self, args: &[&str]) {
        crate::git::git(self.path(), args).unwrap();
    }

    fn write(&self, path: &str, value: impl AsRef<[u8]>) {
        let path = self.path().join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, value).unwrap();
    }

    fn stage(&self, path: &str, value: impl AsRef<[u8]>) {
        self.write(path, value);
        self.git(&["add", "--", path]);
    }

    fn collect(&self) -> AiResult<Input> {
        let control = WorkControl::standalone(Duration::from_secs(15));
        locked(self.path().to_str().unwrap(), &control, |repo| {
            collect_locked(
                repo,
                BUNDLED_SKILL,
                CommitLanguage::SimplifiedChinese,
                &control,
            )
        })
    }

    fn validate(&self, snapshot: &str) -> bool {
        validate(
            self.path().to_str().unwrap(),
            snapshot,
            &WorkControl::standalone(Duration::from_secs(15)),
        )
        .unwrap()
    }
}

#[test]
fn first_commit_covers_all_files_and_uses_only_index_context() {
    let fixture = Fixture::new();
    fixture.stage("说明\n特殊 名称.txt", "staged-only-text\n");
    fixture.stage("src/second.rs", "pub fn staged() {}\n");
    fixture.write("说明\n特殊 名称.txt", "worktree-secret-must-not-be-sent\n");
    let input = fixture.collect().unwrap();
    assert_eq!(input.files.len(), 2);
    assert!(input.files.iter().any(|path| path == "说明\n特殊 名称.txt"));
    assert!(input.prompt.user.contains("staged-only-text"));
    assert!(input.prompt.user.contains("pub fn staged"));
    assert!(!input.prompt.user.contains("worktree-secret"));
    assert!(fixture.validate(&input.snapshot_id));
    fixture.write("src/second.rs", "only-worktree-change\n");
    assert!(fixture.validate(&input.snapshot_id));
}

#[test]
fn interface_language_overrides_skill_language_without_changing_staged_evidence() {
    let fixture = Fixture::new();
    fixture.stage(
        "src/filter.ts",
        "export const matches = (value: string) => value.trim();\n",
    );
    fixture.stage("AGENTS.md", "提交信息必须使用中文。\n");
    let control = WorkControl::standalone(Duration::from_secs(15));
    let baseline = fixture.collect().unwrap();
    for (language, expected) in [
        ("zh-CN", "输出语言：简体中文（zh-CN）"),
        ("zh-TW", "輸出語言：繁體中文（zh-TW）"),
        ("en", "Output language: English (en)"),
    ] {
        let language: CommitLanguage = serde_json::from_value(language.into()).unwrap();
        let input = locked(fixture.path().to_str().unwrap(), &control, |repo| {
            collect_locked(repo, BUNDLED_SKILL, language, &control)
        })
        .unwrap();
        assert_eq!(input.prompt.user, baseline.prompt.user);
        assert_eq!(input.snapshot_id, baseline.snapshot_id);
        assert!(input.prompt.system.contains(BUNDLED_SKILL));
        let output_protocol = input.prompt.system.split(BUNDLED_SKILL).nth(1).unwrap();
        assert!(output_protocol.contains(expected));
        assert!(output_protocol.contains("语言和输出格式优先于"));
    }
}

#[test]
fn object_change_head_change_and_branch_change_invalidate_equal_file_count() {
    let fixture = Fixture::new();
    fixture.stage("file.txt", "initial\n");
    fixture.git(&["commit", "-m", "chore: 初始提交"]);
    fixture.stage("file.txt", "first-staged\n");
    let first = fixture.collect().unwrap();
    fixture.stage("file.txt", "second-staged\n");
    assert!(!fixture.validate(&first.snapshot_id));
    let second = fixture.collect().unwrap();
    assert_eq!(second.files, first.files);
    fixture.git(&["switch", "-c", "other"]);
    assert!(!fixture.validate(&second.snapshot_id));
    let third = fixture.collect().unwrap();
    fixture.git(&["commit", "-m", "fix: 提交修改"]);
    assert!(!fixture.validate(&third.snapshot_id));
}

#[test]
fn empty_special_operation_and_unmerged_index_are_rejected() {
    let fixture = Fixture::new();
    assert_eq!(fixture.collect().err().unwrap().code, "empty_staged");
    fixture.stage("file.txt", "base\n");
    fixture.git(&["commit", "-m", "chore: 初始"]);
    fixture.stage("file.txt", "staged\n");
    let valid = fixture.collect().unwrap();
    fixture.write(".git/CHERRY_PICK_HEAD", "pending");
    assert_eq!(
        fixture.collect().err().unwrap().code,
        "unsupported_operation"
    );
    assert!(!fixture.validate(&valid.snapshot_id));
    fs::remove_file(fixture.path().join(".git/CHERRY_PICK_HEAD")).unwrap();
    fixture.git(&["reset", "--hard", "HEAD"]);
    fixture.git(&["switch", "-c", "other"]);
    fixture.stage("file.txt", "other\n");
    fixture.git(&["commit", "-m", "fix: 另一分支"]);
    fixture.git(&["switch", "main"]);
    fixture.stage("file.txt", "main\n");
    fixture.git(&["commit", "-m", "fix: 主分支"]);
    let output = crate::git::run_git(fixture.path(), &["merge", "other"]).unwrap();
    assert!(!output.status.success());
    fs::remove_file(fixture.path().join(".git/MERGE_HEAD")).unwrap();
    assert_eq!(
        fixture.collect().err().unwrap().code,
        "unsupported_operation"
    );
}

#[test]
fn binary_is_evidence_only_and_large_diff_is_rejected_without_truncation() {
    let fixture = Fixture::new();
    fixture.stage("asset.bin", b"\0fictional-binary-content");
    let input = fixture.collect().unwrap();
    let material: serde_json::Value = serde_json::from_str(&input.prompt.user).unwrap();
    assert!(
        material["complete_staged_diff"]
            .as_str()
            .unwrap()
            .contains("Binary files")
    );
    assert_eq!(material["index_context"].as_array().unwrap().len(), 0);
    assert!(!input.prompt.user.contains("fictional-binary-content"));
    fixture.stage("large.txt", "x".repeat(MAX_DIFF_BYTES + 1));
    assert_eq!(fixture.collect().err().unwrap().code, "input_too_large");
}

#[test]
fn static_rules_and_history_use_staged_versions_and_never_execute_scripts() {
    let fixture = Fixture::new();
    fixture.stage("base.txt", "base\n");
    fixture.git(&["commit", "-m", "chore(project): 历史只供格式参考"]);
    fixture.stage("AGENTS.md", "标题使用中文\n");
    fixture.write("AGENTS.md", "工作区中的规范不能覆盖索引版本\n");
    fixture.stage("src/AGENTS.md", "scope 使用 core\n");
    fixture.stage("src/a.txt", "staged\n");
    fixture.write(
        "commitlint.config.js",
        "require('fs').writeFileSync('executed', 'bad'); module.exports = {};",
    );
    let input = fixture.collect().unwrap();
    assert!(input.prompt.user.contains("标题使用中文"));
    assert!(input.prompt.user.contains("scope 使用 core"));
    assert!(!input.prompt.user.contains("工作区中的规范"));
    assert!(input.prompt.user.contains("历史只供格式参考"));
    assert!(!fixture.path().join("executed").exists());
    assert!(input.prompt.system.contains(BUNDLED_SKILL));
}

#[test]
fn rush_commitlint_rules_include_index_config_and_installed_inheritance() {
    let fixture = Fixture::new();
    let config = "common/autoinstallers/rush-commitlint/commitlint.config.js";
    fixture.stage(
        config,
        "module.exports = { extends: ['@commitlint/config-conventional'], rules: { 'header-max-length': [2, 'always', 150] } };",
    );
    fixture.git(&["commit", "-m", "chore: 配置提交规则"]);
    fixture.write(
        config,
        "module.exports = { rules: { 'header-max-length': [0] } };",
    );
    fixture.write(
        "common/autoinstallers/rush-commitlint/node_modules/@commitlint/config-conventional/index.js",
        "require('fs').writeFileSync('executed', 'bad'); module.exports = { rules: { 'body-max-line-length': [2, 'always', 100] } };",
    );
    fixture.stage("src/feature.ts", "export const feature = true;\n");
    let input = fixture.collect().unwrap();
    let material: serde_json::Value = serde_json::from_str(&input.prompt.user).unwrap();
    let rules = material["repository_rules"].as_array().unwrap();
    assert!(rules.iter().any(|rule| rule["path"] == config && rule["content"].as_str().unwrap().contains("150")));
    assert!(rules.iter().any(|rule| {
        rule["content"]
            .as_str()
            .unwrap()
            .contains("'body-max-line-length': [2, 'always', 100]")
    }));
    assert!(!fixture.path().join("executed").exists());
}

#[test]
fn nested_commitlint_config_follows_relative_extends_without_cycles() {
    let fixture = Fixture::new();
    fixture.stage(
        "tools/git/commitlint.config.cts",
        "export default { extends: ['./base'] };",
    );
    fixture.stage("tools/git/base.js", "module.exports = { extends: ['./commitlint.config.cts'], rules: { 'body-max-line-length': [2, 'always', 72] } };");
    fixture.git(&["commit", "-m", "chore: 配置提交规则"]);
    fixture.stage("src/feature.ts", "export const feature = true;\n");
    let input = fixture.collect().unwrap();
    let material: serde_json::Value = serde_json::from_str(&input.prompt.user).unwrap();
    let rules = material["repository_rules"].as_array().unwrap();
    assert_eq!(
        rules
            .iter()
            .filter(|rule| rule["path"] == "tools/git/base.js")
            .count(),
        1
    );
    assert!(
        rules
            .iter()
            .any(|rule| rule["content"].as_str().unwrap().contains("72"))
    );
}

#[test]
fn oversized_index_rules_are_rejected_instead_of_silently_omitted() {
    let fixture = Fixture::new();
    fixture.stage("commitlint.config.js", "x".repeat(MAX_RULE_BYTES + 1));
    fixture.git(&["commit", "-m", "chore: 配置提交规则"]);
    fixture.stage("src/a.ts", "export const a = 1;\n");
    assert_eq!(fixture.collect().err().unwrap().code, "input_too_large");
}

#[test]
fn inherited_config_ignores_examples_and_uses_package_entry_without_sending_manifest() {
    let fixture = Fixture::new();
    fixture.stage(
        "package.json",
        r#"{"commitlint":{"extends":["team"]},"privateNote":"not-rule-material"}"#,
    );
    fixture.git(&["commit", "-m", "chore: 配置提交规则"]);
    fixture.write(
        "node_modules/commitlint-config-team/package.json",
        r#"{"main":"lib/config.cjs","privateNote":"not-rule-material"}"#,
    );
    fixture.write("node_modules/commitlint-config-team/lib/config.cjs", "// extends: ['./comment']\nconst example = `extends: ['./example']`;\nmodule.exports = { rules: { 'body-max-line-length': [2, 'always', 80] } };");
    fixture.write(
        "node_modules/commitlint-config-team/lib/comment.js",
        "comment-should-not-be-loaded",
    );
    fixture.write(
        "node_modules/commitlint-config-team/lib/example.js",
        "example-should-not-be-loaded",
    );
    fixture.stage("src/a.ts", "export const a = 1;\n");
    let input = fixture.collect().unwrap();
    assert!(
        input
            .prompt
            .user
            .contains("'body-max-line-length': [2, 'always', 80]")
    );
    assert!(!input.prompt.user.contains("should-not-be-loaded"));
    assert!(!input.prompt.user.contains("not-rule-material"));
}

#[test]
fn removed_inherited_config_does_not_fall_back_to_untracked_file() {
    let fixture = Fixture::new();
    fixture.stage(
        "commitlint.config.js",
        "module.exports = { extends: ['./base'] };",
    );
    fixture.stage("base.js", "module.exports = { rules: {} };");
    fixture.git(&["commit", "-m", "chore: 配置提交规则"]);
    fixture.git(&["rm", "base.js"]);
    fixture.write("base.js", "recreated-worktree-file-must-not-be-sent");
    let input = fixture.collect().unwrap();
    assert!(!input.prompt.user.contains("recreated-worktree-file"));
}

#[cfg(unix)]
#[test]
fn inherited_config_does_not_follow_links_outside_repository() {
    let fixture = Fixture::new();
    let outside = tempfile::tempdir().unwrap();
    fs::write(
        outside.path().join("index.js"),
        "outside-secret-must-not-be-sent",
    )
    .unwrap();
    fixture.stage(
        "commitlint.config.js",
        "module.exports = { extends: ['external', '../../../outside'] };",
    );
    fs::create_dir_all(fixture.path().join("node_modules")).unwrap();
    std::os::unix::fs::symlink(
        outside.path(),
        fixture
            .path()
            .join("node_modules/commitlint-config-external"),
    )
    .unwrap();
    let input = fixture.collect().unwrap();
    assert!(!input.prompt.user.contains("outside-secret"));
}

#[test]
fn custom_diff_commands_and_fsmonitor_are_disabled() {
    let fixture = Fixture::new();
    fixture.stage("file.txt", "staged\n");
    fixture.git(&["config", "diff.external", "touch executed"]);
    fixture.git(&["config", "core.fsmonitor", "touch monitored"]);
    let input = fixture.collect().unwrap();
    assert!(input.prompt.user.contains("staged"));
    assert!(!fixture.path().join("executed").exists());
    assert!(!fixture.path().join("monitored").exists());
}

#[test]
fn local_skill_has_priority_and_corruption_does_not_fall_back() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("SKILL.md");
    assert_eq!(load_skill_at(Some(&path)).unwrap(), BUNDLED_SKILL);
    fs::write(&path, format!("{BUNDLED_SKILL}\n本机额外约束")).unwrap();
    assert!(
        load_skill_at(Some(&path))
            .unwrap()
            .ends_with("本机额外约束")
    );
    fs::write(&path, "corrupt").unwrap();
    assert_eq!(load_skill_at(Some(&path)).unwrap_err().code, "skill");
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert_eq!(load_skill_at(Some(&path)).unwrap_err().code, "skill");
}

#[test]
fn intent_to_add_becoming_staged_invalidates_same_object_snapshot() {
    let fixture = Fixture::new();
    fixture.stage("a.txt", "first\n");
    fixture.write("empty.txt", "");
    fixture.git(&["add", "-N", "empty.txt"]);
    let input = fixture.collect().unwrap();
    assert_eq!(input.files, vec!["a.txt"]);
    fixture.git(&["add", "empty.txt"]);
    assert!(!fixture.validate(&input.snapshot_id));
}

#[test]
fn optional_context_limit_does_not_truncate_staged_evidence() {
    let fixture = Fixture::new();
    for number in 0..40 {
        fixture.write(&format!("{number:02}.txt"), format!("staged-{number:02}\n"));
    }
    fixture.git(&["add", "--all"]);
    let input = fixture.collect().unwrap();
    let material: serde_json::Value = serde_json::from_str(&input.prompt.user).unwrap();
    assert_eq!(input.files.len(), 40);
    assert_eq!(material["index_context"].as_array().unwrap().len(), 32);
    let diff = material["complete_staged_diff"].as_str().unwrap();
    for number in 0..40 {
        assert!(diff.contains(&format!("staged-{number:02}")));
    }
}

#[test]
fn repository_path_ending_in_newline_keeps_its_identity() {
    let fixture = Fixture::with_suffix("\n");
    fixture.stage("file.txt", "staged\n");
    let input = fixture.collect().unwrap();
    assert!(fixture.validate(&input.snapshot_id));
}

#[test]
fn cancellation_stops_collection_and_releases_shared_repository_lock() {
    use std::{sync::mpsc, time::Instant};
    let fixture = Fixture::new();
    for number in 0..40 {
        fixture.write(&format!("{number:02}.txt"), "staged\n");
    }
    fixture.git(&["add", "--all"]);
    let root = fixture.path().to_str().unwrap().to_string();
    let (sender, receiver) = tokio::sync::watch::channel(false);
    let control = WorkControl {
        cancellation: Some(receiver),
        deadline: Instant::now() + Duration::from_secs(10),
    };
    let (acquired, wait_acquired) = mpsc::channel();
    let worker = thread::spawn(move || {
        locked(&root, &control, |repo| {
            acquired.send(()).unwrap();
            collect_locked(
                repo,
                BUNDLED_SKILL,
                CommitLanguage::SimplifiedChinese,
                &control,
            )
        })
    });
    wait_acquired.recv_timeout(Duration::from_secs(3)).unwrap();
    thread::sleep(Duration::from_millis(30));
    let started = Instant::now();
    sender.send(true).unwrap();
    let error = worker.join().unwrap().err().unwrap();
    assert_eq!(error.code, "cancelled");
    assert!(started.elapsed() < Duration::from_secs(1));
    // 普通 Git 操作使用同一把锁，取消后应可立即继续。
    crate::git::with_repository(fixture.path().to_str().unwrap(), |_| Ok(())).unwrap();
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[test]
fn waiting_for_repository_lock_obeys_cancellation_and_total_deadline() {
    use std::{sync::mpsc, time::Instant};
    let fixture = Fixture::new();
    let root = fixture.path().to_str().unwrap().to_string();
    let owner_root = root.clone();
    let (acquired, wait_acquired) = mpsc::channel();
    let (release, wait_release) = mpsc::channel();
    let owner = thread::spawn(move || {
        crate::git::with_repository(&owner_root, |_| {
            acquired.send(()).unwrap();
            wait_release.recv().unwrap();
            Ok(())
        })
        .unwrap()
    });
    wait_acquired.recv_timeout(Duration::from_secs(3)).unwrap();
    let timed = locked(
        &root,
        &WorkControl::standalone(Duration::from_millis(150)),
        |_| Ok(()),
    );
    assert_eq!(timed.unwrap_err().code, "timeout");
    let (sender, receiver) = tokio::sync::watch::channel(false);
    let control = WorkControl {
        cancellation: Some(receiver),
        deadline: Instant::now() + Duration::from_secs(5),
    };
    let waiting = thread::spawn(move || locked(&root, &control, |_| Ok(())));
    thread::sleep(Duration::from_millis(100));
    sender.send(true).unwrap();
    assert_eq!(waiting.join().unwrap().unwrap_err().code, "cancelled");
    release.send(()).unwrap();
    owner.join().unwrap();
}
