use super::super::message_rules::MessageRules;
use super::{AiError, AiResult, Document, IndexEntry, MAX_RULE_BYTES, WorkControl, rule_document};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
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

/// 静态分词时跳过注释，模板和转义表达式保留为不可求值标记。
fn tokens(content: &str) -> Vec<Token> {
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
    tokens
}

/// 只采集字面量继承引用，不对动态表达式求值。
pub(super) fn literal_extends(content: &str) -> Vec<String> {
    let tokens = tokens(content);
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

/// 仅识别直接导出的字面量配置；展开、函数和导出后修改均不能当作已解析规则。
fn static_config(content: &str) -> AiResult<serde_json::Value> {
    let tokens = tokens(content);
    let error = || AiError::new("commit_rules_unsupported");
    let start = if tokens.first() == Some(&Token::Punctuation('{')) {
        0
    } else {
        tokens.windows(4).rposition(|items| matches!(items,
            [Token::Word(module), Token::Punctuation('.'), Token::Word(exports), Token::Punctuation('=')]
            if module == "module" && exports == "exports"))
            .map(|index| index + 4)
            .or_else(|| tokens.windows(2).rposition(|items| matches!(items,
                [Token::Word(export), Token::Word(default)] if export == "export" && default == "default"))
                .map(|index| index + 2))
            .ok_or_else(error)?
    };
    let mut position = start;
    let value = literal(&tokens, &mut position, 0).ok_or_else(error)?;
    if !value.is_object()
        || tokens[position..]
            .iter()
            .any(|token| *token != Token::Punctuation(';'))
    {
        return Err(error());
    }
    // 自定义解析器和插件可以改变同名规则的含义，静态校验不能声称与它们等价。
    if value
        .get("plugins")
        .is_some_and(|value| value.as_array().is_none_or(|values| !values.is_empty()))
        || value.get("parserOpts").is_some()
        || value.get("parserPreset").is_some_and(|value| {
            !matches!(
                value.as_str(),
                Some(
                    "conventional-changelog-conventionalcommits" | "conventional-changelog-angular"
                )
            )
        })
    {
        return Err(error());
    }
    Ok(value)
}

/// 解析 JSON 兼容的 JS 字面量；限制嵌套深度，避免配置文本造成递归耗尽。
fn literal(tokens: &[Token], position: &mut usize, depth: usize) -> Option<serde_json::Value> {
    use serde_json::{Map, Value};
    if depth > 64 {
        return None;
    }
    let token = tokens.get(*position)?;
    *position += 1;
    match token {
        Token::Literal(value) => Some(Value::String(value.clone())),
        Token::Word(value) => match value.as_str() {
            "true" => Some(Value::Bool(true)),
            "false" => Some(Value::Bool(false)),
            "null" => Some(Value::Null),
            _ => value.parse::<u64>().ok().map(|value| value.into()),
        },
        Token::Punctuation('[') => {
            let mut result = Vec::new();
            while tokens.get(*position)? != &Token::Punctuation(']') {
                result.push(literal(tokens, position, depth + 1)?);
                match tokens.get(*position)? {
                    Token::Punctuation(',') => *position += 1,
                    Token::Punctuation(']') => {}
                    _ => return None,
                }
            }
            *position += 1;
            Some(Value::Array(result))
        }
        Token::Punctuation('{') => {
            let mut result = Map::new();
            while tokens.get(*position)? != &Token::Punctuation('}') {
                let key = match tokens.get(*position)? {
                    Token::Literal(key) | Token::Word(key) => key.clone(),
                    _ => return None,
                };
                *position += 1;
                if tokens.get(*position)? != &Token::Punctuation(':') {
                    return None;
                }
                *position += 1;
                result.insert(key, literal(tokens, position, depth + 1)?);
                match tokens.get(*position)? {
                    Token::Punctuation(',') => *position += 1,
                    Token::Punctuation('}') => {}
                    _ => return None,
                }
            }
            *position += 1;
            Some(Value::Object(result))
        }
        _ => None,
    }
}

/// 选用暂存文件所在项目的配置；多个项目配置无法统一时拒绝把无关规则混在一起。
pub(super) fn compile(
    documents: &[Document],
    roots: &BTreeSet<String>,
    inheritance: &HashMap<String, Vec<Option<String>>>,
    files: &[String],
) -> AiResult<MessageRules> {
    let documents: HashMap<&str, &str> = documents
        .iter()
        .map(|doc| (doc.path.as_str(), doc.content.as_str()))
        .collect();
    let roots: Vec<&str> = roots
        .iter()
        .map(String::as_str)
        .filter(|path| documents.contains_key(path))
        .collect();
    let mut selected = BTreeSet::new();
    for file in files {
        let mut candidates: Vec<_> = roots
            .iter()
            .filter_map(|root| {
                let directory = Path::new(root).parent()?.to_str()?;
                if directory.is_empty() || directory == "common/autoinstallers/rush-commitlint" {
                    Some((*root, 0))
                } else if file.starts_with(&format!("{directory}/")) {
                    Some((*root, directory.len()))
                } else {
                    None
                }
            })
            .collect();
        candidates.sort_by_key(|(_, depth)| *depth);
        if let Some((_, depth)) = candidates.last() {
            selected.extend(
                candidates
                    .iter()
                    .filter(|(_, candidate)| candidate == depth)
                    .map(|(path, _)| *path),
            );
        }
    }
    if selected.len() > 1 || (selected.is_empty() && !roots.is_empty()) {
        return Err(AiError::new("commit_rules_unsupported"));
    }
    let mut rules = BTreeMap::new();
    let mut preset = None;
    if let Some(root) = selected.first() {
        merge(
            root,
            &documents,
            inheritance,
            &mut BTreeSet::new(),
            &mut rules,
            &mut preset,
        )?;
    }
    MessageRules::new(rules, preset.as_deref())
}

/// 后声明的 extends 覆盖前项，本地规则最后覆盖；[0] 必须保留到合并完成才移除。
fn merge(
    path: &str,
    documents: &HashMap<&str, &str>,
    inheritance: &HashMap<String, Vec<Option<String>>>,
    visiting: &mut BTreeSet<String>,
    rules: &mut BTreeMap<String, serde_json::Value>,
    preset: &mut Option<String>,
) -> AiResult<()> {
    let error = || AiError::new("commit_rules_unsupported");
    if !visiting.insert(path.to_owned()) {
        return Err(error());
    }
    let config = static_config(documents.get(path).ok_or_else(error)?)?;
    let dependencies = inheritance.get(path).ok_or_else(error)?;
    if let Some(extends) = config.get("extends") {
        let extends = extends.as_array().ok_or_else(error)?;
        if extends.len() != dependencies.len() || !extends.iter().all(serde_json::Value::is_string)
        {
            return Err(error());
        }
    }
    for dependency in dependencies {
        merge(
            dependency.as_deref().ok_or_else(error)?,
            documents,
            inheritance,
            visiting,
            rules,
            preset,
        )?;
    }
    if let Some(parser) = config
        .get("parserPreset")
        .and_then(serde_json::Value::as_str)
    {
        *preset = Some(parser.to_owned());
    }
    if let Some(local) = config.get("rules") {
        rules.extend(
            local
                .as_object()
                .ok_or_else(error)?
                .iter()
                .map(|(name, value)| (name.clone(), value.clone())),
        );
    }
    visiting.remove(path);
    Ok(())
}
