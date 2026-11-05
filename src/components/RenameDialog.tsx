import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useDisplayNames } from '../lib/display-names';
import { t, useI18n } from '../lib/i18n';
import './rename-dialog.css';

/** 编辑快照只绑定显示名称与入口，不改变 Git 工作区的选择或原始元数据。 */
export interface RenameTarget {
  id: string;
  kind: 'project' | 'main' | 'worktree';
  name: string;
  defaultName: string;
  customized: boolean;
  trigger: HTMLButtonElement;
}

/** 三类名称共用紧凑编辑流程，恢复默认同样需要点击保存。 */
export function RenameDialog({ target, onClose }: { target: RenameTarget; onClose: () => void }) {
  useI18n();
  /** null 表示明确恢复默认，即使别名与当前语言的默认文案相同也能删除覆盖。 */
  const [draft, setDraft] = useState<string | null>(target.name);
  const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const name = draft === null ? target.defaultName : draft.trim();
  const changed = name !== target.name || (draft === null && target.customized);
  const title = target.kind === 'project' ? t('修改项目名称') : target.kind === 'main' ? t('修改主工作区名称') : t('修改工作树名称');

  function save(event: FormEvent) {
    event.preventDefault();
    if (!name || !changed) return;
    try {
      const restoring = draft === null || name === target.defaultName;
      useDisplayNames.getState().setName(target.id, restoring ? null : name);
      toast.success(restoring ? t('已恢复默认名称') : t('名称已更新'));
      onClose();
    } catch { setError(true); }
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="rename-dialog"
    onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); input.current?.select(); }}
    onCloseAutoFocus={event => { event.preventDefault(); target.trigger.focus(); }}
    onPointerDownOutside={event => event.preventDefault()}>
    <form onSubmit={save}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription className="sr-only">{t('修改本机显示名称，不改变目录或 Git 分支。')}</DialogDescription></DialogHeader>
      <Field className="rename-field"><FieldLabel className="sr-only" htmlFor="display-name">{t('显示名称')}</FieldLabel><Input ref={input} id="display-name" value={draft ?? target.defaultName} placeholder={target.defaultName} autoComplete="off" spellCheck={false} aria-invalid={!name} aria-describedby={!name || error ? 'name-error' : undefined}
        onChange={event => { setDraft(event.target.value); setError(false); }}
        onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }} />
        {(!name || error) && <p id="name-error" className="rename-error" role="alert">{!name ? t('名称不能为空') : t('保存失败，请重试。')}</p>}
      </Field>
      <div className="rename-actions"><Button type="button" variant="ghost" className="rename-restore" title={t('默认名称：{name}', { name: target.defaultName })} disabled={draft === null || (!target.customized && draft === target.defaultName)} onClick={() => { setDraft(null); setError(false); input.current?.focus(); }}>{t('恢复默认')}</Button><Button type="button" variant="outline" onClick={onClose}>{t('取消')}</Button><Button type="submit" disabled={!name || !changed}>{t('保存')}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
