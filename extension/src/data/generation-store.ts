import {outputLimits} from '../contracts/output-limits';
import type {StyleRevision} from '../contracts/style';
import {resolveStyleRevision} from '../workbench/style-presets';
import { parseHtmlPage } from '../contracts/html-page';
import { selectedKnowledge } from './knowledge-store';
import {webOptions,webEvidenceSchema,relateWebAnswer,type WebEvidence} from '../contracts/web';
import { parseKnowledge } from '../contracts/knowledge';
import { timingFingerprint } from '../generation/subtitle-context';
import {subtitleInputLimits,subtitleProcessingLimits} from '../contracts/subtitle-limits';
import { IndexedSubtitleStore, validVersion } from './subtitle-store';
import type { SubtitleVersion } from '../contracts/subtitles';
import { ApplicationError } from '../contracts/application';
import { cueSchema, type Cue } from '../contracts/video';
import { jobView, terminal, type Attempt, type ChatMessage, type ChatRequestSnapshot, type Coverage, type GenerationFailure, type GenerationJob, type GenerationView, type JobState, type RequestTarget, type SubtitleBasis, type SubtitleRequestSnapshot } from '../contracts/generation';
import { databaseTransaction } from './database';
import type { StoredWorkspace } from './indexed-store';
import type { StoredArtifact, NoteRevision, ReferenceSnapshot } from '../contracts/artifact';
import { isLegacyHtmlTemplate, requiredTemplateSources, type TemplateRevision } from '../contracts/template';
import type { RoleRevision } from '../contracts/role';
import { resolveRoleRevision } from '../workbench/role-presets';
import { resolveTemplateRevision } from '../workbench/template-presets';
import type { Attachment } from '../contracts/attachment';
import { IndexedAttachmentStore, ownedImages } from './attachment-store';
import { validateImage } from './image-validation';
import { visionStageSchema, validateEvidenceStructure, validateVisionAudit, validateVisionReview, refinementWindows, type VisionStage } from '../contracts/vision';
import type { CapturedFrame } from '../contracts/attachment';
import { imageBudget } from './image-validation';
import { generationDiagnosticSchema, type GenerationDiagnostic } from '../contracts/generation-diagnostic';
import type { FrozenEvidence, RequestPlanningContext } from '../contracts/evidence';
import {withWebPermission} from '../contracts/evidence';
import {recentHistory} from '../generation/history-context';
import {imageLimits} from '../contracts/attachment';

const sameSlot = (a: RequestTarget, b: RequestTarget) => a.kind === b.kind && a.workspaceId === b.workspaceId && (a.kind === 'subtitle' || (b.kind === 'chat' && a.chatId === b.chatId));
const newAttempt = (): Attempt => ({ attemptId: crypto.randomUUID(), state: 'queued', text: '', error: null, executor: null, claimed: false, completionToken: null, coverage: { total: 0, covered: 0, ranges: [] } });
const active = (job: GenerationJob) => !terminal(job.attempts.at(-1)!.state);
type Result = { kind: 'subtitle'; cues: Cue[] };

export class IndexedGenerationStore {
  constructor(private name = 'vcamp') {}
  get subtitleStore() { return new IndexedSubtitleStore(this.name); }
  private transaction<T>(mode: IDBTransactionMode, operation: (tx: IDBTransaction, done: (value: T) => void, fail: (error: ApplicationError) => void) => void) {
    return databaseTransaction(this.name, ['workspaces', 'jobs', 'subtitleVersions', 'artifacts', 'noteRevisions', 'templateRevisions', 'roleRevisions', 'styleRevisions', 'attachments'], mode, operation);
  }
  list(): Promise<GenerationJob[]> {
    return this.transaction('readonly', (tx, done) => { const request = tx.objectStore('jobs').getAll(); request.onsuccess = () => done(request.result); });
  }
  get(jobId: string): Promise<GenerationJob | undefined> {
    return this.transaction('readonly', (tx, done) => { const request = tx.objectStore('jobs').get(jobId); request.onsuccess = () => done(request.result); });
  }
  planningContext(target: Extract<RequestTarget, { kind: 'chat' }>, expectedRevision: number): Promise<RequestPlanningContext> {
    return this.transaction('readonly', (tx, done, fail) => {
      const workspace = tx.objectStore('workspaces').get(target.workspaceId), templates = tx.objectStore('templateRevisions').getAll();
      templates.onsuccess = () => {
        try {
          const record: StoredWorkspace | undefined = workspace.result;
          const chat = record?.chats.find(row => row.id === target.chatId && !row.deleted);
          if (!record || record.deleted || !chat) throw new ApplicationError('not-found');
          const draft = chat.draft.knowledgeFollowup ? { ...chat.draft, text: chat.draft.knowledgeFollowup.question, outputType: 'chat' as const, template: null } : chat.draft;
          if (draft.revision !== expectedRevision) throw new ApplicationError('revision-conflict');
          if (!draft.modelId || (!draft.text.trim() && !draft.template && !draft.attachmentIds.length)) throw new ApplicationError('invalid-message');
          const template = draft.template ? resolveTemplateRevision(draft.template.templateId, draft.template.revisionId, templates.result) : undefined;
          if (draft.template && !template) throw new ApplicationError('not-found');
          if (isLegacyHtmlTemplate(template) || template?.outputProtocol === 'knowledge-json-v1') throw new ApplicationError('legacy-knowledge');
          done({ request: draft.text, outputType: draft.outputType, modelId: draft.modelId, ...(template ? { templateRequirements: template.requirements } : {}), requiredSources: requiredTemplateSources(template), explicitSources: [...(draft.visionEnabled ? ['video_frames' as const] : []), ...(draft.webEnabled ? ['web' as const] : [])], hasConversationHistory: Boolean((chat.messages ?? []).some(message => message.kind !== 'scribble-operation')) });
        } catch (error) { fail(error instanceof ApplicationError ? error : new ApplicationError('storage-failed')); }
      };
    });
  }
  view(target: RequestTarget): Promise<GenerationView> {
    return this.transaction('readonly', (tx, done, fail) => {
      const workspaces = tx.objectStore('workspaces').get(target.workspaceId);
      const jobs = tx.objectStore('jobs').getAll();
      jobs.onsuccess = () => {
        const record: StoredWorkspace | undefined = workspaces.result;
        const chat = record?.chats.find(chat => target.kind === 'chat' && chat.id === target.chatId && !chat.deleted);
        if (!record || record.deleted || (target.kind === 'chat' && !chat)) return fail(new ApplicationError('not-found'));
        done({ target, messages: (chat?.messages ?? []).map(message => ({ ...message, referenceSnapshots: message.referenceSnapshots ? [...message.referenceSnapshots] : undefined, referenceSnapshotIds: [...message.referenceSnapshotIds], attachmentIds: [...message.attachmentIds] })), jobs: (jobs.result as GenerationJob[]).filter(job => sameSlot(job.snapshot.target, target)).map(jobView) });
      };
    });
  }
  private freeze(target: RequestTarget, basis: SubtitleBasis, create: (record: StoredWorkspace, artifacts: StoredArtifact[], revisions: NoteRevision[], templates: TemplateRevision[], subtitleVersions: SubtitleVersion[], images:Attachment[], roles: RoleRevision[], styles:StyleRevision[]) => ChatRequestSnapshot | SubtitleRequestSnapshot): Promise<GenerationJob> {
    return this.transaction('readwrite', (tx, done, fail) => {
      const rows = tx.objectStore('workspaces'), jobs = tx.objectStore('jobs');
      const workspace = rows.get(target.workspaceId), all = jobs.getAll();
      const artifacts = target.kind === 'chat' ? tx.objectStore('artifacts').getAll() : undefined;
      const revisions = target.kind === 'chat' ? tx.objectStore('noteRevisions').getAll() : undefined;
      const templates = target.kind === 'chat' ? tx.objectStore('templateRevisions').getAll() : undefined;
      const roles = target.kind === 'chat' ? tx.objectStore('roleRevisions').getAll() : undefined;
      const styles=target.kind==='chat'?tx.objectStore('styleRevisions').getAll():undefined;
      const images = tx.objectStore('attachments').getAll();
      const versions = tx.objectStore('subtitleVersions').getAll();
      versions.onsuccess = () => {
        try {
          const record: StoredWorkspace | undefined = workspace.result;
          if (!record || record.deleted) throw new ApplicationError('not-found');
          if (record.source.videoId !== basis.binding.videoId || record.source.partId !== basis.binding.partId) throw new ApplicationError('forbidden');
          const pending = (all.result as GenerationJob[]).filter(active);
          if (pending.length >= 10) throw new ApplicationError('resource-limit');
          if (target.kind === 'chat' && pending.some(job => sameSlot(job.snapshot.target, target))) throw new ApplicationError('task-busy');
          const snapshot = create(record, artifacts?.result ?? [], revisions?.result ?? [], templates?.result ?? [], versions.result, images.result, roles?.result ?? [], styles?.result??[]);
          const job: GenerationJob = { jobId: crypto.randomUUID(), snapshot: structuredClone(snapshot), basis: structuredClone(basis), seq: 1, attempts: [newAttempt()] };
          if (target.kind === 'chat') {
            const chat = record.chats.find(chat => chat.id === target.chatId)!;
            chat.messages ??= [];
            chat.messages.push({ messageId: `${job.jobId}:user`, contentVersionId: snapshot.snapshotId, role: 'user', text: (snapshot as ChatRequestSnapshot).input,
              ...((snapshot as ChatRequestSnapshot).roleSnapshot ? { roleSnapshot: (snapshot as ChatRequestSnapshot).roleSnapshot } : {}),
              ...((snapshot as ChatRequestSnapshot).knowledgeContext ? {knowledgeContext:(snapshot as ChatRequestSnapshot).knowledgeContext} : {}), referenceSnapshotIds: [...(snapshot as ChatRequestSnapshot).referenceSnapshotIds], referenceSnapshots: [...((snapshot as ChatRequestSnapshot).referenceSnapshots ?? [])], ...((snapshot as ChatRequestSnapshot).templateSnapshot ? { templateSnapshot: (snapshot as ChatRequestSnapshot).templateSnapshot } : {}), attachmentIds: [...(snapshot as ChatRequestSnapshot).attachmentIds], jobId: job.jobId, attemptId: null, state: 'completed' });
            chat.draft = chat.draft.knowledgeFollowup ? { ...chat.draft, revision: chat.draft.revision + 1, knowledgeFollowup: undefined } : { ...chat.draft, revision: chat.draft.revision + 1, text: '', outputType: 'chat', template: null, referenceIds: [], attachmentIds: [], references: [], attachments: [] };
            rows.put(record);
          }
          jobs.add(job); done(job);
        } catch (error) { fail(error instanceof ApplicationError ? error : new ApplicationError('storage-failed')); }
      };
    });
  }
  freezeChat(target: Extract<RequestTarget, { kind: 'chat' }>, expectedRevision: number, basis: SubtitleBasis, visionDeclared=false, autoVision=false, evidence?: FrozenEvidence, applyRoleToArtifacts=false, providerConnection?: ChatRequestSnapshot['providerConnection']) {
    return this.freeze(target, basis, (record, artifacts, revisions, templates, versions, images, roles, styles) => {
      const chat = record.chats.find(chat => chat.id === target.chatId && !chat.deleted);
      if (!chat) throw new ApplicationError('forbidden');
      const selected = record.analysisSource ?? { kind: 'native' };
      if (selected.kind !== 'native') {
        validVersion(versions, target.workspaceId, selected.versionId);
        if (basis.subtitleVersionId !== selected.versionId) throw new ApplicationError('source-changed');
      } else if (basis.subtitleVersionId || selected.language && basis.language !== selected.language) throw new ApplicationError('source-changed');
      const followup=chat.draft.knowledgeFollowup;
      if (followup && chat.draft.scribble) throw new ApplicationError('invalid-message');
      const knowledgeContext=followup ? selectedKnowledge(artifacts,revisions,target.workspaceId,target.chatId,followup) : undefined;
      const draft = followup ? {...chat.draft,text:followup.question,outputType:'chat' as const,template:null,referenceIds:[],references:[],attachmentIds:[],attachments:[]} : chat.draft;
      if (draft.revision !== expectedRevision) throw new ApplicationError('revision-conflict');
      if ((!draft.text.trim() && !draft.template && !draft.attachmentIds.length) || !draft.modelId) throw new ApplicationError('invalid-message');
      const template = draft.template ? resolveTemplateRevision(draft.template.templateId, draft.template.revisionId, templates) : undefined;
      if (draft.template && !template) throw new ApplicationError('not-found');
      if (isLegacyHtmlTemplate(template) && !followup) throw new ApplicationError('legacy-knowledge');
      const style=draft.outputType==='html'&&draft.htmlStyle?resolveStyleRevision(draft.htmlStyle.styleId,draft.htmlStyle.revisionId,styles):undefined;
      if(draft.outputType==='html'&&draft.htmlStyle&&!style)throw new ApplicationError('not-found');
      const roleSelection=(draft.outputType==='chat'||applyRoleToArtifacts)?draft.role:null;
      const role = roleSelection ? resolveRoleRevision(roleSelection.roleId, roleSelection.revisionId, roles) : undefined;
      if (roleSelection && !role) throw new ApplicationError('not-found');
      if (template && template.outputType !== draft.outputType) throw new ApplicationError('forbidden');
      if (draft.scribble) throw new ApplicationError('unsupported-capability');
      if(draft.attachments?.some(a=>!draft.attachmentIds.includes(a.attachmentId)||a.workspaceId!==target.workspaceId||a.chatId!==target.chatId))throw new ApplicationError('forbidden');
      if (draft.references?.some(item => !draft.referenceIds.includes(item.artifactId))) throw new ApplicationError('invalid-message');
      const referenceSnapshots: ReferenceSnapshot[] = [...new Set(draft.referenceIds)].map(id => {
        const note = artifacts.find(note => note.id === id);
        if (!note || note.deleted || note.type !== 'markdown' || note.workspaceId !== target.workspaceId || note.sourceChatId !== target.chatId || !record.chats.some(chat => chat.id === note.sourceChatId && !chat.deleted)) throw new ApplicationError('forbidden');
        const revision = revisions.find(revision => revision.id === note.revisionId && revision.artifactId === note.id && revision.revision === note.revision);
        if (!revision) throw new ApplicationError('not-found');
        return { snapshotId: crypto.randomUUID(), artifactId: note.id, revisionId: revision.id, revision: revision.revision, title: note.title, content: revision.content };
      });
      const availableHistory = (evidence && !evidence.includedSources.includes('conversation_history') ? [] : (chat.messages ?? [])).filter(message => message.kind !== 'scribble-operation' && (message.role === 'user' || message.state === 'completed' && (!message.outputType || message.outputType === 'chat'))).map(({ messageId, contentVersionId, role, text, referenceSnapshotIds, referenceSnapshots, templateSnapshot, roleSnapshot, knowledgeContext, attachmentIds }) => ({ messageId, contentVersionId, role, text, referenceSnapshotIds, ...(knowledgeContext ? {knowledgeContext} : {}), ...(referenceSnapshots ? { referenceSnapshots } : {}), ...(templateSnapshot ? { templateSnapshot } : {}), ...((draft.outputType==='chat'||applyRoleToArtifacts)&&roleSnapshot ? { roleSnapshot } : {}), attachmentIds }));
      const referenceLength = (references: readonly ReferenceSnapshot[] | undefined) => (references ?? []).reduce((size, item) => size + item.content.length + item.title.length, 0);
      const currentImages=ownedImages(images,draft.attachmentIds,target);
      imageBudget(currentImages);
      const plannedVision = evidence?.includedSources.includes('video_frames') ?? autoVision;
      // Freeze a bounded candidate pool. The evidence planner selects actual
      // historical images later; do not reserve three worst-case new images or
      // drop a whole textual turn merely because its image is not replayed.
      let remainingImages=visionDeclared?imageLimits.count-currentImages.length:0;
      let remainingBytes=imageLimits.totalBytes-currentImages.reduce((n,image)=>n+image.bytes,0);
      const frozenImageIds=new Set(draft.attachmentIds);
      const historyWithImages=[...availableHistory].reverse().map(entry=>{
        const attachmentIds=entry.attachmentIds.filter(id=>{
          if(frozenImageIds.has(id))return false;
          const image=images.find(image=>image.id===id);
          if(!image||remainingImages<=0||image.bytes>remainingBytes)return false;
          frozenImageIds.add(id);remainingImages--;remainingBytes-=image.bytes;return true;
        });return {...entry,attachmentIds};
      }).reverse();
      const historyProjection=recentHistory(historyWithImages,{chars:36000,images:Infinity,bytes:Infinity},entry=>({chars:JSON.stringify(entry).length,images:0,bytes:0}));
      const imageIds=[...draft.attachmentIds,...historyProjection.flatMap(h=>[...h.attachmentIds])];
      if(imageIds.length&&!visionDeclared)throw new ApplicationError('unsupported-capability');
      // Repeated historical references count toward the provider request budget.
      const owned=ownedImages(images,[...new Set(imageIds)],target);
      imageBudget(imageIds.map(id=>owned.find(image=>image.id===id)!));
      if (draft.text.length + (template?.requirements.length ?? 0) > 8000 || draft.text.length + (template?.requirements.length ?? 0) + (role?.instructions.length ?? 0) + (knowledgeContext ? JSON.stringify(knowledgeContext).length : 0) > 12000 || referenceLength(referenceSnapshots) > 12000) throw new ApplicationError('context-limit');
      const plannedWeb = draft.webEnabled === true;
      if(evidence)evidence=withWebPermission(evidence,plannedWeb);
      return { ...(providerConnection ? { providerConnection } : {}), ...(basis.mediaDuration?{mediaDuration:basis.mediaDuration}:{}), autoVision: plannedVision, ...(plannedVision?{visionReview:2 as const}:{}), ...(basis.visionOnly?{visionOnly:true}:{}), videoTitle: record.source.videoTitle ?? record.source.title, ...(record.source.partTitle ? { videoPartTitle: record.source.partTitle } : {}), ...(evidence ? { evidence } : {}), ...(plannedWeb?{web:webOptions()}:{}), snapshotId: crypto.randomUUID(), target, analysisSource: selected.kind !== 'native' ? { kind: 'version', versionId: selected.versionId, fingerprint: basis.fingerprint } : { kind: 'native', locator: basis.locator, fingerprint: basis.fingerprint }, ...(knowledgeContext ? {knowledgeContext} : {}), input: draft.text, outputType: draft.outputType, ...(draft.outputType === 'html' ? (template?.outputProtocol==='knowledge-json-v1'?{knowledgeFormat:1 as const}:{htmlFormat:1 as const}) : {}), modelId: draft.modelId, webEnabled: plannedWeb,
        ...(style?{htmlStyle:style}:{}), ...(role ? { roleSnapshot: role } : {}), templateRevisionId: template?.revisionId ?? null, ...(template ? { templateSnapshot: template } : {}), historyProjection, ...(historyProjection.length<availableHistory.length?{historyOmitted:availableHistory.length-historyProjection.length}:{}), referenceSnapshotIds: referenceSnapshots.map(reference => reference.snapshotId), referenceSnapshots, attachmentIds: [...draft.attachmentIds] };
    });
  }
  freezeSubtitle(snapshot: SubtitleRequestSnapshot, basis: SubtitleBasis) {
    if (snapshot.target.operation === 'translate' && !snapshot.targetLanguage) return Promise.reject(new ApplicationError('invalid-message'));
    return this.freeze(snapshot.target, basis, (_record, _artifacts, _notes, _templates, versions) => {
      if ('subtitleVersionId' in snapshot.source) {
        validVersion(versions, snapshot.target.workspaceId, snapshot.source.subtitleVersionId);
        if (basis.subtitleVersionId !== snapshot.source.subtitleVersionId) throw new ApplicationError('source-changed');
      } else if (snapshot.source.fingerprint !== basis.fingerprint || snapshot.source.locator !== basis.locator || basis.subtitleVersionId) throw new ApplicationError('source-changed');
      return snapshot;
    });
  }
  private mutate(jobId: string, update: (job: GenerationJob, record: StoredWorkspace, tx: IDBTransaction) => void): Promise<GenerationJob> {
    return this.transaction('readwrite', (tx, done, fail) => {
      const jobs = tx.objectStore('jobs'), rows = tx.objectStore('workspaces'), request = jobs.get(jobId);
      request.onsuccess = () => {
        const job: GenerationJob | undefined = request.result;
        if (!job) return fail(new ApplicationError('not-found'));
        const workspace = rows.get(job.snapshot.target.workspaceId);
        workspace.onsuccess = () => {
          try {
            const record: StoredWorkspace | undefined = workspace.result;
            if (!record || record.deleted || (job.snapshot.target.kind === 'chat' && !record.chats.some(chat => job.snapshot.target.kind === 'chat' && chat.id === job.snapshot.target.chatId && !chat.deleted))) {
              if (terminal(job.attempts.at(-1)!.state)) { done(job); return; }
              throw new ApplicationError('not-found');
            }
            update(job, record, tx);
            jobs.put(job); rows.put(record); done(job);
          } catch (error) { fail(error instanceof ApplicationError ? error : new ApplicationError('storage-failed')); }
        };
      };
    });
  }
  attach(jobId: string, attemptId: string, tabId: number) {
    return this.mutate(jobId, job => {
      const attempt = job.attempts.at(-1)!;
      if (attempt.attemptId !== attemptId || attempt.state !== 'queued') throw new ApplicationError('revision-conflict');
      attempt.executor = { tabId }; attempt.state = 'preparing'; job.seq++;
    });
  }
  async claim(jobId: string, attemptId: string, tabId: number): Promise<GenerationJob | null> {
    let accepted = false;
    const job = await this.mutate(jobId, job => {
      const attempt = job.attempts.at(-1)!;
      if (attempt.attemptId !== attemptId || attempt.executor?.tabId !== tabId || attempt.claimed || attempt.state !== 'preparing') return;
      attempt.claimed = true; attempt.state = 'running'; job.seq++; accepted = true;
    });
    return accepted ? job : null; // reloaded executor NEVER sends another POST
  }
  checkpoint(jobId: string, attemptId: string, seq: number, text: string, coverage: Coverage) {
    return this.mutate(jobId, (job, record) => {
      const attempt = job.attempts.at(-1)!;
      if (attempt.attemptId !== attemptId || terminal(attempt.state) || seq <= job.seq) return;
      if (attempt.state !== 'running' || !attempt.claimed) throw new ApplicationError('revision-conflict');
      if (seq !== job.seq + 1 || !text.startsWith(attempt.text)) throw new ApplicationError('revision-conflict');
      const visionOnly=job.snapshot.target.kind==='chat'&&(job.snapshot as ChatRequestSnapshot).visionOnly===true&&job.basis.cueCount===0;
      if (text.length > (job.snapshot.target.kind==='chat'?outputLimits.textChars:100000) || !Number.isInteger(coverage.total) || coverage.total < (visionOnly?0:1) || coverage.total > (job.snapshot.target.kind==='subtitle'?subtitleProcessingLimits.segments:subtitleInputLimits.segments) || !Number.isInteger(coverage.covered) || coverage.covered < attempt.coverage.covered || coverage.covered > coverage.total
        || coverage.ranges.length !== coverage.covered || (attempt.coverage.total && coverage.total !== attempt.coverage.total)
        || coverage.ranges.some((range, index) => !Number.isInteger(range.firstCue) || !Number.isInteger(range.lastCue) || range.firstCue !== (index ? coverage.ranges[index - 1].lastCue + 1 : 0) || range.lastCue < range.firstCue || range.lastCue >= job.basis.cueCount)
        || attempt.coverage.ranges.some((range, index) => JSON.stringify(range) !== JSON.stringify(coverage.ranges[index]))) throw new ApplicationError('invalid-message');
      attempt.text = text; attempt.coverage = structuredClone(coverage); job.seq = seq;
      this.message(job, record);
    });
  }
  subtitlePhase(jobId:string,attemptId:string,phase:NonNullable<Attempt['subtitlePhase']>){
    return this.mutate(jobId,job=>{const attempt=job.attempts.at(-1)!;if(attempt.attemptId!==attemptId||terminal(attempt.state))return;if(job.snapshot.target.kind!=='subtitle'||!attempt.claimed)throw new ApplicationError('forbidden');attempt.subtitlePhase=phase;job.seq++;});
  }
  committing(jobId:string,attemptId:string){
    return this.mutate(jobId,(job,record)=>{
      const attempt=job.attempts.at(-1)!;
      if(attempt.attemptId!==attemptId||terminal(attempt.state)||attempt.state==='committing')return;
      const visionOnly=(job.snapshot as ChatRequestSnapshot).visionOnly===true&&job.basis.cueCount===0;
      const covered=visionOnly?attempt.coverage.total===0&&attempt.coverage.covered===0&&!attempt.coverage.ranges.length:!!attempt.coverage.total&&attempt.coverage.covered===attempt.coverage.total&&attempt.coverage.ranges.at(-1)?.lastCue===job.basis.cueCount-1;
      if(job.snapshot.target.kind!=='chat'||attempt.state!=='running'||!attempt.claimed||!covered)throw new ApplicationError('invalid-message');
      const snapshot=job.snapshot as ChatRequestSnapshot;
      if(!['markdown','html'].includes(snapshot.outputType)||!attempt.text.trim())throw new ApplicationError('invalid-message');
      if(snapshot.outputType==='html'){
        if(snapshot.htmlFormat===1)parseHtmlPage(attempt.text);
        else{if(!snapshot.knowledgeFormat)throw new ApplicationError('legacy-knowledge');try{parseKnowledge(attempt.text);}catch{throw new ApplicationError('knowledge-format');}}
      }
      attempt.state='committing';job.seq++;this.message(job,record);
    });
  }
  diagnostic(jobId: string, attemptId: string, value: GenerationDiagnostic) {
    const diagnostic = generationDiagnosticSchema.parse(value);
    return this.mutate(jobId, job => {
      const attempt = job.attempts.at(-1)!;
      if (attempt.attemptId !== attemptId || terminal(attempt.state) || !attempt.claimed) return;
      attempt.diagnostics ??= [];
      if(diagnostic.purpose==='web-search'&&JSON.stringify(attempt.diagnostics.at(-1))===JSON.stringify(diagnostic))return;
      // Keep the final failure visible even after many context/planning calls.
      if (attempt.diagnostics.length >= 18) attempt.diagnostics.shift();
      attempt.diagnostics.push(diagnostic); job.seq++;
    });
  }
  async visual(jobId: string, attemptId: string, stage: VisionStage, frame?: CapturedFrame, slotKey?: string) {
    const integrity = frame ? await validateImage(frame) : undefined;
    if (frame && integrity) {
      const original = await this.get(jobId);
      if (!original || original.snapshot.target.kind !== 'chat' || original.attempts.at(-1)?.attemptId !== attemptId) throw new ApplicationError('not-found');
      const snapshot = original.snapshot as ChatRequestSnapshot, images = new IndexedAttachmentStore(this.name);
      const frozen = await images.forSnapshot(snapshot), prior = await images.read(snapshot.target, stage.attachmentIds, true);
      const all = [...frozen, ...prior], ids = [...new Set([...snapshot.attachmentIds, ...(stage.audit?.historyAttachmentIds??snapshot.historyProjection.flatMap(h => [...h.attachmentIds])), ...stage.attachmentIds])];
      imageBudget([...ids.map(id => all.find(image => image.id === id)!), { bytes: integrity.bytes } as Attachment]);
    }
    return this.mutate(jobId, (job, record, tx) => {
      const attempt = job.attempts.at(-1)!;
      if (attempt.attemptId !== attemptId || terminal(attempt.state) || !attempt.claimed || job.snapshot.target.kind !== 'chat') throw new ApplicationError('revision-conflict');
      if (attempt.visual?.frozen) throw new ApplicationError('revision-conflict');
      const value = visionStageSchema.parse(structuredClone(stage));
      if (JSON.stringify(value.attachmentIds) !== JSON.stringify(attempt.visual?.attachmentIds ?? [])) throw new ApplicationError('forbidden');
      const snapshot=job.snapshot as ChatRequestSnapshot;
      if(value.audit){
        if(!value.evidencePlan)throw new ApplicationError('invalid-message');
        try{
          const duration=job.basis.mediaDuration??snapshot.mediaDuration??Infinity,history=snapshot.historyProjection.flatMap(h=>[...h.attachmentIds]);
          validateEvidenceStructure(value.evidencePlan,duration,[...snapshot.attachmentIds,...history],job.basis.cueCount);
          validateVisionAudit(value.audit,value.evidencePlan,value.attachmentIds,duration,history,value.review);
          if(value.review)validateVisionReview(value.review,value.evidencePlan,value.audit,duration,[...snapshot.attachmentIds,...history],job.basis.cueCount);
        }catch{throw new ApplicationError('invalid-message');}
        if(JSON.stringify(value.audit.frames)!==JSON.stringify(attempt.visual?.audit?.frames??[]))throw new ApplicationError('forbidden');
      }
      if (frame && integrity) {
        if (value.phase !== 'capturing' || value.resolution !== 'images' || !value.plan || value.attachmentIds.length >= 6) throw new ApplicationError('forbidden');
        const slot=value.audit?.slots.find(s=>s.key===slotKey);
        if(value.audit){
          if(!slot||value.audit.frames.some(f=>f.slotKey===slotKey)||frame.time<slot.from-.1||frame.time>slot.to+.1)throw new ApplicationError('invalid-message');
        }else if (value.attachmentIds.length>=value.plan.times.length||Math.abs(frame.time-value.plan.times[value.attachmentIds.length])>.2) throw new ApplicationError('invalid-message');
        const target = job.snapshot.target;
        const image: Attachment = { ...frame, ...integrity, id: crypto.randomUUID(), workspaceId: target.workspaceId, chatId: target.chatId, mimeType: 'image/png', createdAt: Date.now(), source: { platform: job.basis.binding.platform, videoId: job.basis.binding.videoId, partId: job.basis.binding.partId } };
        // The final request budget is checked again with frozen history before POST.
        tx.objectStore('attachments').add(image); value.attachmentIds.push(image.id);
        if(value.audit&&slot)value.audit.frames.push({slotKey:slot.key,attachmentId:image.id,time:image.time,detail:slot.detail});
      }
      if (value.frozen && value.resolution === 'images') {
        if(!value.audit&&value.plan?.times.length!==value.attachmentIds.length)throw new ApplicationError('invalid-message');
        if(value.audit)for(const group of new Set(value.audit.slots.map(s=>s.group))){
          const slots=value.audit.slots.filter(s=>s.group===group),count=slots.filter(s=>value.audit!.frames.some(f=>f.slotKey===s.key)).length;
          if(count>0&&count!==slots.length)throw new ApplicationError('invalid-message');
        }
      }
      attempt.visual = value; attempt.state = value.phase === 'permission' ? 'awaiting-permission' : 'running'; job.seq++;
      this.message(job, record);
    });
  }
  /** Replace only this unfrozen attempt's automatic candidates. Validation and
   * attachment/message updates are one transaction, including multi-state groups. */
  async refineVisual(jobId:string,attemptId:string,stage:VisionStage,frames:readonly {slotKey:string;frame:CapturedFrame}[]){
    if(!frames.length||frames.length>2||new Set(frames.map(f=>f.slotKey)).size!==frames.length)throw new ApplicationError('invalid-message');
    const checked=await Promise.all(frames.map(async f=>({...f,integrity:await validateImage(f.frame)})));
    const original=await this.get(jobId),snapshot=original?.snapshot as ChatRequestSnapshot|undefined;
    if(!original||!snapshot||snapshot.target.kind!=='chat')throw new ApplicationError('not-found');
    const images=new IndexedAttachmentStore(this.name),all=[...await images.forSnapshot(snapshot),...await images.read(snapshot.target,stage.attachmentIds,true)];
    return this.mutate(jobId,(job,record,tx)=>{
      const attempt=job.attempts.at(-1)!,prior=attempt.visual;
      if(attempt.attemptId!==attemptId||terminal(attempt.state)||!attempt.claimed||prior?.frozen||prior?.phase!=='refining'||prior.review?.repairDecision!=='capture')throw new ApplicationError('revision-conflict');
      const value=visionStageSchema.parse(structuredClone(stage));
      if(!value.audit||!value.evidencePlan||!value.review||!prior.audit||!prior.evidencePlan
        ||JSON.stringify(value.attachmentIds)!==JSON.stringify(prior.attachmentIds)
        ||JSON.stringify(value.audit.frames)!==JSON.stringify(prior.audit.frames)
        ||JSON.stringify(value.audit.slots)!==JSON.stringify(prior.audit.slots)
        ||JSON.stringify(value.evidencePlan)!==JSON.stringify(prior.evidencePlan)
        ||JSON.stringify(value.review)!==JSON.stringify(prior.review))throw new ApplicationError('forbidden');
      const repairs=checked.map(f=>value.review!.repairs.find(r=>r.slotKey===f.slotKey&&r.state==='pending'));
      if(repairs.some(r=>!r))throw new ApplicationError('forbidden');
      const revised=refinementWindows(value.evidencePlan,value.audit,repairs as NonNullable<typeof repairs[number]>[]);
      value.evidencePlan=revised.plan;value.audit=revised.audit;
      if(value.plan)value.plan.times=value.audit.slots.map(s=>s.anchor);
      for(const {slotKey,frame,integrity} of checked){
        const slot=value.audit.slots.find(s=>s.key===slotKey)!;
        if(frame.time<slot.from-.1||frame.time>slot.to+.1)throw new ApplicationError('invalid-message');
        const old=value.audit.frames.find(f=>f.slotKey===slotKey),target=snapshot.target;
        if(old){
          if(snapshot.attachmentIds.includes(old.attachmentId)||snapshot.historyProjection.some(h=>h.attachmentIds.includes(old.attachmentId))||!prior.attachmentIds.includes(old.attachmentId))throw new ApplicationError('forbidden');
          const index=value.attachmentIds.indexOf(old.attachmentId);if(index<0)throw new ApplicationError('forbidden');
          value.attachmentIds.splice(index,1);value.audit.frames=value.audit.frames.filter(f=>f.slotKey!==slotKey);
          value.audit.candidates.forEach((c,index)=>{if(index<prior.audit!.candidates.length&&c.slotKey===slotKey)c.decision='superseded';});
          tx.objectStore('attachments').delete(old.attachmentId);
        }
        const image:Attachment={...frame,...integrity,id:crypto.randomUUID(),workspaceId:target.workspaceId,chatId:target.chatId,mimeType:'image/png',createdAt:Date.now(),source:{platform:job.basis.binding.platform,videoId:job.basis.binding.videoId,partId:job.basis.binding.partId}};
        value.attachmentIds.push(image.id);value.audit.frames.push({slotKey,attachmentId:image.id,time:image.time,detail:'original'});
        tx.objectStore('attachments').add(image);
        const repair=value.review.repairs.find(r=>r.slotKey===slotKey)!;repair.state='captured-unverified';repair.actualTime=image.time;
        all.push(image);
      }
      const history=snapshot.historyProjection.flatMap(h=>[...h.attachmentIds]),duration=job.basis.mediaDuration??snapshot.mediaDuration??Infinity;
      // A different repair group may have exhausted the round without an
      // adopted image. Its rejected proposal cannot change the stored window.
      value.audit.candidates=value.audit.candidates.filter(c=>c.decision==='superseded'||value.audit!.slots.some(s=>s.key===c.slotKey&&c.time>=s.from-.1&&c.time<=s.to+.1));
      const ids=[...new Set([...snapshot.attachmentIds,...value.audit.historyAttachmentIds,...value.attachmentIds])];
      imageBudget(ids.map(id=>all.find(i=>i.id===id)!));
      value.audit.budget.imageBytes=ids.reduce((n,id)=>n+all.find(i=>i.id===id)!.bytes,0);
      value.audit.budget.apiTokensUpperBound+=ids.length*1024-value.audit.budget.imageTokensUpperBound;
      value.audit.budget.imageTokensUpperBound=ids.length*1024;
      if(value.audit.budget.apiTokensUpperBound>value.audit.budget.tokenCeiling)throw new ApplicationError('resource-limit');
      if(value.attachmentIds.length>6)throw new ApplicationError('resource-limit');
      validateEvidenceStructure(value.evidencePlan,duration,[...snapshot.attachmentIds,...history],job.basis.cueCount);
      validateVisionAudit(value.audit,value.evidencePlan,value.attachmentIds,duration,history,value.review);
      for(const group of new Set(value.audit.slots.map(s=>s.group))){
        const slots=value.audit.slots.filter(s=>s.group===group),count=slots.filter(s=>value.audit!.frames.some(f=>f.slotKey===s.key)).length;
        if(count&&count!==slots.length)throw new ApplicationError('invalid-message');
      }
      validateVisionReview(value.review,value.evidencePlan,value.audit,duration,[...snapshot.attachmentIds,...history],job.basis.cueCount);
      attempt.visual=visionStageSchema.parse(value);job.seq++;this.message(job,record);
    });
  }
  webEvidence(jobId:string,attemptId:string,evidence:WebEvidence) {
    const value=webEvidenceSchema.parse(structuredClone(evidence));
    return this.mutate(jobId,(job,record)=>{
      const attempt=job.attempts.at(-1)!;
      if(attempt.attemptId!==attemptId||terminal(attempt.state))return;
      if(!attempt.claimed||!('webEnabled' in job.snapshot)||!job.snapshot.webEnabled)throw new ApplicationError('forbidden');
      if(attempt.webEvidence?.status==='retrieved'||!['searching','retrieved'].includes(value.status))throw new ApplicationError('revision-conflict');
      attempt.webEvidence=value;job.seq++;this.message(job,record);
    });
  }
  async decideVisual(jobId: string, choice: 'images' | 'subtitle' | 'keep') {
    return this.mutate(jobId, (job, record) => {
      const attempt = job.attempts.at(-1)!;
      if (attempt.state !== 'awaiting-permission' || !attempt.visual || attempt.visual.resolution || terminal(attempt.state)) throw new ApplicationError('revision-conflict');
      if (choice === 'images' && attempt.visual.issue !== 'permission') throw new ApplicationError('unsupported-capability');
      if(choice==='keep'&&attempt.visual.review?.repairDecision!=='pending')throw new ApplicationError('unsupported-capability');
      if(attempt.visual.review?.repairDecision==='pending')attempt.visual.review.repairDecision=choice==='images'?'capture':'keep';
      attempt.visual.resolution = choice==='keep'?'images':choice; job.seq++; this.message(job, record);
    });
  }
  private message(job: GenerationJob, record: StoredWorkspace) {
    const target = job.snapshot.target;
    if (target.kind !== 'chat') return;
    const chat = record.chats.find(chat => chat.id === target.chatId)!;
    const attempt = job.attempts.at(-1)!;
    chat.messages ??= [];
    const id = `${attempt.attemptId}:assistant`;
    const snapshot = job.snapshot as ChatRequestSnapshot;
    const message: ChatMessage = { messageId: id, contentVersionId: `${id}:${job.seq}`, role: 'assistant', text: attempt.text, referenceSnapshotIds: [], attachmentIds: [...(attempt.visual?.attachmentIds ?? [])], jobId: job.jobId, attemptId: attempt.attemptId, state: attempt.state,
      ...(attempt.webEvidence?{webEvidence:attempt.webEvidence}:{}), outputType: snapshot.outputType, ...((snapshot.outputType === 'markdown' || snapshot.outputType === 'html') && attempt.completionToken ? { artifactId: attempt.completionToken } : {}) };
    const index = chat.messages.findIndex(message => message.messageId === id);
    if (index === -1) chat.messages.push(message); else chat.messages[index] = message;
  }
  async finish(jobId: string, attemptId: string, state: Extract<JobState, 'completed' | 'stopped' | 'failed' | 'interrupted'>, error: GenerationFailure | null = null, completionToken: string | null = null, result?: Result) {
    const timings = result ? await timingFingerprint(result.cues) : undefined;
    return this.mutate(jobId, (job, record, tx) => {
      const attempt = job.attempts.at(-1)!;
      if (attempt.attemptId !== attemptId || terminal(attempt.state)) return;
      if(attempt.state==='committing'&&state==='stopped')return;
      if (state === 'completed') {
        if('webEnabled' in job.snapshot&&job.snapshot.webEnabled){
          if(attempt.webEvidence?.status!=='retrieved')throw new ApplicationError('web-no-sources');
          try {attempt.webEvidence=relateWebAnswer(attempt.webEvidence,attempt.text);}catch{throw new ApplicationError('web-protocol');}
        }
        const visionOnly=job.snapshot.target.kind==='chat'&&(job.snapshot as ChatRequestSnapshot).visionOnly===true&&job.basis.cueCount===0;
        const covered=visionOnly?attempt.coverage.total===0&&attempt.coverage.covered===0&&!attempt.coverage.ranges.length:!!attempt.coverage.total&&attempt.coverage.covered===attempt.coverage.total&&attempt.coverage.ranges.at(-1)?.lastCue===job.basis.cueCount-1;
        if (!['running','committing'].includes(attempt.state) || !attempt.claimed || !completionToken || !covered) throw new ApplicationError('invalid-message');
        if (job.snapshot.target.kind === 'subtitle') {
          if (result?.kind !== 'subtitle') throw new ApplicationError('invalid-message');
          record.subtitleVersionIds = [...(record.subtitleVersionIds ?? []), completionToken];
          const cues = result.cues.map(cue => cueSchema.parse(cue));
          if (cues.length !== job.basis.cueCount || cues.reduce((size, cue) => size + cue.content.length, 0) > subtitleProcessingLimits.savedChars || cues.some((cue, index) => cue.to <= cue.from || !cue.content.trim() || (index > 0 && cue.from < cues[index - 1].from)) || (job.basis.timingFingerprint && timings !== job.basis.timingFingerprint)) throw new ApplicationError('invalid-message');
          tx.objectStore('subtitleVersions').add({ id: completionToken, workspaceId: job.snapshot.target.workspaceId, jobId, attemptId, source: (job.snapshot as SubtitleRequestSnapshot).source, language: (job.snapshot as SubtitleRequestSnapshot).targetLanguage ?? job.basis.language ?? 'und', type: job.snapshot.target.operation, createdAt: Date.now(), sourceFingerprint: job.basis.fingerprint, sourceLanguage: job.basis.language, alignment: 'exact', cues });
          const subtitleSnapshot=job.snapshot as SubtitleRequestSnapshot,current=record.analysisSource??{kind:'native' as const};
          const sourceStillSelected='subtitleVersionId' in subtitleSnapshot.source?current.kind!=='native'&&current.versionId===subtitleSnapshot.source.subtitleVersionId:current.kind==='native'&&(!current.language||current.language===job.basis.language);
          if(subtitleSnapshot.target.operation==='enhance'&&subtitleSnapshot.subtitleWorkflow!==2&&sourceStillSelected){record.analysisSource={kind:'version',versionId:completionToken};record.analysisSourceRevision=(record.analysisSourceRevision??0)+1;}
        } else {
          if (result) throw new ApplicationError('invalid-message');
          if ((job.snapshot as ChatRequestSnapshot).outputType === 'markdown' || (job.snapshot as ChatRequestSnapshot).outputType === 'html') {
            let knowledge; let page:ReturnType<typeof parseHtmlPage>|undefined;
            if ((job.snapshot as ChatRequestSnapshot).outputType === 'html') {
              if ((job.snapshot as ChatRequestSnapshot).htmlFormat===1) page=parseHtmlPage(attempt.text);
              else { if (!(job.snapshot as ChatRequestSnapshot).knowledgeFormat) throw new ApplicationError('legacy-knowledge');
              try { knowledge = parseKnowledge(attempt.text); } catch { throw new ApplicationError('knowledge-format'); } }
            }
            if (!attempt.text.trim()) throw new ApplicationError('invalid-message');
            const revisionId = crypto.randomUUID();
            tx.objectStore('noteRevisions').add({ id: revisionId, artifactId: completionToken, revision: 1, content: page?.source ?? (knowledge ? JSON.stringify(knowledge) : attempt.text) });
            tx.objectStore('artifacts').add({ id: completionToken, workspaceId: job.snapshot.target.workspaceId, sourceChatId: job.snapshot.target.chatId,
              type: page ? 'html-page' : knowledge ? 'html' : 'markdown', ...(page?{pageVersion:1}:{}), title: page?.title ?? knowledge?.title ?? ((attempt.text.split('\n').find(line => line.trim()) ?? 'Markdown 笔记').replace(/^#+\s*/, '').trim().slice(0, 1000) || 'Markdown 笔记'),
              revision: 1, revisionId, jobId, attemptId, ...(attempt.webEvidence?{webEvidence:attempt.webEvidence}:{}) });
          }
        }
        attempt.completionToken = completionToken;
        if (job.snapshot.target.kind === 'chat' && (job.snapshot as ChatRequestSnapshot).outputType === 'html') attempt.text = '';
      }
      if(attempt.webEvidence?.status==='searching')attempt.webEvidence.status='failed';
      if (state !== 'completed' && attempt.visual && !attempt.visual.frozen) attempt.visual.phase = 'retired';
      attempt.state = state; attempt.error = error; job.seq++;
      this.message(job, record);
    });
  }
  retry(jobId: string): Promise<GenerationJob> {
    return this.transaction('readwrite', (tx, done, fail) => {
      const store = tx.objectStore('jobs'), request = store.get(jobId), all = store.getAll();
      all.onsuccess = () => {
        try {
          const job: GenerationJob | undefined = request.result;
          if (!job) throw new ApplicationError('not-found');
          if ('outputType' in job.snapshot && job.snapshot.outputType === 'html' && ((job.snapshot.htmlFormat!==1 && job.snapshot.knowledgeFormat !== 1) || isLegacyHtmlTemplate(job.snapshot.templateSnapshot))) throw new ApplicationError('legacy-knowledge');
          const attempt = job.attempts.at(-1)!;
          if (!terminal(attempt.state) || attempt.state === 'completed') throw new ApplicationError('task-busy');
          const pending = (all.result as GenerationJob[]).filter(active);
          if (pending.length >= 10) throw new ApplicationError('resource-limit');
          if (job.snapshot.target.kind === 'chat' && pending.some(other => sameSlot(other.snapshot.target, job.snapshot.target))) throw new ApplicationError('task-busy');
          const workspace = tx.objectStore('workspaces').get(job.snapshot.target.workspaceId);
          const versions = tx.objectStore('subtitleVersions').getAll();
          versions.onsuccess = () => {
            const record: StoredWorkspace | undefined = workspace.result;
            if (!record || record.deleted || (job.snapshot.target.kind === 'chat' && !record.chats.some(chat => job.snapshot.target.kind === 'chat' && chat.id === job.snapshot.target.chatId && !chat.deleted))) return fail(new ApplicationError('not-found'));
            if (job.basis.subtitleVersionId) {
              try { validVersion(versions.result, job.snapshot.target.workspaceId, job.basis.subtitleVersionId); }
              catch { return fail(new ApplicationError('source-changed')); }
            }
            // Snapshot and the original user message remain byte-for-byte intact.
            const next = newAttempt();
            if (attempt.visual?.frozen) next.visual = structuredClone(attempt.visual);
            job.attempts.push(next); job.seq++; store.put(job); done(job);
          };
        } catch (error) { fail(error instanceof ApplicationError ? error : new ApplicationError('storage-failed')); }
      };
    });
  }
  subtitleVersions(workspaceId: string): Promise<{ id: string; workspaceId: string; cues: Cue[]; language: string; type: string; createdAt: number; sourceFingerprint: string; alignment: string }[]> {
    return this.transaction('readonly', (tx, done) => {
      const space = tx.objectStore('workspaces').get(workspaceId), request = tx.objectStore('subtitleVersions').getAll();
      request.onsuccess = () => done(!space.result || space.result.deleted ? [] : request.result.filter(row => row.workspaceId === workspaceId && !row.deleted));
    });
  }
}
