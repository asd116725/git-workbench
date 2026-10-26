import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import type { GitBranch, GitDeleteBranchPreview } from '../lib/types';

/** 只收集分支名称与起点，最终名称合法性和写入条件由 Git 校验。 */
export function BranchCreateForm({ branches, hasHead, name, startRef, checkout, locked, blocked, onNameChange, onStartChange, onCheckoutChange, onSubmit, onCancel }: {
  branches: GitBranch[];
  hasHead: boolean;
  name: string;
  startRef: string;
  checkout: boolean;
  locked: boolean;
  blocked: string | null;
  onNameChange: (value: string) => void;
  onStartChange: (value: string) => void;
  onCheckoutChange: (value: boolean) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const ready = Boolean(name.trim() && startRef && !locked && !blocked);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready) onSubmit();
  }
  return <form className="branch-create-form" onSubmit={submit}>
    <div className="branch-form-fields">
      <Field><FieldLabel htmlFor="new-branch-name">分支名称</FieldLabel><Input id="new-branch-name" value={name} onChange={event => onNameChange(event.target.value)} placeholder="feature/new-feature" autoComplete="off" spellCheck={false} disabled={locked} autoFocus /></Field>
      <Field><FieldLabel htmlFor="new-branch-start">起点分支</FieldLabel><select id="new-branch-start" value={startRef} onChange={event => onStartChange(event.target.value)} disabled={locked} aria-describedby="branch-start-description">
        {!startRef && <option value="">暂无可用起点</option>}
        {hasHead && <option value="HEAD">当前提交（HEAD）</option>}
        {(['local', 'remote'] as const).map(kind => {
          const items = branches.filter(branch => branch.kind === kind && (kind === 'local' || branch.localName));
          return items.length > 0 && <optgroup key={kind} label={kind === 'local' ? '本地分支' : '已获取的远程分支'}>{items.map(branch => <option key={branch.fullName} value={branch.fullName}>{branch.name}{branch.current ? '（当前分支）' : ''}</option>)}</optgroup>;
        })}
      </select><FieldDescription id="branch-start-description">可选择本地分支或已获取的远程分支；远程起点会建立上游跟踪关系。</FieldDescription></Field>
      <label className="branch-checkbox"><input type="checkbox" checked={checkout} disabled={locked} onChange={event => onCheckoutChange(event.target.checked)} />创建后切换到新分支</label>
    </div>
    <div className="branch-form-actions"><p>仅创建本地分支，不会推送到远程。</p><Button type="button" variant="outline" data-branch-cancel onClick={onCancel} disabled={locked}>取消</Button><Button type="submit" disabled={!ready}>{locked ? '正在创建…' : checkout ? '创建并切换' : '创建分支'}</Button></div>
  </form>;
}

/** 未合入提交的删除必须单独确认，普通删除不展示强制删除选项。 */
export function BranchDeleteConfirmation({ preview, confirmed, locked, blocked, onConfirmedChange, onDelete, onCancel }: {
  preview: GitDeleteBranchPreview;
  confirmed: boolean;
  locked: boolean;
  blocked: string | null;
  onConfirmedChange: (value: boolean) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const unmerged = preview.unmergedCommits > 0;
  return <div className="branch-delete-confirmation">
    <div className="branch-form-fields">
      <div className={`branch-delete-summary ${unmerged ? 'has-unmerged' : ''}`} role={unmerged ? 'note' : undefined}>
        <i className={`codicon codicon-${unmerged ? 'warning' : 'check'}`} aria-hidden="true" />
        <div><strong>{unmerged ? `${preview.unmergedCommits} 个提交尚未合入 ${preview.headName}` : `所有提交均已包含在 ${preview.headName} 中`}</strong><p>{unmerged ? '删除后将失去此分支引用，未合入提交可能难以找回。' : '删除此分支引用，不会删除工作区文件。'}</p></div>
      </div>
      <p className="branch-delete-note">只删除本地分支，远程分支不受影响。</p>
      {unmerged && <label className="branch-checkbox"><input type="checkbox" checked={confirmed} disabled={locked} onChange={event => onConfirmedChange(event.target.checked)} />我了解风险，仍要强制删除此分支</label>}
    </div>
    <div className="branch-form-actions"><Button type="button" variant="outline" data-branch-cancel onClick={onCancel} disabled={locked}>取消</Button><Button type="button" variant="destructive" onClick={onDelete} disabled={locked || Boolean(blocked) || (unmerged && !confirmed)}>{locked ? '正在删除…' : unmerged ? '强制删除' : '删除分支'}</Button></div>
  </div>;
}
