use super::{AiError, AiResult, WorkControl};

const KEY_NAME: &str = "DEEPSEEK_API_KEY";

fn valid_key(key: String) -> AiResult<String> {
    if key.is_empty() {
        return Err(AiError::new("missing_key"));
    }
    // 仅接受可作为 HTTP bearer token 的可打印 ASCII，避免控制字符进入请求头。
    if key.len() > 4096 || !key.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err(AiError::new("invalid_key"));
    }
    Ok(key)
}

pub(super) fn read_key(control: &WorkControl) -> AiResult<String> {
    control.check()?;
    match std::env::var(KEY_NAME) {
        Ok(key) => return valid_key(key),
        Err(std::env::VarError::NotUnicode(_)) => return Err(AiError::new("invalid_key")),
        Err(std::env::VarError::NotPresent) => {}
    }
    #[cfg(target_os = "macos")]
    {
        use std::{path::PathBuf, process::Command, time::Duration};
        let shell = std::env::var_os("SHELL")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .unwrap_or_else(|| "/bin/zsh".into());
        let home = std::env::var_os("HOME").ok_or_else(|| AiError::new("missing_key"))?;
        let mut command = Command::new(shell);
        command
            .current_dir(home)
            .args(["-i", "-l", "-c", KEY_SCRIPT]);
        shell_key_controlled(command, Duration::from_secs(5), control)
    }
    #[cfg(not(target_os = "macos"))]
    Err(AiError::new("missing_key"))
}

// 只读取命名变量，启动提示和 stderr 永不转发到日志或前端。
#[cfg(any(target_os = "macos", test))]
const KEY_SCRIPT: &str =
    "printf '\\0GIT_WORKBENCH_DEEPSEEK_KEY\\0'; /usr/bin/printenv DEEPSEEK_API_KEY; printf '\\0'";

#[cfg(test)]
pub(super) fn shell_key(
    command: std::process::Command,
    timeout: std::time::Duration,
) -> AiResult<String> {
    shell_key_controlled(command, timeout, &WorkControl::standalone(timeout))
}

#[cfg(any(target_os = "macos", test))]
fn shell_key_controlled(
    command: std::process::Command,
    timeout: std::time::Duration,
    control: &WorkControl,
) -> AiResult<String> {
    let (status, bytes) =
        super::process::read(command, 64 * 1024, timeout, control).map_err(|error| {
            AiError::new(match error {
                super::process::ProcessError::Cancelled => "cancelled",
                _ => "missing_key",
            })
        })?;
    if !status.success() {
        return Err(AiError::new("missing_key"));
    }
    let mut fields = bytes.split(|byte| *byte == 0);
    let value = fields
        .position(|field| field == b"GIT_WORKBENCH_DEEPSEEK_KEY")
        .and_then(|_| fields.next())
        .and_then(|field| field.strip_suffix(b"\n"))
        .ok_or_else(|| AiError::new("missing_key"))?;
    valid_key(String::from_utf8(value.to_vec()).map_err(|_| AiError::new("invalid_key"))?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process::Command,
        time::{Duration, Instant},
    };

    #[test]
    fn shell_extracts_only_named_value_and_preserves_exit_failure() {
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", &format!("printf startup; {KEY_SCRIPT}")])
            .env(KEY_NAME, "fictional-key");
        assert_eq!(
            shell_key(command, Duration::from_secs(2)).unwrap(),
            "fictional-key"
        );
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", &format!("{KEY_SCRIPT}; exit 1")])
            .env(KEY_NAME, "fictional-key");
        assert_eq!(
            shell_key(command, Duration::from_secs(2)).unwrap_err().code,
            "missing_key"
        );
    }

    #[test]
    fn shell_timeout_and_background_pipe_are_bounded() {
        for script in [
            "exec /bin/sleep 30".to_string(),
            format!("/bin/sleep 30 & {KEY_SCRIPT}"),
        ] {
            let mut command = Command::new("/bin/sh");
            command.args(["-c", &script]).env(KEY_NAME, "fictional-key");
            let started = Instant::now();
            let result = shell_key(command, Duration::from_millis(100));
            assert!(started.elapsed() < Duration::from_secs(2));
            if script.starts_with("exec") {
                assert_eq!(result.unwrap_err().code, "missing_key");
            } else {
                assert_eq!(result.unwrap(), "fictional-key");
            }
        }
    }

    #[test]
    fn key_rejects_empty_and_header_control_characters() {
        assert_eq!(valid_key(String::new()).unwrap_err().code, "missing_key");
        for value in ["token\nnext", "token next", "密钥"] {
            assert_eq!(valid_key(value.into()).unwrap_err().code, "invalid_key");
        }
    }
}
