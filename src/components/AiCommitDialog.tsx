import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { t, useI18n } from '../lib/i18n';
import { aiCommitErrors } from '../lib/native-ai-commit';
import type { AiCommitState } from '../lib/ai-commit-session';

/** 弹窗仅编辑临时候选；应用和取消由绑定工作区的会话处理。 */
export function AiCommitDialog({ state, stagedCount, hasDraft, blocked, onApply, onCloseFocus }: {
  state: AiCommitState;
  stagedCount: number;
  hasDraft: boolean;
  blocked: boolean;
  onApply: () => void;
  onCloseFocus: () => void;
}) {
  useI18n();
  const { phase, result, error, validating, candidate } = state;
  const loading = phase === 'checking' || phase === 'generating';
  const missingKey = error === 'missing_key';
  const preview = phase === 'preview';
  return <Dialog open={phase !== 'closed'} onOpenChange={open => { if (!open) state.close(); }}>
    <DialogContent className="ai-commit-dialog" onCloseAutoFocus={event => { event.preventDefault(); onCloseFocus(); }}>
      <DialogHeader>
        <DialogTitle><i className="codicon codicon-sparkle" aria-hidden="true" />{t('AI 生成提交信息')}</DialogTitle>
        <DialogDescription>{t('根据暂存内容和当前界面语言生成文案，确认使用后才会填入提交框。')}</DialogDescription>
      </DialogHeader>
      <div className="ai-commit-body">
        <div className="ai-commit-context"><span>DeepSeek</span><span>{t('已暂存 {count} 个文件', { count: stagedCount })}</span></div>
        {loading && <div className="ai-commit-status" role="status"><i className="codicon codicon-loading spin" aria-hidden="true" /><strong>{phase === 'checking' ? t('正在检测 API Key…') : t('正在生成提交文案…')}</strong><p>{t('原草稿保持不变，可随时取消。')}</p></div>}
        {phase === 'ready' && <div className="ai-commit-status" role="status"><i className="codicon codicon-check" aria-hidden="true" /><strong>{t('已检测到 API Key')}</strong><p>{t('可以开始生成；检测到配置不代表已通过服务鉴权。')}</p></div>}
        {error && <div className="ai-commit-notice" role="alert"><i className="codicon codicon-warning" aria-hidden="true" /><div><strong>{t(aiCommitErrors[error])}</strong>{missingKey ? <>
          <p>{t('请在本机登录 shell 中配置 DEEPSEEK_API_KEY，然后重新检测。')}</p>
          <p>{t('若仅在终端临时 export，请从该终端启动应用，或配置登录环境后重启应用。密钥不会在此显示。')}</p>
        </> : <p>{t('原草稿保持不变。')}</p>}</div></div>}
        {result && <>
          <Field className="ai-commit-result"><FieldLabel htmlFor="ai-commit-candidate">{t('生成结果')}</FieldLabel><Textarea id="ai-commit-candidate" value={candidate} readOnly={!preview || validating} onChange={event => state.edit(event.target.value)} spellCheck={false} /></Field>
          <details className="ai-commit-files"><summary>{t('生成依据：{count} 个暂存文件', { count: result.files.length })}</summary><ul>{result.files.map(file => <li key={file}>{file}</li>)}</ul></details>
          {state.draftChanged ? <p className="ai-commit-draft-note" role="alert">{t('草稿已发生变化。请核对后再次点击应用，确认替换当前草稿。')}</p> : <p className="ai-commit-draft-note">{hasDraft ? t('已有手写草稿。只有点击“替换草稿”才会覆盖原内容。') : t('确认使用后填入提交框，仍需检查并手动提交。')}</p>}
          {validating && <p className="ai-commit-validating" role="status">{t('正在核验暂存内容…')}</p>}
        </>}
      </div>
      <div className="ai-commit-footer">
        <p className="ai-commit-disclosure"><i className="codicon codicon-info" aria-hidden="true" />{t('仅将暂存差异与必要提交规范发送至 DeepSeek。')}</p>
        <div className="ai-commit-actions">
          {preview && <Button type="button" variant="ghost" disabled={blocked || validating} onClick={() => void state.generate()}>{t('重新生成')}</Button>}
          <span className="ai-commit-action-spacer" />
          <Button type="button" variant="outline" onClick={state.close}>{loading ? t('取消生成') : t('取消')}</Button>
          {preview && <Button type="button" disabled={blocked || validating || !candidate.trim()} onClick={onApply}>{hasDraft ? t('替换草稿') : t('使用此文案')}</Button>}
          {missingKey && <Button type="button" disabled={blocked} onClick={() => void state.checkKey()}>{t('重新检测')}</Button>}
          {phase === 'ready' && <Button type="button" disabled={blocked} onClick={() => void state.generate()}>{t('开始生成')}</Button>}
          {(phase === 'error' || phase === 'stale') && !missingKey && <Button type="button" disabled={blocked} onClick={() => void state.generate()}>{phase === 'stale' ? t('重新生成') : t('重试')}</Button>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
