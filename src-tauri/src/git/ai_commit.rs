//! 原生端独立处理暂存取材与凭证；前端仅接收候选文案和快照标识。

use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::{Duration, Instant},
};
use tokio::sync::watch;

mod collection;
mod credentials;
mod message_rules;
mod process;
mod transport;

type AiResult<T> = Result<T, AiError>;

/// 阻塞采集与子进程共享取消和总时限，丢弃异步任务后也能及时停止后台工作。
#[derive(Clone)]
struct WorkControl {
    cancellation: Option<watch::Receiver<bool>>,
    deadline: Instant,
}

impl WorkControl {
    fn standalone(timeout: Duration) -> Self {
        Self {
            cancellation: None,
            deadline: Instant::now() + timeout,
        }
    }

    fn check(&self) -> AiResult<()> {
        if self
            .cancellation
            .as_ref()
            .is_some_and(|receiver| *receiver.borrow() || receiver.has_changed().is_err())
        {
            return Err(AiError::new("cancelled"));
        }
        if Instant::now() >= self.deadline {
            return Err(AiError::new("timeout"));
        }
        Ok(())
    }
}

/// 稳定错误码供界面翻译，禁止附带 Git、Shell 或上游请求的原始错误。
#[derive(Debug, Serialize)]
pub struct AiError {
    code: &'static str,
    message: &'static str,
}

impl AiError {
    fn new(code: &'static str) -> Self {
        let message = match code {
            "missing_key" => "未读取到 DEEPSEEK_API_KEY，请配置登录环境或从已配置的终端启动应用。",
            "invalid_key" => "DeepSeek API Key 无效，请检查后重试。",
            "insufficient_balance" => "DeepSeek 账户余额不足，请充值后重试。",
            "rate_limited" => "DeepSeek 请求过于频繁，请稍后重试。",
            "network" => "无法连接 DeepSeek，请检查网络后重试。",
            "timeout" => "生成超时，请稍后重试。",
            "service" => "DeepSeek 服务暂不可用，请稍后重试。",
            "empty_staged" => "当前暂存区为空，请先暂存需要提交的修改。",
            "unsupported_operation" => "请先完成或中止当前 Git 操作并解决冲突，再生成提交信息。",
            "input_too_large" => "本次暂存内容或提交规范超过生成上限，请缩小暂存范围后重试。",
            "stale_snapshot" => "暂存内容或分支已变化，请重新生成。",
            "invalid_response" => "DeepSeek 未返回完整有效的提交信息，请重试。",
            "commit_rules_violation" => "生成的提交信息未通过仓库规则校验，请重新生成或手动调整。",
            "commit_rules_unsupported" => "无法静态校验此仓库的提交规则，请手动填写提交信息。",
            "skill" => "无法读取有效的 staged-commit-message-zh 规则，请检查本机 Skill 文件。",
            "cancelled" => "已取消生成。",
            "git" => "无法读取完整暂存内容，请检查仓库后重试。",
            _ => "生成服务暂不可用，请重试。",
        };
        Self { code, message }
    }
}

/// 活跃任务只保留取消信号，不缓存密钥、提示词或仓库正文。
#[derive(Default)]
pub struct AiCommitState {
    requests: Mutex<Requests>,
}

#[derive(Default)]
struct Requests {
    active: HashMap<String, watch::Sender<bool>>,
    /// 同步取消可能早于异步生成首次调度；最多保留 128 个、120 秒内的预取消 ID。
    cancelled: VecDeque<(String, Instant)>,
}

#[derive(Serialize)]
pub struct KeyAvailability {
    available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedCommit {
    message: String,
    snapshot_id: String,
    files: Vec<String>,
}

/// 生成语言只接受应用支持的三种选择，不把任意前端文本拼入系统规则。
#[derive(Clone, Copy, Deserialize)]
pub enum CommitLanguage {
    #[serde(rename = "zh-CN")]
    SimplifiedChinese,
    #[serde(rename = "zh-TW")]
    TraditionalChinese,
    #[serde(rename = "en")]
    English,
}

/// 仅接受预定义模式；简洁模式不加载详细 Skill，但仍遵守仓库提交约束。
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommitMode {
    Concise,
    Detailed,
}

impl CommitLanguage {
    fn prompt_instruction(self) -> &'static str {
        match self {
            Self::SimplifiedChinese => {
                "输出语言：简体中文（zh-CN）。标题摘要和正文必须使用简体中文。"
            }
            Self::TraditionalChinese => {
                "輸出語言：繁體中文（zh-TW）。標題摘要和內文必須使用繁體中文，不得使用簡體中文。"
            }
            Self::English => {
                "Output language: English (en). Write the subject summary and body in English."
            }
        }
    }
}

struct RequestGuard<'a> {
    state: &'a AiCommitState,
    id: String,
}

impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut requests) = self.state.requests.lock() {
            requests.active.remove(&self.id);
        }
    }
}

impl AiCommitState {
    fn begin(&self, id: String) -> AiResult<(RequestGuard<'_>, watch::Receiver<bool>)> {
        let mut requests = self.requests.lock().map_err(|_| AiError::new("internal"))?;
        if id.is_empty() || id.len() > 128 || requests.active.contains_key(&id) {
            return Err(AiError::new("internal"));
        }
        requests
            .cancelled
            .retain(|(_, time)| time.elapsed() < Duration::from_secs(120));
        if let Some(position) = requests
            .cancelled
            .iter()
            .position(|(cancelled, _)| cancelled == &id)
        {
            requests.cancelled.remove(position);
            return Err(AiError::new("cancelled"));
        }
        if requests.active.len() >= 4 {
            return Err(AiError::new("internal"));
        }
        let (sender, receiver) = watch::channel(false);
        requests.active.insert(id.clone(), sender);
        Ok((RequestGuard { state: self, id }, receiver))
    }

    fn cancel(&self, id: &str) -> AiResult<()> {
        if id.is_empty() || id.len() > 128 {
            return Ok(());
        }
        let mut requests = self.requests.lock().map_err(|_| AiError::new("internal"))?;
        if let Some(request) = requests.active.get(id) {
            let _ = request.send(true);
        } else {
            requests.cancelled.retain(|(cancelled, time)| {
                cancelled != id && time.elapsed() < Duration::from_secs(120)
            });
            if requests.cancelled.len() == 128 {
                requests.cancelled.pop_front();
            }
            requests
                .cancelled
                .push_back((id.to_string(), Instant::now()));
        }
        Ok(())
    }
}

async fn cancelled(receiver: &mut watch::Receiver<bool>) {
    loop {
        if *receiver.borrow_and_update() || receiver.changed().await.is_err() {
            return;
        }
    }
}

/// 每次重新检测登录环境，不把暂时缺失的凭证缓存为永久不可用。
#[tauri::command]
pub async fn ai_commit_check_key() -> AiResult<KeyAvailability> {
    let result = tauri::async_runtime::spawn_blocking(|| {
        credentials::read_key(&WorkControl::standalone(Duration::from_secs(5)))
    })
    .await
    .map_err(|_| AiError::new("internal"))?;
    match result {
        Ok(_) => Ok(KeyAvailability { available: true }),
        Err(error) if error.code == "missing_key" => Ok(KeyAvailability { available: false }),
        Err(error) => Err(error),
    }
}

/// 完整采集、网络请求和最终复核均绑定同一任务；取消会丢弃正在进行的 HTTP future。
#[tauri::command]
pub async fn ai_commit_generate(
    repo_path: String,
    request_id: String,
    language: CommitLanguage,
    mode: CommitMode,
    state: tauri::State<'_, AiCommitState>,
) -> AiResult<GeneratedCommit> {
    let (_guard, mut cancellation) = state.begin(request_id)?;
    let control = WorkControl {
        cancellation: Some(cancellation.clone()),
        deadline: Instant::now() + Duration::from_secs(100),
    };
    tokio::select! {
        biased;
        _ = cancelled(&mut cancellation) => Err(AiError::new("cancelled")),
        result = tokio::time::timeout(Duration::from_secs(100), generate(repo_path, language, mode, control)) => {
            result.map_err(|_| AiError::new("timeout"))?
        }
    }
}

async fn generate(
    repo_path: String,
    language: CommitLanguage,
    mode: CommitMode,
    control: WorkControl,
) -> AiResult<GeneratedCommit> {
    let input_path = repo_path.clone();
    let collection_control = control.clone();
    let input = tauri::async_runtime::spawn_blocking(move || {
        collection::collect(&input_path, language, mode, &collection_control)
    })
    .await
    .map_err(|_| AiError::new("internal"))??;
    control.check()?;
    let message_rules = input.message_rules?;
    let key_control = control.clone();
    let key = tauri::async_runtime::spawn_blocking(move || credentials::read_key(&key_control))
        .await
        .map_err(|_| AiError::new("internal"))??;
    control.check()?;
    let message = message_rules.prepare(&transport::generate(&key, input.prompt).await?)?;
    drop(key);
    let snapshot_id = input.snapshot_id;
    let expected = snapshot_id.clone();
    let valid = tauri::async_runtime::spawn_blocking(move || {
        collection::validate(&repo_path, &expected, &control)
    })
    .await
    .map_err(|_| AiError::new("internal"))??;
    if !valid {
        return Err(AiError::new("stale_snapshot"));
    }
    Ok(GeneratedCommit {
        message,
        snapshot_id,
        files: input.files,
    })
}

/// 应用候选文案前再次核验索引对象、HEAD 与分支，未暂存修改不会导致误失效。
#[tauri::command]
pub async fn ai_commit_validate(repo_path: String, snapshot_id: String) -> AiResult<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        collection::validate(
            &repo_path,
            &snapshot_id,
            &WorkControl::standalone(Duration::from_secs(15)),
        )
    })
    .await
    .map_err(|_| AiError::new("internal"))?
}

/// 只取消指定任务；其他工作区和手写草稿不受影响。
#[tauri::command]
pub fn ai_commit_cancel(
    request_id: String,
    state: tauri::State<'_, AiCommitState>,
) -> AiResult<()> {
    state.cancel(&request_id)
}

#[cfg(test)]
mod tests;
