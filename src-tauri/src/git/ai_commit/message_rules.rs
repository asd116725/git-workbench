use super::{AiError, AiResult};
use serde_json::Value;
use std::collections::BTreeMap;

/// 从仓库静态配置合并后的约束；不执行配置函数或插件。
pub(super) struct MessageRules {
    rules: BTreeMap<String, Value>,
    /// 默认解析器不识别 type!，仅 conventionalcommits 预设允许这一写法。
    breaking_header: bool,
}

fn unsupported() -> AiError {
    AiError::new("commit_rules_unsupported")
}

fn violation() -> AiError {
    AiError::new("commit_rules_violation")
}

/// 与 commitlint 的 JavaScript 字符串长度一致，emoji 占两个 UTF-16 单元。
fn length(value: &str) -> usize {
    value.encode_utf16().count()
}

fn strings(value: &Value) -> Option<Vec<&str>> {
    if let Some(value) = value.as_str() {
        Some(vec![value])
    } else {
        value.as_array()?.iter().map(Value::as_str).collect()
    }
}

impl MessageRules {
    /// 未知规则不能视为已通过，避免生成文案直到提交时才失败。
    pub(super) fn new(rules: BTreeMap<String, Value>, preset: Option<&str>) -> AiResult<Self> {
        let breaking_header =
            rules.is_empty() || preset == Some("conventional-changelog-conventionalcommits");
        let mut active = BTreeMap::new();
        for (name, value) in rules {
            let rule = value.as_array().ok_or_else(unsupported)?;
            match rule.first().and_then(Value::as_u64) {
                Some(0) => continue,
                Some(1 | 2) => {}
                _ => return Err(unsupported()),
            }
            if !matches!(
                rule.get(1).and_then(Value::as_str),
                Some("always" | "never")
            ) {
                return Err(unsupported());
            }
            let (part, check) = name.split_once('-').ok_or_else(unsupported)?;
            let argument = rule.get(2).unwrap_or(&Value::Null);
            let valid = match check {
                "max-line-length" => {
                    matches!(part, "body" | "footer") && argument.as_u64().is_some()
                }
                "leading-blank" => matches!(part, "body" | "footer"),
                "empty" => matches!(part, "type" | "scope" | "subject"),
                "max-length" | "min-length" => {
                    matches!(part, "header" | "type" | "scope" | "subject")
                        && argument.as_u64().is_some()
                }
                "enum" => {
                    matches!(part, "type" | "scope")
                        && argument
                            .as_array()
                            .is_some_and(|values| values.iter().all(Value::is_string))
                }
                "case" => {
                    matches!(part, "header" | "type" | "scope" | "subject")
                        && strings(argument).is_some_and(|cases| {
                            cases.iter().all(|case| {
                                matches!(
                                    *case,
                                    "lower-case"
                                        | "lowercase"
                                        | "lowerCase"
                                        | "upper-case"
                                        | "uppercase"
                                        | "sentence-case"
                                        | "sentencecase"
                                        | "start-case"
                                        | "pascal-case"
                                        | "camel-case"
                                        | "kebab-case"
                                        | "snake-case"
                                )
                            })
                        })
                }
                "full-stop" => {
                    part == "subject" && argument.as_str().is_some_and(|value| length(value) == 1)
                }
                "trim" => part == "header",
                _ => false,
            };
            if !valid {
                return Err(unsupported());
            }
            active.insert(name, value);
        }
        Ok(Self {
            rules: active,
            breaking_header,
        })
    }

    /// 只调整换行和规则要求的空行；标题及标识符不可截断，无法满足时拒绝候选。
    pub(super) fn prepare(&self, message: &str) -> AiResult<String> {
        let normalized = message.replace("\r\n", "\n");
        let mut lines = normalized.lines();
        let header = lines.next().ok_or_else(violation)?;
        let (prefix, subject) = header.split_once(": ").ok_or_else(violation)?;
        if prefix.ends_with('!') && !self.breaking_header {
            return Err(violation());
        }
        let prefix = prefix.strip_suffix('!').unwrap_or(prefix);
        let (kind, scope) = match prefix.split_once('(') {
            Some((kind, scope)) => (kind, scope.strip_suffix(')').ok_or_else(violation)?),
            None => (prefix, ""),
        };
        if kind.is_empty()
            || !kind
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            || subject.is_empty()
        {
            return Err(violation());
        }
        for (name, rule) in &self.rules {
            let (part, check) = name.split_once('-').unwrap();
            let value = match part {
                "header" => header,
                "type" => kind,
                "scope" => scope,
                "subject" => subject,
                _ => continue,
            };
            let argument = &rule[2];
            let succeeds = match check {
                "empty" => value.is_empty(),
                "trim" => value.trim() == value,
                "max-length" => {
                    value.is_empty() || length(value) <= argument.as_u64().unwrap() as usize
                }
                "min-length" => {
                    value.is_empty() || length(value) >= argument.as_u64().unwrap() as usize
                }
                "enum" => {
                    if value.is_empty() {
                        continue;
                    }
                    let choices = argument.as_array().unwrap();
                    if part == "scope" {
                        choices.is_empty()
                            || value
                                .split(['/', '\\', ','])
                                .all(|segment| choices.iter().any(|choice| choice == segment))
                    } else {
                        choices.iter().any(|choice| choice == value)
                    }
                }
                "full-stop" => header.ends_with(argument.as_str().unwrap()),
                "case" => {
                    if value.is_empty()
                        || (part == "subject"
                            && !value
                                .chars()
                                .next()
                                .is_some_and(|ch| ch.is_lowercase() || ch.is_uppercase()))
                    {
                        continue;
                    }
                    let mut matches = false;
                    for case in strings(argument).unwrap() {
                        let segments: Vec<_> = if part == "scope" {
                            value.split(['/', '\\', ',']).collect()
                        } else {
                            vec![value]
                        };
                        let mut all = true;
                        for segment in segments {
                            all &= matches_case(segment, case)?;
                        }
                        if all {
                            matches = true;
                            break;
                        }
                    }
                    matches
                }
                _ => unreachable!(),
            };
            // commitlint 的长度规则不反转 when；empty、enum、case 和 full-stop 才使用 never。
            let negated = rule[1] == "never" && !matches!(check, "max-length" | "min-length");
            if succeeds == negated {
                return Err(violation());
            }
        }
        let tail: Vec<&str> = lines.collect();
        // 对无法仅凭文本确定的 footer 边界取更严格行宽，避免把 footer 当作正文而漏检。
        let limit = ["body-max-line-length", "footer-max-line-length"]
            .iter()
            .filter_map(|name| self.rules.get(*name).and_then(|rule| rule[2].as_u64()))
            .min()
            .map(|value| value as usize);
        let mut result = vec![header.to_owned()];
        for (index, line) in tail.iter().enumerate() {
            let leading = if is_footer(line) {
                "footer-leading-blank"
            } else if index == 0 {
                "body-leading-blank"
            } else {
                ""
            };
            if let Some(rule) = self.rules.get(leading) {
                if !line.is_empty()
                    && rule[1] == "always"
                    && result.last().is_some_and(|line| !line.is_empty())
                {
                    result.push(String::new());
                } else if rule[1] == "never"
                    && (line.is_empty() || result.last().is_some_and(String::is_empty))
                {
                    return Err(violation());
                }
            }
            match limit {
                Some(limit) => result.extend(wrap_line(line, limit)?),
                None => result.push((*line).to_owned()),
            }
        }
        // 换行后再核验，不能因缩进或多字节字符产生新的超长行。
        if limit.is_some_and(|limit| result.iter().skip(1).any(|line| length(line) > limit)) {
            return Err(violation());
        }
        Ok(result.join("\n"))
    }
}

fn is_footer(line: &str) -> bool {
    let note = line.trim_start_matches(|ch: char| ch.is_whitespace() || ch == '*');
    note.starts_with("BREAKING CHANGE")
        || note.starts_with("BREAKING-CHANGE")
        || line
            .split('#')
            .skip(1)
            .any(|part| part.starts_with(|ch: char| !ch.is_whitespace()))
}

/// 中文按字符边界换行，英文只在空白处分词；不破坏代码标识符、路径和 URL。
fn wrap_line(line: &str, limit: usize) -> AiResult<Vec<String>> {
    let mut remaining = line.to_owned();
    let indent = if ["- ", "* ", "+ "]
        .iter()
        .any(|prefix| line.starts_with(prefix))
    {
        "  "
    } else {
        ""
    };
    let mut result = Vec::new();
    let protected = line
        .find("BREAKING CHANGE")
        .map_or(0, |start| start + "BREAKING CHANGE".len());
    while length(&remaining) > limit {
        let mut units = 0;
        let mut split = None;
        let mut previous = None;
        let mut code = false;
        for (index, ch) in remaining.char_indices() {
            if units > limit {
                break;
            }
            let token_start = remaining[..index]
                .char_indices()
                .rev()
                .find(|(_, ch)| ch.is_whitespace())
                .map_or(0, |(start, ch)| start + ch.len_utf8());
            let token_end = remaining[index..]
                .find(char::is_whitespace)
                .map_or(remaining.len(), |end| index + end);
            let path = remaining[token_start..token_end].contains(['/', '\\']);
            if index > 0
                && !code
                && (!result.is_empty() || index >= protected)
                && (ch.is_whitespace()
                    || previous.is_some_and(|prev: char| {
                        prev.is_whitespace() || (!path && (is_cjk(prev) || is_cjk(ch)))
                    }))
                && !remaining[..index].trim().is_empty()
            {
                split = Some(index);
            }
            units += ch.len_utf16();
            if ch == '`' {
                code = !code;
            }
            previous = Some(ch);
        }
        let split = split.ok_or_else(violation)?;
        let left = remaining[..split].trim_end();
        let right = remaining[split..].trim_start();
        if length(indent) + length(right) >= length(&remaining) {
            return Err(violation());
        }
        result.push(left.to_owned());
        remaining = format!("{indent}{right}");
    }
    result.push(remaining);
    Ok(result)
}

fn is_cjk(ch: char) -> bool {
    matches!(ch as u32, 0x2e80..=0x9fff | 0xf900..=0xfaff | 0xff00..=0xffef | 0x20000..=0x323af)
}

/// 与 commitlint 一样忽略成对引号内的专有名称；复杂 Unicode 分词无法确定时拒绝放行。
fn matches_case(value: &str, case: &str) -> AiResult<bool> {
    let mut input = String::new();
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if matches!(ch, '`' | '\'' | '"') && chars.clone().any(|next| next == ch) {
            for next in chars.by_ref() {
                if next == ch {
                    break;
                }
            }
        } else {
            input.push(ch);
        }
    }
    let input = input.trim();
    if input.is_empty() || input.starts_with(|ch: char| ch.is_ascii_digit()) {
        return Ok(true);
    }
    let first = input.chars().next().unwrap();
    let result = match case {
        "lower-case" | "lowercase" | "lowerCase" => input == input.to_lowercase(),
        "upper-case" | "uppercase" => input == input.to_uppercase(),
        "sentence-case" | "sentencecase" => {
            first.to_uppercase().collect::<String>() == first.to_string()
        }
        "start-case" | "pascal-case" if first.is_lowercase() => false,
        "camel-case" if first.is_uppercase() => false,
        // 复杂 Unicode 和序数词分词暂不模拟，避免近似匹配把违反 never 的文案放行。
        _ if !input.is_ascii() || input.chars().any(|ch| ch.is_ascii_digit()) => {
            return Err(unsupported());
        }
        "start-case" | "pascal-case" | "camel-case" | "kebab-case" | "snake-case" => {
            let plain = input.replace('\'', "");
            let mut words = Vec::new();
            let mut start = 0;
            let bytes = plain.as_bytes();
            for i in 0..=bytes.len() {
                let delimiter = i == bytes.len() || !bytes[i].is_ascii_alphabetic();
                let boundary = i > start
                    && i < bytes.len()
                    && bytes[i].is_ascii_uppercase()
                    && (bytes[i - 1].is_ascii_lowercase()
                        || (bytes[i - 1].is_ascii_uppercase()
                            && bytes.get(i + 1).is_some_and(u8::is_ascii_lowercase)));
                if delimiter || boundary {
                    if i > start {
                        words.push(&plain[start..i]);
                    }
                    start = if delimiter { i + 1 } else { i };
                }
            }
            let transformed = words
                .iter()
                .enumerate()
                .map(|(i, word)| {
                    let mut word = if case == "start-case" {
                        (*word).to_owned()
                    } else {
                        word.to_ascii_lowercase()
                    };
                    if matches!(case, "start-case" | "pascal-case")
                        || (case == "camel-case" && i > 0)
                    {
                        word[..1].make_ascii_uppercase();
                    }
                    word
                })
                .collect::<Vec<_>>()
                .join(match case {
                    "start-case" => " ",
                    "kebab-case" => "-",
                    "snake-case" => "_",
                    _ => "",
                });
            input == transformed
        }
        _ => return Err(unsupported()),
    };
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rules(value: Value) -> MessageRules {
        MessageRules::new(serde_json::from_value(value).unwrap(), None).unwrap()
    }

    #[test]
    fn wraps_chinese_body_without_losing_content_or_splitting_identifiers() {
        let rules = rules(json!({"body-max-line-length": [2, "always", 20]}));
        let message = "fix: 修复点击\n\n- 展开后保留 hasExpanded 状态，避免按钮移动导致点击失效";
        let result = rules.prepare(message).unwrap();
        assert!(
            result
                .lines()
                .skip(2)
                .all(|line| line.encode_utf16().count() <= 20)
        );
        assert!(result.contains("hasExpanded"));
        assert_eq!(
            result.split_whitespace().collect::<String>(),
            message.split_whitespace().collect::<String>()
        );
        assert_eq!(rules.prepare(&result).unwrap(), result);
    }

    #[test]
    fn wraps_english_at_word_boundaries_and_keeps_blank_paragraphs() {
        let rules = rules(json!({"body-max-line-length": [2, "always", 16]}));
        assert_eq!(
            rules
                .prepare("fix: click\n\n- Keep the button position stable\n\nAdd coverage")
                .unwrap(),
            "fix: click\n\n- Keep the\n  button\n  position\n  stable\n\nAdd coverage"
        );
    }

    #[test]
    fn counts_emoji_as_two_utf16_units_and_does_not_wrap_headers() {
        let rules = rules(
            json!({"header-max-length": [2, "always", 10], "body-max-line-length": [2, "always", 4]}),
        );
        assert_eq!(
            rules.prepare("fix: 修复\n\n中文😀中文").unwrap(),
            "fix: 修复\n\n中文😀\n中文"
        );
        assert_eq!(
            rules.prepare("fix: 中文😀😀").unwrap_err().code,
            "commit_rules_violation"
        );
    }

    #[test]
    fn rejects_unsplittable_tokens_instead_of_corrupting_paths_or_urls() {
        let rules = rules(json!({"body-max-line-length": [2, "always", 12]}));
        for text in [
            "veryLongIdentifierWithoutBreaks",
            "https://example.com/very/long/path",
            "src/这是很长的中文文件名称.ts",
            "`这是不可拆分的代码标识符名称`",
        ] {
            assert_eq!(
                rules
                    .prepare(&format!("fix: 修复\n\n{text}"))
                    .unwrap_err()
                    .code,
                "commit_rules_violation"
            );
        }
    }

    #[test]
    fn enforces_type_scope_subject_rules_and_leading_blank() {
        let rules = rules(json!({
            "type-enum": [2, "always", ["fix"]],
            "scope-enum": [2, "always", ["ui", "core"]],
            "subject-full-stop": [2, "never", "."],
            "subject-case": [2, "never", ["sentence-case", "start-case", "pascal-case", "upper-case"]],
            "body-leading-blank": [1, "always"]
        }));
        assert_eq!(
            rules
                .prepare("fix(ui/core): repair click\nDetails")
                .unwrap(),
            "fix(ui/core): repair click\n\nDetails"
        );
        for message in [
            "feat: 新功能",
            "fix(other): 修复",
            "fix: 修复.",
            "fix: Repair click",
            "fix: RepairClick",
        ] {
            assert_eq!(
                rules.prepare(message).unwrap_err().code,
                "commit_rules_violation",
                "{message}"
            );
        }
        assert!(rules.prepare("fix: 修复 API 点击").is_ok());
    }

    #[test]
    fn respects_disabled_rules_and_rejects_unknown_active_rules() {
        let disabled = rules(json!({"body-max-line-length": [0], "team-custom": [0]}));
        let message = format!("fix: 修复\n\n{}", "正文".repeat(80));
        assert_eq!(disabled.prepare(&message).unwrap(), message);
        assert_eq!(
            MessageRules::new(
                serde_json::from_value(json!({"team-custom": [2, "always"]})).unwrap(),
                None
            )
            .err()
            .unwrap()
            .code,
            "commit_rules_unsupported"
        );
    }

    #[test]
    fn case_checks_respect_scope_segments_and_word_boundaries() {
        let scopes = rules(json!({"scope-case": [2, "never", "pascal-case"]}));
        assert!(scopes.prepare("fix(Foo/Bar): 修复").is_err());
        for (case, subject) in [
            ("start-case", "FOOBar"),
            ("pascal-case", "Foo1bar"),
            ("camel-case", "foo1bar"),
        ] {
            let rules = rules(json!({"subject-case": [2, "always", case]}));
            assert!(
                rules.prepare(&format!("fix: {subject}")).is_err(),
                "{case}: {subject}"
            );
        }
    }

    #[test]
    fn keeps_breaking_change_marker_intact_when_wrapping_footer() {
        let rules = rules(json!({"footer-max-line-length": [2, "always", 12]}));
        assert!(
            rules
                .prepare("feat: 更新\n\nBREAKING CHANGE: 接口发生变更")
                .is_err()
        );
    }

    #[test]
    fn does_not_accept_headers_the_default_parser_cannot_parse() {
        let rules = rules(json!({"type-empty": [2, "never"]}));
        for message in ["fix!: 修改接口", "custom-type: 修复"] {
            assert!(rules.prepare(message).is_err(), "{message}");
        }
    }

    #[test]
    fn separates_footer_notes_and_non_numeric_references() {
        let rules = rules(json!({"footer-leading-blank": [2, "always"]}));
        for footer in ["* BREAKING CHANGE 修改接口", "Refs #abc"] {
            let result = rules
                .prepare(&format!("fix: 修复\n\n正文\n{footer}"))
                .unwrap();
            assert!(result.contains(&format!("正文\n\n{footer}")));
        }
    }
}
