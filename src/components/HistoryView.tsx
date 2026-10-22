import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Group, Panel, Separator as ResizeHandle } from 'react-resizable-panels';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ChangeFileTree } from './ChangeFileTree';
import { CodeDiff } from './CodeDiff';
import { buildChangeTree } from '../lib/change-tree';
import { historyDateGroup, historyTime } from '../lib/history-display';
import { historyFileSnapshot } from '../lib/history-git';
import { useHistory } from '../lib/history-store';
import { nativeGit } from '../lib/native-git';
import { findWorktree, usePreferences, useWorkbench } from '../lib/store';
import type { FileSnapshot, GitBranch, Worktree } from '../lib/types';
import './history-view.css';

function Icon({ name }: { name: string }) {
  return <i className={`codicon codicon-${name}`} aria-hidden="true" />;
}

function CopyHash({ oid }: { oid: string }) {
  return <Button variant="ghost" size="icon-xs" className="history-copy" aria-label={`复制完整 Hash ${oid}`} title="复制完整 Hash" onClick={() => void navigator.clipboard.writeText(oid).then(() => toast.success('已复制完整 Hash')).catch(() => toast.error('复制失败，请在提交详情中选择 Hash 复制。'))}><Icon name="copy" /></Button>;
}

/** 历史范围只用于读取引用，不复用分支检出命令。 */
function HistoryReference({ worktree, reference, onChange }: { worktree: Worktree; reference: string | null; onChange: (value: string | null) => void }) {
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const repositories = useWorkbench(state => state.repositories);
  useEffect(() => {
    if (worktree.source !== 'native') return;
    let current = true;
    void nativeGit.branches(worktree.path).then(items => { if (current) { setBranches(items); setError(null); } }).catch(reason => { if (current) setError(String(reason)); });
    return () => { current = false; };
  }, [worktree.path, worktree.source, revision]);
  const items = worktree.source === 'native' ? branches.map(branch => ({ value: branch.fullName, label: `${branch.kind === 'remote' ? '远程 · ' : ''}${branch.name}` })) : repositories.find(repo => repo.worktrees.some(item => item.id === worktree.id))?.worktrees.map(item => ({ value: `refs/heads/${item.branch}`, label: item.branch })) ?? [];
  return <div className="history-reference">
    <Icon name="git-branch" />
    <select onPointerDown={() => setRevision(value => value + 1)} onFocus={() => setRevision(value => value + 1)} aria-label="历史分支筛选" title="只筛选提交历史，不切换工作区分支" value={reference ?? ''} onChange={event => onChange(event.target.value || null)}>
      <option value="">{worktree.detached ? '当前 HEAD' : '当前分支'}</option>
      {reference && !items.some(item => item.value === reference) && <option value={reference}>{reference.replace(/^refs\/(heads|remotes)\//, '')}</option>}
      {items.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select>
    {error && <Button variant="ghost" size="icon-xs" title={error} aria-label="重新读取历史分支" onClick={() => setRevision(value => value + 1)}><Icon name="warning" /></Button>}
  </div>;
}

/** 三栏历史仅使用独立会话；本地更改的选择、草稿和暂存操作不会进入此视图。 */
export function HistoryView({ worktree }: { worktree: Worktree }) {
  const state = useHistory.getState();
  const session = useHistory(state => state.sessions[worktree.id]);
  const { ensure, checkForUpdates, setQuery } = state;
  const { fontSize, historyDiffMode, setHistoryDiffMode, layout, setLayout } = usePreferences();
  const search = session?.searchInput ?? '';
  const setSearch = (value: string) => state.setSearchInput(worktree, value);

  useEffect(() => { void ensure(worktree); }, [ensure, worktree]);
  useEffect(() => {
    const current = findWorktree(useWorkbench.getState().repositories, worktree.id);
    if (current) void checkForUpdates(current);
  }, [checkForUpdates, worktree.id]);
  useEffect(() => {
    const timer = setTimeout(() => { void setQuery(worktree, search); }, 300);
    return () => clearTimeout(timer);
  }, [search, setQuery, worktree]);

  const detail = session?.detail;
  const files = useMemo(() => (detail?.files ?? []).map(file => historyFileSnapshot(file)), [detail]);
  const nodes = useMemo(() => buildChangeTree(files), [files]);
  const selectedFile = detail?.files.find(file => file.path === session?.selectedPath);
  const selectionReady = detail?.commit.oid === session?.selectedOid && detail?.parentIndex === session?.parentIndex;
  const description = detail && (detail.message.startsWith(detail.commit.subject) ? detail.message.slice(detail.commit.subject.length).trim() : detail.message.trim());

  function renderFile(file: FileSnapshot, depth: number) {
    const selected = file.path === session?.selectedPath;
    return <div key={file.id} className={`file-row tree-file-row ${selected ? 'selected' : ''}`} style={{ '--file-depth': depth } as CSSProperties}>
      <button className="file-select" disabled={!selectionReady} aria-label={`历史文件：${file.path}`} aria-pressed={selected} title={file.git?.originalPath ? `${file.git.originalPath} → ${file.path}` : file.path} onClick={() => void state.selectFile(worktree, file.path)}>
        <Icon name="file-code" /><span className="file-copy"><span className="file-name">{file.path.split('/').pop()}</span></span><span className={`file-status status-${file.git?.statusIndex}`}>{file.git?.statusIndex}</span>
      </button>
    </div>;
  }

  return <section className="history-view" aria-label="提交历史">
    {session?.updated && <div className="history-update" role="status"><Icon name="info" /><span>历史已更新，刷新查看</span><Button variant="ghost" size="sm" disabled={session.loading} onClick={() => void state.refresh(worktree)}>刷新历史</Button></div>}
    {session?.checkError && <div className="history-update history-error" role="status"><span>{session.checkError}</span><Button variant="ghost" size="sm" onClick={() => void state.checkForUpdates(worktree)}>重试检查</Button></div>}
    <Group orientation="horizontal" className="history-columns" defaultLayout={layout.historyCommits ? { historyCommits: layout.historyCommits, historyFiles: layout.historyFiles, historyDiff: layout.historyDiff } : undefined} onLayoutChanged={setLayout}>
      <Panel id="historyCommits" defaultSize="30%" minSize="230px">
        <section className="history-commits" aria-label="提交列表">
          <div className="history-filters">
            <HistoryReference worktree={worktree} reference={session?.reference ?? null} onChange={reference => void state.setReference(worktree, reference)} />
            <div className="history-search"><Icon name="search" /><Input aria-label="搜索提交历史" placeholder="搜索说明、作者或 Hash" value={search} onChange={event => setSearch(event.target.value)} autoComplete="off" spellCheck={false} />{search && <Button variant="ghost" size="icon-xs" aria-label="清除历史搜索" onClick={() => setSearch('')}><Icon name="close" /></Button>}</div>
          </div>
          {session?.error && <div className="history-inline-error" role="alert"><p>{session.error}</p><Button variant="outline" size="sm" disabled={session.loading} onClick={() => void state.refresh(worktree)}>重试历史</Button></div>}
          <div className="history-list" aria-label="提交记录" aria-busy={session?.loading}>
            {session?.loading && <div className="history-progress" role="status"><Icon name="loading spin" />正在读取提交…</div>}
            {session?.commits.map((commit, index, commits) => {
              const group = historyDateGroup(commit.committedAt);
              const showGroup = index === 0 || historyDateGroup(commits[index - 1].committedAt) !== group;
              return <Fragment key={commit.oid}>
                {showGroup && <div className="history-date">{group}</div>}
                <div className={`history-row ${session.selectedOid === commit.oid ? 'selected' : ''}`}>
                  <button className="history-select" aria-label={`查看提交：${commit.subject}`} aria-pressed={session.selectedOid === commit.oid} title={`${commit.subject}\n${commit.authorName} <${commit.authorEmail}>\n${commit.oid}`} onClick={() => void state.selectCommit(worktree, commit.oid)}>
                    <Icon name={commit.parents.length > 1 ? 'git-merge' : 'git-commit'} />
                    <span className="history-row-copy"><strong>{commit.subject || '（无提交说明）'}</strong><span><span className="history-author">{commit.authorName}</span><time dateTime={new Date(commit.committedAt * 1000).toISOString()}>{historyTime(commit.committedAt)}</time><code>{commit.shortHash}</code></span></span>
                  </button><CopyHash oid={commit.oid} />
                </div>
              </Fragment>;
            })}
            {!session?.loading && session?.initialized && !session.commits.length && <div className="history-placeholder"><Icon name="history" /><p>{session.query ? '没有匹配的提交' : '此分支还没有提交记录'}</p>{session.query && <span>尝试其他说明、作者或完整 Hash。</span>}</div>}
            {session?.nextCursor && <Button variant="ghost" className="history-load-more" disabled={session.loading || session.loadingMore} onClick={() => void state.loadMore(worktree)}><Icon name={session.loadingMore ? 'loading spin' : 'arrow-down'} />{session.loadingMore ? '正在加载…' : '加载更多提交'}</Button>}
          </div>
          <div className="history-list-footer"><Icon name="history" /><span>{session?.commits.length ?? 0} 条{session?.nextCursor ? ' · 可加载更多' : ''}</span><span className="history-readonly"><Icon name="lock" />历史只读</span></div>
        </section>
      </Panel>
      <ResizeHandle className="resize-handle" aria-label="调整提交列表宽度" />
      <Panel id="historyFiles" defaultSize="23%" minSize="180px">
        <section className="history-files" aria-label="历史变更文件">
          <div className="history-files-heading"><div><strong>变更文件</strong><Badge className="count-badge">{files.length}</Badge></div>{detail && <span><code>{detail.commit.shortHash}</code><CopyHash oid={detail.commit.oid} /></span>}</div>
          {session?.detailLoading && <div className="history-progress" role="status"><Icon name="loading spin" />正在读取变更…</div>}
          {session?.detailError && <div className="history-inline-error" role="alert"><p>{session.detailError}</p><Button variant="outline" size="sm" onClick={() => { if (session.selectedOid) void state.selectCommit(worktree, session.selectedOid); }}>重试提交</Button></div>}
          <div className="file-groups history-tree"><ChangeFileTree nodes={nodes} selectedFileId={session?.selectedPath ?? null} renderFile={renderFile} />
            {!session?.detailLoading && !files.length && <p className="history-files-empty">{detail ? '此提交相对此父提交没有文件变更' : '选择提交，查看变更文件'}</p>}
          </div>
        </section>
      </Panel>
      <ResizeHandle className="resize-handle" aria-label="调整历史文件列表宽度" />
      <Panel id="historyDiff" defaultSize="47%" minSize="330px">
        <section className="history-reader" aria-label="历史差异">
          {detail && <header className="history-commit-detail"><h1>{detail.commit.subject || '（无提交说明）'}</h1><div className="history-commit-meta"><span title={detail.commit.authorEmail}>{detail.commit.authorName}</span><time>{new Date(detail.commit.committedAt * 1000).toLocaleString('zh-CN', { hour12: false })}</time><code title={detail.commit.oid}>{detail.commit.shortHash}</code><CopyHash oid={detail.commit.oid} /></div>{description && <p className="history-description">{description}</p>}
            {detail.commit.parents.length > 1 && <label className="history-parent">比较对象<select aria-label="比较父提交" value={session?.parentIndex ?? 0} onChange={event => void state.selectParent(worktree, Number(event.target.value))}>{detail.commit.parents.map((parent, index) => <option key={parent} value={index}>父提交 {index + 1} · {parent.slice(0, 7)}</option>)}</select></label>}
          </header>}
          {selectedFile && (selectedFile.oldPath || selectedFile.oldMode !== selectedFile.newMode) && <div className="history-file-metadata">{selectedFile.oldPath && <span>{selectedFile.oldPath} → {selectedFile.path}</span>}{selectedFile.oldMode !== '000000' && selectedFile.newMode !== '000000' && selectedFile.oldMode !== selectedFile.newMode && <span>文件模式 {selectedFile.oldMode} → {selectedFile.newMode}</span>}</div>}
          {session?.diff.file && !session.diff.notice && (session.diff.loading || session.diff.error) && <div className="history-update" role="status"><span>{session.diff.error ?? '正在读取历史差异…'}</span>{session.diff.error && <Button variant="ghost" size="sm" onClick={() => { if (session.selectedPath) void state.selectFile(worktree, session.selectedPath); }}>重试差异</Button>}</div>}
          {((session?.diff.loading || session?.diff.error) && !session.diff.file) || session?.diff.notice ? <div className="diff-message" aria-live="polite"><Icon name={session.diff.loading ? 'loading spin' : session.diff.error ? 'warning' : 'file'} /><h2>{session.diff.loading ? '正在读取历史差异…' : session.diff.error ? '无法读取历史差异' : '文件差异说明'}</h2><p>{session.diff.error ?? session.diff.notice}</p>{session.diff.error && <Button variant="outline" onClick={() => { if (session.selectedPath) void state.selectFile(worktree, session.selectedPath); }}>重试差异</Button>}</div> : session?.diff.file ? <CodeDiff file={session.diff.file} area="staged" worktreeId={`${worktree.id}/history/${detail?.commit.oid}/${detail?.parentIndex}`} fontSize={fontSize} mode={historyDiffMode} onModeChange={setHistoryDiffMode} originalLabel={detail?.parentOid ? `父提交 ${(detail.parentIndex + 1)} · ${detail.parentOid.slice(0, 7)}` : '空版本（首次提交）'} modifiedLabel={`当前提交 · ${detail?.commit.shortHash}`} onClose={() => state.closeFile(worktree)} /> : <div className="diff-message"><Icon name="diff" /><h2>{detail && !files.length ? '此提交没有文件变更' : '选择文件，查看历史差异'}</h2><p>历史文件来自 Git 提交快照，只读展示。</p></div>}
        </section>
      </Panel>
    </Group>
  </section>;
}
