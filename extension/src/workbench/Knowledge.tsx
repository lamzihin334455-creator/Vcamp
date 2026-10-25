import {WebSources} from './WebSources';
import { useEffect, useRef, useState } from 'react';
import type { ApplicationClient } from '../contracts/application';
import { knowledgeEntries, type KnowledgeArtifact, type KnowledgeEntry } from '../contracts/knowledge';
import type { ModuleProps } from '../app/modules';
const basisLabel = { video: 'AI 归类：视频依据', explanation: 'AI 归类：解释', inference: 'AI 归类：推断 · 请核实' };
export function useKnowledge(client: ApplicationClient, workspaceId: string | null, artifactId?: string) {
  const [artifacts, setArtifacts] = useState<KnowledgeArtifact[]>([]), [error, setError] = useState('');
  useEffect(() => {
    let alive = true, seq = 0;
    setArtifacts([]); setError('');
    if (!workspaceId || !client.knowledge) return;
    const refresh = async () => {
      const token = ++seq;
      try {
        const value = await client.knowledge!({type:'knowledge.query',workspaceId,...(artifactId?{artifactId}:{})});
        if (alive && token === seq) { setArtifacts(value.artifacts.filter((a):a is KnowledgeArtifact=>a.type==='html')); setError(''); }
      } catch {
        if (alive && token === seq) setError('交互知识读取失败，格式或来源可能无效。');
      }
    };
    const dispose = client.subscribe(() => void refresh(), state => { if (state === 'connected') void refresh(); });
    void refresh();
    return () => { alive = false; dispose(); };
  }, [client,workspaceId,artifactId]);
  return { artifacts, error };
}
export function KnowledgeDocumentView({ artifact, follow }: {
  artifact: KnowledgeArtifact;
  follow?: (entry: KnowledgeEntry) => void;
}) {
  const doc = artifact.document, [category, setCategory] = useState('all'), [focus, setFocus] = useState('');
  const entries = knowledgeEntries(doc), focused = entries.find(e => e.id === focus);
  const entry = (e: KnowledgeEntry) => <details key={e.id} className="knowledge-entry" id={`knowledge-${e.id}`}><summary>{e.title}<small>{basisLabel[e.basis]}</small></summary>
    <p>{e.body}</p>
    <small>未提供定位</small>{follow && <button onClick={() => follow(e)}>深入追问：{e.title}</button>}</details>;
  return <article className="knowledge-document">
    <h1>{doc.title}</h1>
    <p className="knowledge-summary">{doc.summary}</p>
    <p className="note-meta">AI 整理 · 依据标签由 AI 归类，系统未做事实认证；格式通过不代表事实正确</p>
 <h2>分类知识</h2>
    <label>浏览分类<select aria-label="浏览分类" value={category} onChange={e => setCategory(e.target.value)}><option value="all">全部分类</option>{doc.groups.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label>
 {doc.groups.filter(g => category === 'all' || category === g.id).map(g => <section key={g.id}><h3>{g.title}</h3>{g.items.map(entry)}</section>)}
 <h2>概念与关系</h2>{doc.concepts.length ? doc.concepts.map(entry) : <p>本次没有单列概念。</p>}
 {doc.relations.map((r, i) => <div className="knowledge-relation" key={i}><button onClick={() => setFocus(r.from)}>{entries.find(e => e.id === r.from)?.title}</button><span>{r.label} →</span><button onClick={() => setFocus(r.to)}>{entries.find(e => e.id === r.to)?.title}</button></div>)}
 {focused && <aside aria-live="polite"><h3>{focused.title}</h3><p>{focused.body}</p>
    <small>{basisLabel[focused.basis]}</small>{follow && <button onClick={() => follow(focused)}>追问此关联内容</button>}<button onClick={() => setFocus('')}>关闭关系详情</button></aside>}
 <h2>问答与后续问题</h2>{doc.questions.length ? doc.questions.map(entry) : <p>本次没有单列问答；可选择知识条目自定义问题。</p>}
 <WebSources evidence={artifact.webEvidence}/>
 </article>;
}
export function KnowledgeWorkbench({ client, view, artifactId, onKnowledgeFollowup, onChromeChange }: ModuleProps) {
  const readonly = view.mode === 'readonly', fixed = artifactId ?? (readonly ? new URLSearchParams(location.search).get('knowledgeId') ?? undefined : undefined);
  const query = useKnowledge(client, view.workspaceId, fixed), [selected, setSelected] = useState(fixed ?? ''), [entry, setEntry] = useState<KnowledgeEntry>(), [question, setQuestion] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { setSelected(fixed ?? ''); setEntry(undefined); setError(''); }, [fixed, view.workspaceId]);
  const questionInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (entry) {
    questionInput.current?.focus();
    questionInput.current?.scrollIntoView({ block: 'center' });
  } }, [entry]);
  const artifact = query.artifacts.find(a => a.id === selected) ?? (!selected ? query.artifacts[0] : undefined);
  useEffect(() => { onChromeChange?.({ title: artifact?.title, status: artifact ? '旧版结构化知识 · 已保存' : '暂无已保存交互知识', items: query.artifacts.map(item => ({ id: item.id, title: item.title, select: () => { setSelected(item.id); setEntry(undefined); } })), actions: [] }); }, [onChromeChange, artifact, query.artifacts, readonly]);
  async function prepare() { if (!artifact || !entry || !onKnowledgeFollowup || !question.trim())
    return; setBusy(true); const okay = await onKnowledgeFollowup(artifact, entry, question); if (okay)
    setEntry(undefined);
  else
    setError('未能准备追问，请确认已回到原视频分 P，且来源对话和成果仍有效。'); setBusy(false); }
  return <div className="knowledge-workbench">{!onChromeChange && !readonly && <label>交互知识版本<select aria-label="交互知识版本" value={artifact?.id ?? ''} onChange={e => { setSelected(e.target.value); setEntry(undefined); }}>{query.artifacts.map(a => <option value={a.id} key={a.id}>{a.title}</option>)}</select></label>}
 {(query.error || error) && <p role="alert">{query.error || error}</p>}{artifact ? <>
 <KnowledgeDocumentView key={artifact.id} artifact={artifact} follow={!readonly && !artifact.sourceDeleted && onKnowledgeFollowup ? e => { setEntry(e); setQuestion(e.question); setError(''); } : undefined}/>
 {entry && !readonly && <section className="knowledge-followup" aria-label="准备深入追问"><h2>准备深入追问</h2><p>仅附带以下条目；原有完整草稿将保留，不合并发送。</p><blockquote><strong>{entry.title}</strong><p>{entry.body}</p>
    <small>{basisLabel[entry.basis]}</small></blockquote><label>编辑追问问题<textarea ref={questionInput} aria-label="编辑追问问题" value={question} maxLength={8000} onChange={e => setQuestion(e.target.value)}/></label><button disabled={busy || !question.trim()} onClick={() => void prepare()}>带入来源对话确认</button><button disabled={busy} onClick={() => setEntry(undefined)}>取消追问</button><p>确认后仍需在来源 Chat 显式发送，才会调用模型。</p></section>}</> : <p>{query.error ? '此资料不可用。' : '暂无旧版结构化知识。新页面请在问答中选择 HTML。'}</p>}</div>;
}
