import type {StyleRevision} from '../contracts/style';
import { parseHtmlPage } from '../contracts/html-page';
import { validateEvidenceStructure, validateVisionAudit, validateVisionReview } from '../contracts/vision';
import { knowledgeEntries, parseKnowledge, type KnowledgeContext } from '../contracts/knowledge';
import { ApplicationError } from '../contracts/application';
import type { ChatRequestSnapshot, FrozenHistoryEntry } from '../contracts/generation';
import type { ReferenceSnapshot } from '../contracts/artifact';
import type { RoleRevision } from '../contracts/role';
import type { TemplateRevision } from '../contracts/template';
import { backupTables, canonical, rowKey, type BackupPayload } from './backup-format';

// Validation is graph validation, independent of the merge target. Tombstones
// retain their dependencies; they do not grant cross-Chat reference permission.
export function validateBackup(p: BackupPayload): void {
  const bad = () => { throw new ApplicationError('invalid-message'); };
  const unsupported = () => { throw new ApplicationError('unsupported-capability'); };
  const primary = new Set<string>();
  if (backupTables.reduce((sum, t) => sum + p[t].length, 0) + p.workspaces.reduce((sum, w) => sum + w.chats.length, 0) > 20000) throw new ApplicationError('resource-limit');
  for (const table of backupTables) for (const row of p[table]) { const id = rowKey(table, row); if (primary.has(id)) bad(); primary.add(id); }
  const workspaces = new Map(p.workspaces.map(w => [w.id, w])), artifacts = new Map(p.artifacts.map(a => [a.id, a])), revisions = new Map(p.noteRevisions.map(r => [r.id, r])), versions = new Map(p.subtitleVersions.map(v => [v.id, v])), jobs = new Map(p.jobs.map(j => [j.jobId, j])), templateRevisions = new Map(p.templateRevisions.map(r => [r.revisionId, r])), templates = new Map(p.templates.map(t => [t.id, t]));
  const roleRevisions = new Map(p.roleRevisions.map(r => [r.revisionId, r]));
  const styleRevisions=new Map(p.styleRevisions.map(row=>[row.revisionId,row]));
  const styles=new Map(p.styles.map(row=>[row.id,row]));
  const style=(snapshot:StyleRevision|undefined)=>{if(snapshot&&canonical(styleRevisions.get(snapshot.revisionId))!==canonical(snapshot))bad();};
  const roles = new Map(p.roles.map(r => [r.id, r]));
  const chats = new Map<string, { workspaceId: string; row: BackupPayload['workspaces'][number]['chats'][number] }>();
  const attempts = new Map<string, string>(), messages = new Set<string>();
  const requestIds = new Set(p.jobs.map(j => j.snapshot.snapshotId)), executionIds = new Set(p.jobs.flatMap(j => j.attempts.map(a => a.attemptId)));
  if (requestIds.size !== p.jobs.length || [...requestIds].some(id => primary.has(id) || executionIds.has(id))) bad();
  const referenceVersions = new Map<string, string>(), contentVersions = new Map<string, string>();
  const storedContent = new Map<string, { entry: FrozenHistoryEntry; workspaceId: string; chatId: string }>();
  for (const ws of p.workspaces) {
    if (ws.id !== JSON.stringify([ws.source.platform, ws.source.videoId, ws.source.partId])) bad();
    for (const chat of ws.chats) { if (primary.has(chat.id)) bad(); primary.add(chat.id); chats.set(chat.id, { workspaceId: ws.id, row: chat }); }
    if (ws.recentChatId && !ws.chats.some(c => c.id === ws.recentChatId)) bad();
    for (const id of ws.subtitleVersionIds ?? []) if (versions.get(id)?.workspaceId !== ws.id) bad();
    if (ws.analysisSource && ws.analysisSource.kind !== 'native' && versions.get(ws.analysisSource.versionId)?.workspaceId !== ws.id) bad();
    for (const chat of ws.chats) for (const entry of chat.messages ?? []) {
      if (!storedContent.has(entry.contentVersionId)) storedContent.set(entry.contentVersionId, { entry, workspaceId: ws.id, chatId: chat.id });
    }
  }
  const belongs = (workspaceId: string, chatId?: string) => { if (!workspaces.has(workspaceId) || chatId && chats.get(chatId)?.workspaceId !== workspaceId) bad(); };
  const template = (snapshot: TemplateRevision | undefined) => {
    if (snapshot && canonical(templateRevisions.get(snapshot.revisionId)) !== canonical(snapshot)) bad();
  };
  const role = (snapshot: RoleRevision | undefined) => { if (snapshot && canonical(roleRevisions.get(snapshot.revisionId)) !== canonical(snapshot)) bad(); };
  const refs = (ids: readonly string[], snapshots: readonly ReferenceSnapshot[] | undefined, workspaceId: string, chatId: string) => {
    if (new Set(ids).size !== ids.length || ids.length !== (snapshots?.length ?? 0)) bad();
    for (const s of snapshots ?? []) {
      const content = canonical(s), old = referenceVersions.get(s.snapshotId);
      if (!s.snapshotId || requestIds.has(s.snapshotId) || primary.has(s.snapshotId) || executionIds.has(s.snapshotId) || old !== undefined && old !== content) bad();
      referenceVersions.set(s.snapshotId, content);
      const a = artifacts.get(s.artifactId), r = revisions.get(s.revisionId);
      if (!ids.includes(s.snapshotId) || !a || a.type !== 'markdown' || a.workspaceId !== workspaceId || a.sourceChatId !== chatId || !r || r.artifactId !== a.id || r.revision !== s.revision || r.content !== s.content) bad();
    }
  };
  const knowledge=(selection:{artifactId:string;revisionId:string;entryId:string},workspaceId:string,chatId:string,context?:KnowledgeContext)=>{
    const a=artifacts.get(selection.artifactId),r=revisions.get(selection.revisionId);
    if(!a||a.type!=='html'||a.workspaceId!==workspaceId||a.sourceChatId!==chatId||!r||r.artifactId!==a.id||r.id!==a.revisionId)bad();
    let doc;try{doc=parseKnowledge(r!.content);}catch{bad();}const entry=knowledgeEntries(doc!).find(e=>e.id===selection.entryId);if(!entry)bad();
    if(context){const value=canonical(context),old=referenceVersions.get(context.snapshotId);if(primary.has(context.snapshotId)||requestIds.has(context.snapshotId)||executionIds.has(context.snapshotId)||old!==undefined&&old!==value||canonical(entry)!==canonical(context.entry)||context.title!==doc!.title)bad();referenceVersions.set(context.snapshotId,value);}
  };
  const images=(ids:readonly string[],workspaceId:string,chatId:string)=>{
    if(new Set(ids).size!==ids.length)bad();
    for(const id of ids){const image=p.attachments.find(a=>a.id===id);if(!image||image.workspaceId!==workspaceId||image.chatId!==chatId)bad();}
  };
  for(const image of p.attachments){belongs(image.workspaceId,image.chatId);const ws=workspaces.get(image.workspaceId)!;if(ws.source.videoId!==image.source.videoId||ws.source.partId!==image.source.partId)bad();}
  const frozen = (entry: FrozenHistoryEntry, workspaceId: string, chatId: string, request?: ChatRequestSnapshot) => {
    let comparisonRole = entry.roleSnapshot, comparisonImages = entry.attachmentIds;
    const original = storedContent.get(entry.contentVersionId);
    // History is a request projection of the original version. Artifact
    // requests may omit its role, and image budgeting may retain an ordered
    // subset. Compare against the original only for those proven omissions;
    // never inject omitted data into the request or alter saved history.
    if (request && original?.workspaceId === workspaceId && original.chatId === chatId && original.entry.messageId === entry.messageId && original.entry.role === entry.role) {
      if (!entry.roleSnapshot && request.outputType !== 'chat' && !request.roleSnapshot) comparisonRole = original.entry.roleSnapshot;
      let matched = 0;
      for (const id of original.entry.attachmentIds) if (id === entry.attachmentIds[matched]) matched++;
      if (matched === entry.attachmentIds.length) comparisonImages = original.entry.attachmentIds;
    }
    const content = canonical([workspaceId, chatId, entry.messageId, entry.role, entry.text, entry.referenceSnapshotIds, entry.referenceSnapshots ?? [], entry.templateSnapshot ?? null, comparisonRole ?? null, comparisonImages, entry.knowledgeContext ?? null]);
    const old = contentVersions.get(entry.contentVersionId);
    if (!entry.messageId || !entry.contentVersionId || old !== undefined && old !== content) bad();
    contentVersions.set(entry.contentVersionId, content);
    if(entry.knowledgeContext)knowledge(entry.knowledgeContext,workspaceId,chatId,entry.knowledgeContext);
    images(entry.attachmentIds,workspaceId,chatId);
    refs(entry.referenceSnapshotIds, entry.referenceSnapshots, workspaceId, chatId); template(entry.templateSnapshot); role(entry.roleSnapshot);
  };
  for (const t of p.templates) {
    const r = templateRevisions.get(t.revisionId);
    if (!r || r.templateId !== t.id || r.revision !== t.revision || canonical({ ...r, id: t.id, builtin: t.builtin, deleted: t.deleted, templateId: undefined, backupOriginalId: t.backupOriginalId, sortIndex: t.sortIndex }) !== canonical(t)) bad();
    const numbers = p.templateRevisions.filter(r => r.templateId === t.id).map(r => r.revision); if (new Set(numbers).size !== numbers.length || numbers.length !== t.revision || numbers.some(n => n > t.revision)) bad();
  }
  for (const r of p.templateRevisions) if (!templates.has(r.templateId)) bad();
  for (const r of p.roles) {
    const version = roleRevisions.get(r.revisionId);
    if (!version || version.roleId !== r.id || version.revision !== r.revision || canonical({ ...version, id: r.id, builtin: r.builtin, deleted: r.deleted, roleId: undefined, backupOriginalId: r.backupOriginalId }) !== canonical(r)) bad();
    const numbers = p.roleRevisions.filter(v => v.roleId === r.id).map(v => v.revision);
    if (new Set(numbers).size !== numbers.length || numbers.length !== r.revision || numbers.some(n => n > r.revision)) bad();
  }
  for (const r of p.roleRevisions) if (!roles.has(r.roleId)) bad();
  for (const r of p.styles) {
    const version = styleRevisions.get(r.revisionId);
    if (!version || version.styleId !== r.id || version.revision !== r.revision || canonical({ ...version, id: r.id, builtin: r.builtin, deleted: r.deleted, styleId: undefined, backupOriginalId: r.backupOriginalId, sortIndex: r.sortIndex }) !== canonical(r)) bad();
    const numbers = p.styleRevisions.filter(v => v.styleId === r.id).map(v => v.revision);
    if (new Set(numbers).size !== numbers.length || numbers.length !== r.revision || numbers.some(n => n > r.revision)) bad();
  }
  for (const r of p.styleRevisions) if (!styles.has(r.styleId)) bad();
  for (const j of p.jobs) {
    const target = j.snapshot.target, ws = workspaces.get(target.workspaceId);
    belongs(target.workspaceId, target.kind === 'chat' ? target.chatId : undefined);
    if (!ws || ws.source.videoId !== j.basis.binding.videoId || ws.source.partId !== j.basis.binding.partId) bad();
    if (j.basis.subtitleVersionId && versions.get(j.basis.subtitleVersionId)?.workspaceId !== target.workspaceId) bad();
    for (const a of j.attempts) {
      if (attempts.has(a.attemptId) || primary.has(a.attemptId) || a.coverage.covered > a.coverage.total || a.coverage.ranges.some(r => r.lastCue < r.firstCue || r.lastCue >= j.basis.cueCount)) bad();
      if(a.webEvidence&&(!('webEnabled' in j.snapshot)||!j.snapshot.webEnabled))bad();
      if(a.state==='completed'&&'webEnabled' in j.snapshot&&j.snapshot.webEnabled&&(!a.webEvidence||!['cited','uncited','unmatched'].includes(a.webEvidence.status)))bad();
      if (a.visual) {
        if (target.kind !== 'chat' || !('autoVision' in j.snapshot) || !j.snapshot.autoVision) bad();
        if (target.kind === 'chat') images(a.visual.attachmentIds, target.workspaceId, target.chatId);
        if(!a.visual.audit&&(new Set(a.visual.plan?.times).size !== (a.visual.plan?.times.length ?? 0) || a.visual.frozen && a.visual.resolution === 'images' && a.visual.plan?.times.length !== a.visual.attachmentIds.length))bad();
        if(a.visual.audit){
          const v=a.visual,s=j.snapshot as ChatRequestSnapshot;
          if(!v.evidencePlan)bad();
          try{
            const duration=j.basis.mediaDuration??s.mediaDuration??Infinity,history=s.historyProjection.flatMap(h=>[...h.attachmentIds]);
            validateEvidenceStructure(v.evidencePlan,duration,[...s.attachmentIds,...history],j.basis.cueCount);
            validateVisionAudit(v.audit!,v.evidencePlan!,v.attachmentIds,duration,history,v.review);
            if(v.review)validateVisionReview(v.review,v.evidencePlan!,v.audit!,duration,[...s.attachmentIds,...history],j.basis.cueCount);
          }catch{bad();}
          if(v.frozen&&v.resolution==='images')for(const group of new Set(v.audit!.slots.map(s=>s.group))){const slots=v.audit!.slots.filter(s=>s.group===group),count=slots.filter(s=>v.audit!.frames.some(f=>f.slotKey===s.key)).length;if(count&&count!==slots.length)bad();}
        }
      }
      attempts.set(a.attemptId, j.jobId);
    }
    if (target.kind === 'chat') {
      if (!('input' in j.snapshot)) bad();
      const s = j.snapshot as ChatRequestSnapshot;
      if (s.outputType !== 'html' && (s.knowledgeFormat||s.htmlFormat) || s.knowledgeFormat&&s.htmlFormat) unsupported();
      if(s.htmlFormat&&s.templateSnapshot&&s.templateSnapshot.outputProtocol!=='html-page-v1')bad();
      if (s.knowledgeFormat && s.templateSnapshot && s.templateSnapshot.outputProtocol !== 'knowledge-json-v1') bad();
      if (s.evidence && !s.evidence.includedSources.includes('conversation_history') && s.historyProjection.length) bad();
      if (s.knowledgeContext)knowledge(s.knowledgeContext,target.workspaceId,target.chatId,s.knowledgeContext);
      images(s.attachmentIds,target.workspaceId,target.chatId);
      refs(s.referenceSnapshotIds, s.referenceSnapshots, target.workspaceId, target.chatId); template(s.templateSnapshot); role(s.roleSnapshot);style(s.htmlStyle);
      if (s.templateRevisionId !== (s.templateSnapshot?.revisionId ?? null)) bad();
      if (s.analysisSource && s.analysisSource.kind !== 'native' && versions.get(s.analysisSource.versionId)?.workspaceId !== target.workspaceId) bad();
      for (const e of s.historyProjection) {
        frozen(e, target.workspaceId, target.chatId, s);
        if (!chats.get(target.chatId)!.row.messages?.some(m => m.messageId === e.messageId && m.role === e.role)) bad();
      }
    } else {
      if (!('source' in j.snapshot)) bad();
      const s = j.snapshot as Extract<BackupPayload['jobs'][number]['snapshot'], { source: unknown }>;
      if ('subtitleVersionId' in s.source && versions.get(s.source.subtitleVersionId)?.workspaceId !== target.workspaceId) bad();
    }
  }
  for (const ws of p.workspaces) for (const c of ws.chats) {
    const d = c.draft;
    if(d.knowledgeFollowup)knowledge(d.knowledgeFollowup,ws.id,c.id);
    images(d.attachmentIds,ws.id,c.id);
    for(const desc of d.attachments??[]){if(!d.attachmentIds.includes(desc.attachmentId)||desc.workspaceId!==ws.id||desc.chatId!==c.id||desc.mimeType!=='image/png')bad();}
    if(d.htmlStyle&&styleRevisions.get(d.htmlStyle.revisionId)?.styleId!==d.htmlStyle.styleId)bad();
    if (d.role && roleRevisions.get(d.role.revisionId)?.roleId !== d.role.roleId) bad();
    if (d.template && templateRevisions.get(d.template.revisionId)?.templateId !== d.template.templateId) bad();
    for (const id of d.referenceIds) if (artifacts.get(id)?.type !== 'markdown' || artifacts.get(id)?.workspaceId !== ws.id || artifacts.get(id)?.sourceChatId !== c.id) bad();
    for (const desc of d.references ?? []) if (!d.referenceIds.includes(desc.artifactId) || desc.workspaceId !== ws.id || desc.sourceChatId !== c.id) bad();
    for (const m of c.messages ?? []) {
      if (messages.has(m.messageId)) bad(); messages.add(m.messageId);
      frozen(m, ws.id, c.id);
      if (m.kind === 'scribble-operation') { if (!p.scribbles.some(s => s.id === m.scribbleId && s.workspaceId === ws.id) || m.jobId || m.attemptId) bad(); continue; }
      const j = jobs.get(m.jobId), t = j?.snapshot.target;
      if (!j || t?.kind !== 'chat' || t.workspaceId !== ws.id || t.chatId !== c.id || m.attemptId && attempts.get(m.attemptId) !== m.jobId) bad();
      if (m.role === 'user' && j && 'input' in j.snapshot && (m.attemptId || m.contentVersionId !== j.snapshot.snapshotId || m.text !== j.snapshot.input || canonical(m.attachmentIds)!==canonical(j.snapshot.attachmentIds) || canonical(m.referenceSnapshotIds) !== canonical(j.snapshot.referenceSnapshotIds) || canonical(m.templateSnapshot ?? null) !== canonical(j.snapshot.templateSnapshot ?? null) || canonical(m.roleSnapshot??null)!==canonical(j.snapshot.roleSnapshot??null) || canonical(m.knowledgeContext??null)!==canonical(j.snapshot.knowledgeContext??null))) bad();
      if (m.role === 'assistant' && (!m.attemptId || j?.attempts.find(a => a.attemptId === m.attemptId)?.state !== m.state)) bad();
      if(m.webEvidence&&m.role!=='assistant'||m.role==='assistant'&&canonical(m.webEvidence??null)!==canonical(j?.attempts.find(a=>a.attemptId===m.attemptId)?.webEvidence??null))bad();
      if (m.outputType === 'html' && (!j || !('input' in j.snapshot) || j.snapshot.outputType !== 'html')) unsupported();
      if (m.artifactId && (artifacts.get(m.artifactId)?.sourceChatId !== c.id || artifacts.get(m.artifactId)?.workspaceId !== ws.id)) bad();
    }
  }
  for (const a of p.artifacts) {
    belongs(a.workspaceId, a.sourceChatId);
    const j = jobs.get(a.jobId), t = j?.snapshot.target, r = revisions.get(a.revisionId);
    if (t?.kind !== 'chat' || t.workspaceId !== a.workspaceId || t.chatId !== a.sourceChatId || attempts.get(a.attemptId) !== a.jobId || !r || r.artifactId !== a.id || r.revision !== a.revision || j?.attempts.find(at => at.attemptId === a.attemptId)?.state !== 'completed') bad();
    if(canonical(a.webEvidence??null)!==canonical(j?.attempts.find(at=>at.attemptId===a.attemptId)?.webEvidence??null))bad();
    if(a.type==='html-page'){if(a.pageVersion!==1||a.revision!==1||!j||!('input' in j.snapshot)||j.snapshot.outputType!=='html'||j.snapshot.htmlFormat!==1)bad();try{parseHtmlPage(r!.content);}catch{bad();}}else if(a.pageVersion)bad();else if(a.type==='html'){if(a.revision!==1||!j||!('input' in j.snapshot)||j.snapshot.outputType!=='html'||j.snapshot.knowledgeFormat!==1)bad();try{parseKnowledge(r!.content);}catch{bad();}}else if(j&&'input' in j.snapshot&&j.snapshot.outputType!=='markdown')bad();
    const numbers = p.noteRevisions.filter(r => r.artifactId === a.id).map(r => r.revision); if (new Set(numbers).size !== numbers.length || numbers.length !== a.revision || numbers.some(n => n > a.revision)) bad();
  }
  for (const r of p.noteRevisions) if (!artifacts.has(r.artifactId)) bad();
  for (const v of p.subtitleVersions) {
    belongs(v.workspaceId); const j = jobs.get(v.jobId), t = j?.snapshot.target;
    if (t?.kind !== 'subtitle' || t.workspaceId !== v.workspaceId || t.operation !== v.type || attempts.get(v.attemptId) !== v.jobId || j?.attempts.find(a => a.attemptId === v.attemptId)?.state !== 'completed') bad();
    if ('subtitleVersionId' in v.source && versions.get(v.source.subtitleVersionId)?.workspaceId !== v.workspaceId) bad();
    // Reject cyclic saved-subtitle dependency chains.
    const visited = new Set<string>(); let current: typeof v | undefined = v;
    while (current && 'subtitleVersionId' in current.source) { if (visited.has(current.id)) bad(); visited.add(current.id); current = versions.get(current.source.subtitleVersionId); }
  }
  for (const s of p.scribbles) belongs(s.workspaceId);
  for (const f of p.favorites) {
    const t = f.target;
    if (!p.folders.some(folder => folder.id === f.folderId) || f.id !== JSON.stringify([f.folderId, t.workspaceId, t.entityType, t.id])) bad();
    belongs(t.workspaceId);
    if (t.entityType === 'workspace' && t.id !== t.workspaceId || t.entityType === 'chat' && chats.get(t.id)?.workspaceId !== t.workspaceId || (t.entityType === 'markdown'||t.entityType === 'html') && (artifacts.get(t.id)?.workspaceId !== t.workspaceId || artifacts.get(t.id)?.type !== t.entityType && !(t.entityType==='html'&&artifacts.get(t.id)?.type==='html-page')) || t.entityType === 'scribble' && !p.scribbles.some(s => s.id === t.id && s.workspaceId === t.workspaceId) || t.entityType === 'subtitle' && versions.get(t.id)?.workspaceId !== t.workspaceId) bad();
  }
}
