use super::{AiResult, IndexEntry, MAX_RULE_BYTES, WorkControl, rule_document};
use std::{
    collections::{BTreeSet, HashMap},
    path::{Component, Path},
};

const CONFIG_NAMES: &[&str] = &[
    ".commitlintrc",
    ".commitlintrc.json",
    ".commitlintrc.yaml",
    ".commitlintrc.yml",
    ".commitlintrc.js",
    ".commitlintrc.cjs",
    ".commitlintrc.mjs",
    ".commitlintrc.ts",
    ".commitlintrc.cts",
    ".commitlintrc.mts",
    "commitlint.config.js",
    "commitlint.config.cjs",
    "commitlint.config.mjs",
    "commitlint.config.ts",
    "commitlint.config.cts",
    "commitlint.config.mts",
];

/// 从索引发现自定义目录；保留根目录和 Rush 常用位置对未跟踪规范的兼容。
pub(super) fn paths(index: &HashMap<String, IndexEntry>) -> BTreeSet<String> {
    let mut paths = BTreeSet::new();
    for directory in ["", "common/autoinstallers/rush-commitlint/"] {
        paths.extend(CONFIG_NAMES.iter().map(|name| format!("{directory}{name}")));
    }
    paths.insert("common/autoinstallers/rush-commitlint/package.json".into());
    paths.extend(
        index
            .keys()
            .filter(|path| {
                !path
                    .split('/')
                    .any(|part| matches!(part, "node_modules" | ".git"))
                    && path
                        .rsplit('/')
                        .next()
                        .is_some_and(|name| CONFIG_NAMES.contains(&name))
            })
            .cloned(),
    );
    paths
}

#[derive(PartialEq)]
enum Token {
    Word(String),
    Literal(String),
    Punctuation(char),
}

/// 只提取字面量 extends 数组，跳过注释；动态表达式交给模型参考原文，不求值。
pub(super) fn literal_extends(content: &str) -> Vec<String> {
    let mut chars = content.chars().peekable();
    let mut tokens = Vec::new();
    while let Some(ch) = chars.next() {
        match ch {
            '/' if chars.peek() == Some(&'/') => {
                for ch in chars.by_ref() {
                    if ch == '\n' {
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                while let Some(ch) = chars.next() {
                    if ch == '*' && chars.peek() == Some(&'/') {
                        chars.next();
                        break;
                    }
                }
            }
            '\'' | '"' | '`' => {
                let mut value = String::new();
                let mut valid = ch != '`';
                let mut closed = false;
                while let Some(next) = chars.next() {
                    if next == ch {
                        closed = true;
                        break;
                    }
                    if next == '\\' {
                        valid = false;
                        chars.next();
                    } else {
                        value.push(next);
                    }
                }
                tokens.push(if valid && closed {
                    Token::Literal(value)
                } else {
                    Token::Punctuation('?')
                });
            }
            ch if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '$') => {
                let mut word = String::from(ch);
                while chars
                    .peek()
                    .is_some_and(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '$'))
                {
                    word.push(chars.next().unwrap());
                }
                tokens.push(Token::Word(word));
            }
            ch if ch.is_whitespace() => {}
            ch => tokens.push(Token::Punctuation(ch)),
        }
    }
    let mut result = Vec::new();
    for (i, token) in tokens.iter().enumerate() {
        if !matches!(token, Token::Word(key) | Token::Literal(key) if key == "extends")
            || tokens.get(i + 1) != Some(&Token::Punctuation(':'))
            || tokens.get(i + 2) != Some(&Token::Punctuation('['))
        {
            continue;
        }
        let mut values = Vec::new();
        let mut expect_value = true;
        for token in &tokens[i + 3..] {
            match token {
                Token::Literal(value) if expect_value => {
                    values.push(value.clone());
                    expect_value = false;
                }
                Token::Punctuation(',') if !expect_value => expect_value = true,
                Token::Punctuation(']') => {
                    result.extend(values);
                    break;
                }
                _ => break,
            }
        }
    }
    result
}

/// 归一化仓库相对路径，拒绝绝对路径与越过仓库根目录的引用。
fn relative(path: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for part in path.components() {
        match part {
            Component::Normal(value) => parts.push(value.to_str()?),
            Component::CurDir => {}
            Component::ParentDir => {
                parts.pop()?;
            }
            _ => return None,
        }
    }
    Some(parts.join("/"))
}

fn resolve_file(
    repo: &Path,
    index: &HashMap<String, IndexEntry>,
    files: &[String],
    path: &Path,
    control: &WorkControl,
) -> AiResult<Option<String>> {
    let Some(path) = relative(path) else {
        return Ok(None);
    };
    for suffix in ["", ".js", ".cjs", ".mjs", ".json", ".ts", ".cts", ".mts"] {
        let candidate = format!("{path}{suffix}");
        if rule_document(repo, index, files, &candidate, MAX_RULE_BYTES, control)?.is_some() {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

/// 按配置所在目录向上查找已安装依赖，只读取入口文本，不加载 Node、插件或网络依赖。
pub(super) fn resolve(
    repo: &Path,
    index: &HashMap<String, IndexEntry>,
    files: &[String],
    config: &str,
    reference: &str,
    control: &WorkControl,
) -> AiResult<Option<String>> {
    let directory = Path::new(config).parent().unwrap_or(Path::new(""));
    if reference.starts_with('.') {
        return resolve_file(repo, index, files, &directory.join(reference), control);
    }
    if reference.is_empty() || reference.contains(['\\', ':']) || Path::new(reference).is_absolute()
    {
        return Ok(None);
    }
    let package = if reference.starts_with('@') || reference.starts_with("commitlint-config-") {
        reference.to_owned()
    } else {
        format!("commitlint-config-{reference}")
    };
    for ancestor in directory.ancestors() {
        control.check()?;
        let root = ancestor.join("node_modules").join(&package);
        let Some(manifest) = relative(&root.join("package.json")) else {
            continue;
        };
        if let Some(content) =
            rule_document(repo, index, files, &manifest, MAX_RULE_BYTES, control)?
            && let Ok(value) = serde_json::from_str::<serde_json::Value>(&content)
        {
            let exports = value
                .get("exports")
                .map(|exports| exports.get(".").unwrap_or(exports));
            let entry = exports
                .and_then(|exports| {
                    exports.as_str().or_else(|| {
                        ["require", "import", "default"]
                            .iter()
                            .find_map(|key| exports.get(key)?.as_str())
                    })
                })
                .or_else(|| value.get("main")?.as_str())
                .unwrap_or("index.js");
            return resolve_file(repo, index, files, &root.join(entry), control);
        }
        if let Some(path) = resolve_file(repo, index, files, &root.join("index"), control)? {
            return Ok(Some(path));
        }
    }
    Ok(None)
}
