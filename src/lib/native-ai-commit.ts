import { invoke } from '@tauri-apps/api/core';
import { getLanguage } from './i18n';

/** 原生端只返回生成文案和快照摘要，密钥、提示词及完整差异不进入前端。 */
export interface AiCommitResult { message: string; snapshotId: string; files: string[] }

/** 按稳定错误码展示本地文案，不透传服务端正文或凭证。 */
export const aiCommitErrors = {
  missing_key: '未检测到 API Key',
  invalid_key: 'API Key 无效，请更新本机配置后重试。',
  insufficient_balance: 'DeepSeek 余额不足，请充值后重试。',
  rate_limited: '请求过于频繁，请稍后重试。',
  network: '无法连接 DeepSeek，请检查网络后重试。',
  timeout: '生成超时，请稍后重试。',
  service: 'DeepSeek 服务暂时不可用，请稍后重试。',
  empty_staged: '请先暂存需要提交的文件。',
  unsupported_operation: '请先完成当前 Git 操作或解决冲突，再使用 AI 生成。',
  input_too_large: '暂存内容超出生成上限，请缩小本次暂存范围后重试。',
  stale_snapshot: '暂存内容或当前提交已变化，请重新生成。',
  invalid_response: '未获得完整有效的提交文案，请重试。',
  skill: '无法读取提交规范，请检查本机 Skill 文件后重试。',
  cancelled: '生成已取消，原草稿保持不变。',
  git: '无法读取暂存内容，请刷新仓库后重试。',
  internal: '生成失败，请稍后重试。',
} as const;

export type AiCommitErrorCode = keyof typeof aiCommitErrors;

/** 未知异常仅使用通用提示，避免显示未经审查的错误内容。 */
export function aiCommitErrorCode(error: unknown): AiCommitErrorCode {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && Object.keys(aiCommitErrors).includes(code) ? code as AiCommitErrorCode : 'internal';
}

/** 四个命令均由原生端执行，不向 WebView 暴露凭证或模型配置。 */
export const nativeAiCommit = {
  checkKey: () => invoke<{ available: boolean }>('ai_commit_check_key'),
  /** 每次发起生成时读取界面语言，重新生成也使用最新选择。 */
  generate: (repoPath: string, requestId: string) => invoke<AiCommitResult>('ai_commit_generate', { repoPath, requestId, language: getLanguage() }),
  validate: (repoPath: string, snapshotId: string) => invoke<boolean>('ai_commit_validate', { repoPath, snapshotId }),
  cancel: (requestId: string) => invoke<void>('ai_commit_cancel', { requestId }),
};
