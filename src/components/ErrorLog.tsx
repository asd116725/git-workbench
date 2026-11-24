import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cleanErrorLog } from '../lib/error-log';
import { t, useI18n } from '../lib/i18n';
import { translateMessage } from '../lib/i18n-system';
import './error-log.css';

type CopyStatus = 'copied' | 'failed';

function Icon({ name }: { name: string }) {
  return <i className={`codicon codicon-${name}`} aria-hidden="true" />;
}

function CopyLogButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return <Button type="button" variant="ghost" size="sm" className="error-log-copy" data-copied={copied} onClick={onCopy}>
    <Icon name={copied ? 'check' : 'copy'} />{copied ? t('已复制') : t('复制日志')}
  </Button>;
}

function formatLog(text: string) {
  const lines = text.split('\n');
  const content = lines.map((line, index) => {
    const error = /^\s*(?:\[[^\]]+\]\s+)?(?:\w*Error:|error:|fatal:|ERROR(?:\s|$))/.test(line);
    const className = error ? 'error-log-error-line' : /^\s+at /.test(line) ? 'error-log-stack-line' : undefined;
    return <span className={className} key={index}>{line}{index < lines.length - 1 ? '\n' : ''}</span>;
  });
  return { content, count: lines.length };
}

function formatLineCount(count: number) {
  return count === 1 ? t('1 行') : t('{count} 行', { count });
}

/** 内嵌日志跟随后台消息，全屏保留展开时的文本。入口消失后将焦点还给工作区。 */
export function ErrorLog({ message, role, fallbackFocusRef }: {
  message: string | null;
  role: 'alert' | 'status';
  fallbackFocusRef: RefObject<HTMLElement | null>;
}) {
  useI18n();
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const open = snapshot !== null;
  const [wrap, setWrap] = useState(true);
  const expandRef = useRef<HTMLButtonElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  const copyRequest = useRef(0);
  const copyTimer = useRef<number | undefined>(undefined);
  const text = message ? cleanErrorLog(translateMessage(message)) : '';
  const inlineLog = useMemo(() => formatLog(text), [text]);
  const fullLog = useMemo(() => formatLog(snapshot ?? ''), [snapshot]);
  const title = role === 'alert' ? t('错误日志') : t('自动刷新日志');
  const bodyLabel = t('可滚动的日志正文');

  /** 复制反馈只属于当前展示位置及其文本，全屏展开后不受后台刷新影响。 */
  const copyMessage = open ? null : message;
  const copyText = snapshot ?? text;
  const copyScope = useMemo(() => ({ message: copyMessage, text: copyText, open }), [copyMessage, copyText, open]);
  const [feedback, setFeedback] = useState<{ scope: typeof copyScope; status: CopyStatus } | null>(null);
  const copyStatus = feedback?.scope === copyScope ? feedback.status : null;
  const copyFailure = copyStatus === 'failed' ? t('复制失败，请选择日志文本后手动复制。') : '';
  const copyAnnouncement = copyStatus === 'copied' ? t('已复制完整日志') : '';

  useLayoutEffect(() => () => {
    copyRequest.current += 1;
    window.clearTimeout(copyTimer.current);
  }, [copyScope]);

  async function copyLog() {
    const request = ++copyRequest.current;
    window.clearTimeout(copyTimer.current);
    setFeedback(null);
    let status: CopyStatus = 'copied';
    try {
      await navigator.clipboard.writeText(copyText);
    } catch {
      status = 'failed';
    }
    if (request !== copyRequest.current) return;
    setFeedback({ scope: copyScope, status });
    if (status === 'copied') copyTimer.current = window.setTimeout(() => setFeedback(null), 2000);
  }

  return <Dialog open={open} onOpenChange={expanded => setSnapshot(expanded ? text : null)}>
    {message && <section className="error-log" aria-label={title}>
      <header className="error-log-toolbar">
        <div className="error-log-heading">
          <Icon name="warning" />
          <h2>{title}</h2>
          <span className="error-log-count">{formatLineCount(inlineLog.count)}</span>
        </div>
        <div className="error-log-actions">
          <CopyLogButton copied={!open && copyStatus === 'copied'} onCopy={() => void copyLog()} />
          <DialogTrigger asChild>
            <Button ref={expandRef} type="button" variant="outline" size="sm"><Icon name="screen-full" />{t('全屏展开')}</Button>
          </DialogTrigger>
        </div>
      </header>
      {!open && copyFailure && <p className="error-log-copy-failure" role="alert">{copyFailure}</p>}
      <div role={role}>
        <div className="error-log-body" role="region" aria-label={bodyLabel} tabIndex={0}><pre>{inlineLog.content}</pre></div>
      </div>
      <span className="sr-only" role="status">{!open && copyAnnouncement}</span>
    </section>}
    <DialogContent
      className="error-log-dialog"
      overlayClassName="error-log-dialog-overlay"
      showCloseButton={false}
      aria-describedby={undefined}
      onOpenAutoFocus={event => { event.preventDefault(); exitRef.current?.focus({ preventScroll: true }); }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        (expandRef.current ?? fallbackFocusRef.current)?.focus({ preventScroll: true });
      }}
    >
      <header className="error-log-toolbar">
        <div className="error-log-heading">
          <Icon name="warning" />
          <DialogTitle>{title}</DialogTitle>
        </div>
        <div className="error-log-actions">
          <Button type="button" variant="ghost" size="sm" className="error-log-wrap" aria-pressed={wrap} onClick={() => setWrap(current => !current)}>
            <Icon name="word-wrap" />{t('自动换行')}
          </Button>
          <CopyLogButton copied={copyStatus === 'copied'} onCopy={() => void copyLog()} />
          <DialogClose asChild>
            <Button ref={exitRef} type="button" variant="outline" size="sm" aria-keyshortcuts="Escape">
              <Icon name="screen-normal" />{t('退出全屏')}<kbd aria-hidden="true">Esc</kbd>
            </Button>
          </DialogClose>
        </div>
      </header>
      <div className="error-log-body" role="region" aria-label={bodyLabel} tabIndex={0}><pre data-wrap={wrap}>{fullLog.content}</pre></div>
      <footer className="error-log-footer">
        <span><Icon name="output" />{formatLineCount(fullLog.count)}</span>
        <span className="error-log-footer-failure" role="alert">{copyFailure}</span>
        <span className="sr-only" role="status">{copyAnnouncement}</span>
      </footer>
    </DialogContent>
  </Dialog>;
}
