use super::{AiError, AiResult, collection::Prompt};
use reqwest::{Client, RequestBuilder, StatusCode, redirect::Policy};
use serde::Deserialize;
use std::time::Duration;

const ENDPOINT: &str = "https://api.deepseek.com/chat/completions";
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_MESSAGE_BYTES: usize = 32 * 1024;

fn client() -> AiResult<Client> {
    Client::builder()
        .redirect(Policy::none())
        .https_only(true)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(65))
        .build()
        .map_err(|_| AiError::new("internal"))
}

pub(super) async fn generate(key: &str, prompt: Prompt) -> AiResult<String> {
    let request = client()?
        .post(ENDPOINT)
        .bearer_auth(key)
        .json(&payload(prompt));
    complete(request).await
}

fn payload(prompt: Prompt) -> serde_json::Value {
    serde_json::json!({
        "model": "deepseek-flash",
        "thinking": { "type": "disabled" },
        "stream": false,
        "max_tokens": 4096,
        "messages": [
            { "role": "system", "content": prompt.system },
            { "role": "user", "content": prompt.user },
        ],
    })
}

fn http_error(status: StatusCode) -> AiError {
    AiError::new(match status.as_u16() {
        401 | 403 => "invalid_key",
        402 => "insufficient_balance",
        429 => "rate_limited",
        408 => "timeout",
        _ => "service",
    })
}

fn network_error(error: reqwest::Error) -> AiError {
    AiError::new(if error.is_timeout() {
        "timeout"
    } else {
        "network"
    })
}

/// 流式读取仅用于限制响应体内存；协议仍为非流式，半截 JSON 或输出截断均不算成功。
async fn complete(request: RequestBuilder) -> AiResult<String> {
    let mut response = request.send().await.map_err(network_error)?;
    if !response.status().is_success() {
        return Err(http_error(response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(AiError::new("invalid_response"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(AiError::new("invalid_response"));
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_response(&bytes)
}

#[derive(Deserialize)]
struct Completion {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    finish_reason: String,
    message: Message,
}

#[derive(Deserialize)]
struct Message {
    content: Option<String>,
}

fn parse_response(bytes: &[u8]) -> AiResult<String> {
    let response: Completion =
        serde_json::from_slice(bytes).map_err(|_| AiError::new("invalid_response"))?;
    if response.choices.len() != 1 {
        return Err(AiError::new("invalid_response"));
    }
    let choice = response
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| AiError::new("invalid_response"))?;
    if choice.finish_reason != "stop" {
        return Err(AiError::new("invalid_response"));
    }
    let message = choice
        .message
        .content
        .unwrap_or_default()
        .trim()
        .replace("\r\n", "\n");
    if message.len() > MAX_MESSAGE_BYTES {
        return Err(AiError::new("invalid_response"));
    }
    // Skill 的聊天输出可能包裹一层文本围栏；仅移除完整外层，内层或多个候选仍拒绝。
    let message = if message.starts_with("```") {
        let (opening, content) = message
            .split_once('\n')
            .ok_or_else(|| AiError::new("invalid_response"))?;
        if !matches!(opening, "```" | "```text" | "```plaintext") {
            return Err(AiError::new("invalid_response"));
        }
        content
            .strip_suffix("\n```")
            .ok_or_else(|| AiError::new("invalid_response"))?
            .trim()
    } else {
        message.as_str()
    };
    let title = message.lines().next().unwrap_or_default();
    let valid_title = title.split_once(": ").is_some_and(|(prefix, summary)| {
        let kind = prefix.split(['(', '!']).next().unwrap_or_default();
        !kind.is_empty()
            && kind
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'-')
            && summary
                .chars()
                .any(|character| ('\u{3400}'..='\u{9fff}').contains(&character))
            && !prefix.chars().any(char::is_whitespace)
    });
    if !valid_title
        || message.contains("```")
        || message
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
    {
        return Err(AiError::new("invalid_response"));
    }
    Ok(message.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc,
        thread,
    };

    fn response(content: serde_json::Value, finish: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"choices": [{"finish_reason": finish, "message": {"content": content}}]})).unwrap()
    }

    #[test]
    fn accepts_one_complete_outer_text_fence_without_changing_message() {
        let expected =
            "fix(filter): 忽略查询大小写与首尾空白\n\n- 空查询保留完整列表\n- 补充筛选测试";
        assert_eq!(
            parse_response(&response(expected.into(), "stop")).unwrap(),
            expected
        );
        for opening in ["```", "```text", "```plaintext"] {
            let wrapped = format!("  \n{opening}\n{expected}\n```\n  ");
            assert_eq!(
                parse_response(&response(wrapped.into(), "stop")).unwrap(),
                expected
            );
        }
        assert_eq!(
            parse_response(&response("```text\r\nfix: 修复筛选\r\n```".into(), "stop")).unwrap(),
            "fix: 修复筛选"
        );
    }

    #[test]
    fn rejects_partial_multiple_nested_and_non_text_fences() {
        for content in [
            "```text\nfix: 修复筛选",
            "fix: 修复筛选\n```",
            "```text\nfix: 修复筛选\n```\n额外说明",
            "额外说明\n```text\nfix: 修复筛选\n```",
            "```text\nfix: 修复筛选\n```\n```text\nfix: 另一候选\n```",
            "```text\nfix: 修复筛选\n```text\n内层代码\n```\n```",
            "```json\nfix: 修复筛选\n```",
            "```text\n\n```",
        ] {
            assert_eq!(
                parse_response(&response(content.into(), "stop"))
                    .unwrap_err()
                    .code,
                "invalid_response"
            );
        }
        assert_eq!(
            parse_response(&response("```text\nfix: 修复筛选\n```".into(), "length"))
                .unwrap_err()
                .code,
            "invalid_response"
        );
        let oversized = format!(
            "```text\nfix: 修复筛选\n{}\n```",
            "x".repeat(MAX_MESSAGE_BYTES)
        );
        assert_eq!(
            parse_response(&response(oversized.into(), "stop"))
                .unwrap_err()
                .code,
            "invalid_response"
        );
    }

    /// 测试端点仅存在于测试模块；所有流量均流向回环地址，凭证为虚构值。
    fn serve(
        status: u16,
        body: Vec<u8>,
        delay: Duration,
    ) -> (String, mpsc::Receiver<()>, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, receiver) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut buffer = [0; 4096];
            let _ = stream.read(&mut buffer);
            let _ = sender.send(());
            thread::sleep(delay);
            let header = format!(
                "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(&body);
        });
        (format!("http://{address}"), receiver, server)
    }

    fn local_request(url: &str, timeout: Duration) -> RequestBuilder {
        Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .timeout(timeout)
            .build()
            .unwrap()
            .post(url)
            .bearer_auth("fictional-test-key")
    }

    #[tokio::test]
    async fn http_maps_errors_without_returning_upstream_body() {
        for (status, code) in [
            (401, "invalid_key"),
            (402, "insufficient_balance"),
            (429, "rate_limited"),
            (503, "service"),
            (302, "service"),
        ] {
            let (url, _, server) =
                serve(status, b"private upstream detail".to_vec(), Duration::ZERO);
            let error = complete(local_request(&url, Duration::from_secs(2)))
                .await
                .unwrap_err();
            assert_eq!(error.code, code);
            assert!(!serde_json::to_string(&error).unwrap().contains("private"));
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn http_accepts_complete_chinese_message_and_rejects_empty_truncated_or_oversized() {
        for (body, valid) in [
            (response("feat(ai): 生成提交信息".into(), "stop"), true),
            (
                response("```text\nfeat(ai): 生成提交信息\n```".into(), "stop"),
                true,
            ),
            (response("".into(), "stop"), false),
            (response("feat(ai): 生成提交信息".into(), "length"), false),
            (b"{\"choices\":".to_vec(), false),
            (vec![b' '; MAX_RESPONSE_BYTES + 1], false),
        ] {
            let (url, _, server) = serve(200, body, Duration::ZERO);
            let result = complete(local_request(&url, Duration::from_secs(2))).await;
            if valid {
                assert_eq!(result.unwrap(), "feat(ai): 生成提交信息");
            } else {
                assert_eq!(result.unwrap_err().code, "invalid_response");
            }
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn http_timeout_and_cancellation_stop_waiting_for_server() {
        let (url, _, server) = serve(200, Vec::new(), Duration::from_millis(200));
        assert_eq!(
            complete(local_request(&url, Duration::from_millis(40)))
                .await
                .unwrap_err()
                .code,
            "timeout"
        );
        server.join().unwrap();
        let (url, accepted, server) = serve(200, Vec::new(), Duration::from_millis(300));
        let state = super::super::AiCommitState::default();
        let (_guard, mut receiver) = state.begin("cancel-http".into()).unwrap();
        let cancelling = async {
            tokio::task::spawn_blocking(move || accepted.recv().unwrap())
                .await
                .unwrap();
            state.cancel("cancel-http").unwrap();
        };
        let request = async {
            tokio::select! {
                biased;
                _ = super::super::cancelled(&mut receiver) => Err(AiError::new("cancelled")),
                result = complete(local_request(&url, Duration::from_secs(2))) => result,
            }
        };
        let started = std::time::Instant::now();
        let (_, result) = tokio::join!(cancelling, request);
        assert_eq!(result.unwrap_err().code, "cancelled");
        assert!(started.elapsed() < Duration::from_millis(200));
        server.join().unwrap();
    }

    #[test]
    fn protocol_disables_thinking_streaming_and_tools() {
        let request = payload(Prompt {
            system: "规则".into(),
            user: "数据".into(),
        });
        assert_eq!(request["model"], "deepseek-flash");
        assert_eq!(request["thinking"]["type"], "disabled");
        assert_eq!(request["stream"], false);
        assert_eq!(request["max_tokens"], 4096);
        assert!(request.get("tools").is_none());
        for content in ["feat: English only", "", "feat: 新增\0"] {
            assert_eq!(
                parse_response(&response(content.into(), "stop"))
                    .unwrap_err()
                    .code,
                "invalid_response"
            );
        }
    }
}
