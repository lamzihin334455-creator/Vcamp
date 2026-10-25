import { PickerPopover } from '../app/PickerMotion';
import { isRetiredGenerationTemplate, type Template } from '../contracts/template';
import { useEffect, useRef, useState } from 'react';
import type { ApplicationClient, Draft } from '../contracts/application';
import type { MarkdownArtifact } from '../contracts/artifact';
import { consumeMention, mentionSearchMatches, type Mention } from '../app/mention';

export function ReferencePicker({ client, workspaceId, chatId, draft, selectedTemplateName, disabled, change, templates = [], selectTemplate, clearTemplate, startScribble, startCapture, addImages, visionEnabled, toggleVision, visionAvailable = true, trigger, close, restoreFocus }: {
  client: ApplicationClient; workspaceId: string | null; chatId: string | null; draft: Draft | null; disabled: boolean;
  selectedTemplateName?: string;
  change: (patch: Partial<Draft>) => void; templates?: Template[];
  selectTemplate: (template: Template, patch: Partial<Draft>) => void;
  clearTemplate: (patch: Partial<Draft>) => void;
  startCapture: () => void; addImages: () => void; startScribble: (patch: Partial<Draft>) => void;
  visionAvailable?: boolean; visionEnabled: boolean; toggleVision: (patch: Partial<Draft>) => void;
  trigger: Mention | 'more' | null; close: () => void; restoreFocus: () => void;
}) {
  const [notes, setNotes] = useState<MarkdownArtifact[]>([]), [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const query = trigger && trigger !== 'more' ? trigger.query.toLowerCase() : '';
  useEffect(() => {
    setNotes([]); setError('');
    if (!workspaceId || !chatId || !client.artifacts) return;
    let disposed = false, sequence = 0;
    const refresh = async () => {
      const token = ++sequence;
      try {
        const result = await client.artifacts!({ type: 'artifact.query', workspaceId, sourceChatId: chatId });
        if (!disposed && token === sequence) { setNotes(result.artifacts); setError(''); }
      } catch { if (!disposed) setError('笔记列表读取失败'); }
    };
    const dispose = client.subscribe(() => void refresh(), state => { if (state === 'connected') void refresh(); });
    void refresh(); return () => { disposed = true; dispose(); };
  }, [client, workspaceId, chatId]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node) && !(e.target as Element).closest('[aria-label="输入草稿"], [aria-label="更多输入操作"]')) close();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [close]);
  const textPatch = (): Partial<Draft> => trigger && trigger !== 'more' ? { text: consumeMention(draft?.text ?? '', trigger) } : {};
  function finish() { close(); restoreFocus(); }
  function toggle(id: string, consume = false) {
    if (!draft || disabled) return;
    const ids = draft.referenceIds.includes(id) ? draft.referenceIds.filter(value => value !== id) : [...draft.referenceIds, id];
    change({ ...(consume ? textPatch() : {}), referenceIds: ids, references: ids.flatMap(id => {
      const note = notes.find(note => note.id === id);
      if (note) return [{ artifactId: id, workspaceId: note.workspaceId, sourceChatId: note.sourceChatId, title: note.title, type: 'markdown' as const }];
      return draft.references?.filter(item => item.artifactId === id) ?? [];
    }) });
    if (consume) finish();
  }
  return <div className="reference-picker" ref={root} onKeyDown={e => {
    if (e.key === 'Escape') { e.stopPropagation(); finish(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const buttons = [...root.current!.querySelectorAll<HTMLButtonElement>('.reference-menu button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (buttons.length) { e.preventDefault(); buttons[(current + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus(); }
    }
  }}>
    {(!!draft?.template||!!draft?.referenceIds.length||visionEnabled) && <div className="reference-tags" aria-label="本次已调用内容">{draft?.template&&<button disabled={disabled} aria-label={`移除任务模板 ${selectedTemplateName??'当前模板'}`} onClick={()=>clearTemplate({})}>模板：{selectedTemplateName??'当前模板'}<span aria-hidden="true">×</span></button>}{visionEnabled&&<button disabled={disabled} aria-label="关闭自主识别画面" onClick={()=>toggleVision({})}>自主识别画面<span aria-hidden="true">×</span></button>}{draft?.referenceIds.map(id => {
      const note = notes.find(note => note.id === id), title = note?.title ?? draft.references?.find(item => item.artifactId === id)?.title ?? '笔记';
      return <button key={id} disabled={disabled} aria-label={`移除引用 ${title}`} onClick={() => toggle(id)}>{title}{!note && '（不可引用）'}<span aria-hidden="true">×</span></button>;
    })}</div>}
    <PickerPopover open={!!trigger && !disabled} id="mention-menu" className="reference-menu" role="group" label={trigger==='more'?'输入功能':trigger?.kind==='tools'?'特殊工具':'选择任务模板'}>
      {(trigger==='more'||trigger?.kind==='tools')&&<>
        <p>特殊工具</p>
        {[
          {name:'写随笔',run:()=>{startScribble(textPatch());finish();}},
          {name:visionEnabled?'关闭自主识别画面':'开启自主识别画面',disabled:!visionAvailable&&!visionEnabled,pressed:visionEnabled,detail:'按需求取帧并核验重要画面',run:()=>{toggleVision(textPatch());finish();}},
          {name:'添加图片',disabled:!visionAvailable,run:()=>{change(textPatch());finish();addImages();}},
          {name:'截取当前画面',disabled:!visionAvailable,run:()=>{change(textPatch());finish();startCapture();}}
        ].filter(tool=>mentionSearchMatches(tool.name,query)).map(tool=><button key={tool.name} disabled={tool.disabled} title={tool.disabled?'当前服务暂不支持视觉功能':undefined} aria-pressed={tool.pressed} onClick={tool.run}>{tool.name}{tool.detail&&<small>{tool.detail}</small>}</button>)}
        {trigger==='more'&&!!notes.length&&<><p>引用当前对话笔记</p>{notes.map(note=><button key={note.id} aria-pressed={draft?.referenceIds.includes(note.id)} onClick={()=>toggle(note.id)}>{note.title}</button>)}</>}
        {error&&<p role="alert">{error}</p>}
      </>}
      {(trigger==='more'||trigger&&trigger.kind!=='tools')&&<>
        <p>{query ? `搜索模板：${query}` : '任务模板'}</p>
        {templates.filter(t=>!isRetiredGenerationTemplate(t)&&mentionSearchMatches(t.name,query)).map(template=><button key={template.id} title={template.description} aria-pressed={draft?.template?.revisionId===template.revisionId} onClick={()=>{selectTemplate(template,textPatch());finish();}}>{template.name}</button>)}
        {!templates.some(t=>!isRetiredGenerationTemplate(t)&&mentionSearchMatches(t.name,query))&&<p>没有匹配的模板</p>}
      </>}
      <button className="text-button" onClick={finish}>取消</button>
    </PickerPopover>
  </div>;
}
