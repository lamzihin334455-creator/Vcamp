import {outputLimits} from '../contracts/output-limits';
import { baseUrlSchema, providerIdSchema } from '../contracts/provider-config';
import {styleSchema,styleRevisionSchema} from '../contracts/style';
import {allPresetStyles as presetStyles,presetStyleRevisions} from '../workbench/style-presets';
import {portablePreferencesSchema,type PortablePreferences} from '../contracts/portable-preferences';
import { visionStageSchema } from '../contracts/vision';
import {webEvidenceSchema,webOptionsSchema} from '../contracts/web';
import { knowledgeContextSchema } from '../contracts/knowledge';
import { attachmentSchema } from '../contracts/attachment';
import { validateImage } from './image-validation';
import { z } from 'zod';
import { ApplicationError, draftSchema, videoKeySchema } from '../contracts/application';
import { messageSchema, targetSchema, generationErrors, jobStateSchema } from '../contracts/generation';
import { referenceSnapshotSchema } from '../contracts/artifact';
import { roleSchema, roleRevisionSchema } from '../contracts/role';
import { presetRoleRevisions } from '../workbench/role-presets';
import { templateSchema, templateRevisionSchema } from '../contracts/template';
import { subtitleVersionSchema, analysisSourceSchema } from '../contracts/subtitles';
import { scribbleSchema } from '../contracts/scribble';
import { BACKUP_MAX_BYTES } from '../contracts/backup';
import { presetTemplates, presetRevisions } from '../workbench/template-presets';
import { frozenEvidenceSchema } from '../contracts/evidence';
import {subtitleInputLimits} from '../contracts/subtitle-limits';

const id = z.string().min(1).max(1000), text = z.string().max(outputLimits.textChars), rev = z.number().int().nonnegative();
const deletion = { deleted: z.boolean().optional(), deletedAt: z.number().finite().nonnegative().optional(), managementRevision: rev.optional() };
const history = messageSchema.omit({ webEvidence:true,jobId: true, attemptId: true, state: true, kind: true, scribbleId: true, outputType: true, artifactId: true });
const providerConnectionSchema = z.object({ providerId: providerIdSchema, baseUrl: baseUrlSchema.optional(), profileId: z.string().uuid().optional() }).strict();
const chatSnapshot = z.object({ providerConnection: providerConnectionSchema.optional(), htmlStyle:styleRevisionSchema.optional(), mediaDuration:z.number().finite().positive().optional(), autoVision: z.boolean().optional(), visionReview:z.union([z.literal(1),z.literal(2)]).optional(), visionOnly:z.boolean().optional(), knowledgeFormat:z.literal(1).optional(), htmlFormat:z.literal(1).optional(), knowledgeContext:knowledgeContextSchema.optional(), snapshotId: id, target: targetSchema, analysisSource: z.union([
  z.object({ kind: z.literal('native'), locator: id, fingerprint: id }).strict(),
  z.object({ kind: z.literal('enhanced'), versionId: id, fingerprint: id }).strict(),
  z.object({ kind: z.literal('version'), versionId: id, fingerprint: id }).strict()
]).optional(), input: text, outputType: z.enum(['chat', 'markdown', 'html']), modelId: id, webEnabled: z.boolean(),web:webOptionsSchema.optional(),videoTitle:z.string().max(1000).optional(),videoPartTitle:z.string().max(1000).optional(),evidence:frozenEvidenceSchema.optional(), templateRevisionId: id.nullable(), templateSnapshot: templateRevisionSchema.optional(), roleSnapshot: roleRevisionSchema.optional(), historyProjection: z.array(history).max(10000), historyOmitted: z.number().int().nonnegative().max(1000000).optional(), referenceSnapshotIds: z.array(id).max(100), referenceSnapshots: z.array(referenceSnapshotSchema).max(100).optional(), attachmentIds: z.array(id).max(100) }).strict().refine(s=>s.webEnabled===Boolean(s.web));
const subtitleSnapshot = z.object({providerConnection: providerConnectionSchema.optional(),subtitleWorkflow:z.literal(2).optional(),webEnabled:z.boolean().optional(),web:webOptionsSchema.optional(),videoTitle:z.string().max(1000).optional(), snapshotId: id, target: targetSchema, source: subtitleVersionSchema.shape.source, targetLanguage: z.string().max(80).nullable(), requirements: z.string().max(2000), modelId: id }).strict();
const media = z.object({ platform: z.literal('bilibili'), videoId: id, partId: id }).strict();
const basis = z.object({ binding: media, locator: id, fingerprint: id, timingFingerprint: id.optional(), language: z.string().nullable(), cueCount: z.number().int().nonnegative().max(subtitleInputLimits.cueCount), subtitleVersionId: id.optional(), visionOnly:z.literal(true).optional(), mediaDuration:z.number().finite().positive().optional() }).strict();
const attempt = z.object({ webEvidence:webEvidenceSchema.optional(),visual: visionStageSchema.optional(), attemptId: z.string().uuid(), state: jobStateSchema, importedState: jobStateSchema.optional(), text, error: z.enum(generationErrors).nullable(), coverage: z.object({ total: rev, covered: rev, ranges: z.array(z.object({ firstCue: rev, lastCue: rev }).strict()).max(20000) }).strict() });
const position = z.object({ time: z.number().finite().nonnegative(), observedAt: z.number().finite().nonnegative() }).strict();
export const importRecordSchema = z.object({ fingerprint: id, originalWorkspaceId: id, ...deletion,
  source: videoKeySchema.optional(), lastOpenedAt: z.number().optional(), analysisSourceRevision: rev.optional(),
  originalDeletions: z.array(z.object({ kind: id, id, ...deletion })).max(20000).optional(),
  recentChatId: z.string(), analysisSource: analysisSourceSchema.optional(), watchPosition: position.optional(),
  mapping: z.array(z.object({ kind: id, from: id, to: id }).strict()).max(20000)
}).strict();
const chat = z.object({ id, backupOriginalId: id.optional(), title: z.string().max(1000), draft: draftSchema, messages: z.array(messageSchema).max(10000).optional(), ...deletion });
const workspace = z.object({ id, source: videoKeySchema, recentChatId: z.string(), chats: z.array(chat).max(10000), lastOpenedAt: z.number().finite().nonnegative().optional(), watchPosition: position.optional(), subtitleVersionIds: z.array(id).max(10000).optional(), analysisSource: analysisSourceSchema.optional(), analysisSourceRevision: rev.optional(), backupImports: z.array(importRecordSchema).max(1000).optional(), ...deletion });
const artifact = z.object({ webEvidence:webEvidenceSchema.optional(),id, workspaceId: id, sourceChatId: id, type: z.enum(['markdown','html','html-page']), pageVersion:z.literal(1).optional(), title: z.string().min(1).max(1000), revision: z.number().int().positive(), revisionId: id, jobId: id, attemptId: id, ...deletion });
export const payloadSchema = z.object({
  attachments: z.array(attachmentSchema).max(20000),
  workspaces: z.array(workspace).max(10000),
  jobs: z.array(z.object({ jobId: z.string().uuid(), snapshot: z.union([chatSnapshot, subtitleSnapshot]), basis, seq: rev, attempts: z.array(attempt).min(1).max(1000) })).max(20000),
  artifacts: z.array(artifact).max(20000), noteRevisions: z.array(z.object({ id, artifactId: id, revision: z.number().int().positive(), content: text })).max(50000),
  subtitleVersions: z.array(subtitleVersionSchema).max(20000), scribbles: z.array(scribbleSchema).max(20000),
  styles:z.array(styleSchema).max(10000),styleRevisions:z.array(styleRevisionSchema).max(50000),
  roles: z.array(roleSchema).max(10000), roleRevisions: z.array(roleRevisionSchema).max(50000),
  templates: z.array(templateSchema).max(10000), templateRevisions: z.array(templateRevisionSchema).max(50000),
  folders: z.array(z.object({ id, name: z.string().min(1).max(100), revision: z.number().int().positive(), color:z.string().regex(/^#[0-9a-f]{6}$/i).optional(), backupOriginalId: id.optional() })).max(10000),
  favorites: z.array(z.object({ id, folderId: id, target: z.object({ workspaceId: id, entityType: z.enum(['workspace', 'chat', 'html', 'markdown', 'scribble', 'subtitle']), id }).strict(), title: z.string().max(1000), videoTitle: z.string().max(1000) })).max(50000)
});
export type BackupPayload = z.infer<typeof payloadSchema>;
export const backupTables = Object.keys(payloadSchema.shape) as (keyof BackupPayload)[];
export const rowKey = (table: keyof BackupPayload, row: unknown): string => (row as Record<string, string>)[table === 'jobs' ? 'jobId' : table === 'templateRevisions' || table === 'roleRevisions' || table==='styleRevisions' ? 'revisionId' : 'id'];
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function project(raw: Record<string, unknown[]>,preferences?:PortablePreferences): BackupPayload {
  const jobs = (raw.jobs ?? []).map(value => {
    const row = value as Record<string, any>, binding = row.basis.binding;
    return { jobId: row.jobId, snapshot: row.snapshot, basis: { ...row.basis, binding: { platform: binding.platform, videoId: binding.videoId, partId: binding.partId } }, seq: row.seq,
      attempts: row.attempts.map((a: Record<string, unknown>) => ({ ...(a.webEvidence?{webEvidence:a.webEvidence}:{}),...(a.visual ? { visual: a.visual } : {}), attemptId: a.attemptId, state: a.state, text: a.text, error: a.error, coverage: a.coverage, ...(a.importedState ? { importedState: a.importedState } : {}) })) };
  });
  const value = payloadSchema.safeParse({ styles:[],styleRevisions:[],roles: [], roleRevisions: [], ...raw, jobs });
  if (!value.success) throw new ApplicationError('invalid-message');
  const payload = value.data;
  // Built-in versions used by drafts/requests are frozen as dependencies too.
  // Import converts these records into ordinary custom copies, so a newer app
  // preset cannot alter an old request or gain a new capability from the file.
  const dependencies = new Set<string>();
  for (const ws of payload.workspaces) for (const chat of ws.chats) {
    if (chat.draft.template) dependencies.add(chat.draft.template.revisionId);
    for (const message of chat.messages ?? []) if (message.templateSnapshot) dependencies.add(message.templateSnapshot.revisionId);
  }
  for (const job of payload.jobs) if ('input' in job.snapshot) {
    if (job.snapshot.templateRevisionId) dependencies.add(job.snapshot.templateRevisionId);
    for (const h of job.snapshot.historyProjection) if (h.templateSnapshot) dependencies.add(h.templateSnapshot.revisionId);
  }
  for (const preset of presetTemplates) {
    const required=presetRevisions.filter(r=>r.templateId===preset.id&&dependencies.has(r.revisionId));
    const existing = payload.templates.find(t => t.id === preset.id);
    if (!required.length && !existing) continue;
    const latest = existing ?? required.reduce((a,b) => a.revision > b.revision ? a : b);
    if (!existing) { const { templateId, ...fields } = latest as typeof required[number]; payload.templates.push({ ...fields, id: templateId, builtin: true }); }
    // An older local edit may already own this number. Only an explicit
    // dependency can add a competing builtin ID; never silently drop a reference.
    payload.templateRevisions.push(...presetRevisions.filter(r => r.templateId === preset.id && (r.revision <= latest.revision || dependencies.has(r.revisionId))
      && !payload.templateRevisions.some(saved => saved.revisionId === r.revisionId
        || saved.templateId === r.templateId && saved.revision === r.revision && !dependencies.has(r.revisionId))));
  }
  const roleDependencies = new Set<string>(preferences?.activeRole?[preferences.activeRole.revisionId]:[]);
  for (const ws of payload.workspaces) for (const chat of ws.chats) {
    if (chat.draft.role) roleDependencies.add(chat.draft.role.revisionId);
    for (const message of chat.messages ?? []) if (message.roleSnapshot) roleDependencies.add(message.roleSnapshot.revisionId);
  }
  for (const job of payload.jobs) if ('input' in job.snapshot) {
    if (job.snapshot.roleSnapshot) roleDependencies.add(job.snapshot.roleSnapshot.revisionId);
    for (const h of job.snapshot.historyProjection) if (h.roleSnapshot) roleDependencies.add(h.roleSnapshot.revisionId);
  }
  for (const id of new Set(presetRoleRevisions.map(row => row.roleId))) {
    const required = presetRoleRevisions.filter(revision => revision.roleId === id && roleDependencies.has(revision.revisionId));
    const existing = payload.roles.find(row => row.id === id);
    if (!required.length && !existing) continue;
    const latest = existing ?? required.reduce((a, b) => a.revision > b.revision ? a : b);
    if (!existing) {
      const { roleId, ...fields } = latest as typeof required[number];
      payload.roles.push({ ...fields, id: roleId, builtin: true });
    }
    payload.roleRevisions.push(...presetRoleRevisions.filter(r => r.roleId === id && (r.revision <= latest.revision || roleDependencies.has(r.revisionId))
      && !payload.roleRevisions.some(saved => saved.revisionId === r.revisionId
        || saved.roleId === r.roleId && saved.revision === r.revision && !roleDependencies.has(r.revisionId))));
  }
  const styleDependencies=new Set<string>(preferences?.htmlStyle?[preferences.htmlStyle.revisionId]:[]);
  for(const ws of payload.workspaces)for(const chat of ws.chats)if(chat.draft.htmlStyle)styleDependencies.add(chat.draft.htmlStyle.revisionId);
  for(const job of payload.jobs)if('htmlStyle' in job.snapshot&&job.snapshot.htmlStyle)styleDependencies.add(job.snapshot.htmlStyle.revisionId);
  for(const preset of presetStyles){
    const required=presetStyleRevisions.filter(row=>row.styleId===preset.id&&styleDependencies.has(row.revisionId)),existing=payload.styles.find(row=>row.id===preset.id);
    if(!required.length&&!existing)continue;
    const latest=existing??required.reduce((a,b)=>a.revision>b.revision?a:b);
    if(!existing){const {styleId,...fields}=latest as typeof required[number];payload.styles.push({...fields,id:styleId,builtin:true});}
    payload.styleRevisions.push(...presetStyleRevisions.filter(row=>row.styleId===preset.id&&(row.revision<=latest.revision||styleDependencies.has(row.revisionId))&&!payload.styleRevisions.some(saved=>saved.revisionId===row.revisionId||saved.styleId===row.styleId&&saved.revision===row.revision&&!styleDependencies.has(row.revisionId))));
  }
  return payload;
}
export async function encode(payload: BackupPayload, preferences?:PortablePreferences): Promise<string> {
  const manifest = { format: 'vcamp-backup', formatVersion: 6, databaseVersion: 10, createdAt: Date.now(), types: backupTables, checksum: await digest({payload,...(preferences?{preferences:portablePreferencesSchema.parse(preferences)}:{})}) };
  const file = JSON.stringify({ manifest, payload,...(preferences?{preferences}:{}) });
  if (new TextEncoder().encode(file).byteLength > BACKUP_MAX_BYTES) throw new ApplicationError('resource-limit');
  return file;
}
export async function decode(file: string): Promise<{ payload: BackupPayload; checksum: string;preferences?:PortablePreferences }> {
  if (new TextEncoder().encode(file).byteLength > BACKUP_MAX_BYTES) throw new ApplicationError('resource-limit');
  try {
    const raw = JSON.parse(file);
    const format=raw?.manifest?.formatVersion;
    if (![1,2,3,4,5,6].includes(format))throw new Error();
    if(format<4&&(raw.payload?.artifacts?.some((a:any)=>a.type==='html-page'||a.pageVersion)||raw.payload?.jobs?.some((j:any)=>j.snapshot?.htmlFormat)||raw.payload?.scribbles?.some((s:any)=>s.creationOrder!==undefined)||raw.payload?.templates?.some((t:any)=>t.outputProtocol==='html-page-v1')||raw.payload?.templateRevisions?.some((t:any)=>t.outputProtocol==='html-page-v1')))throw new Error();
    const legacy=format===1;
    const tables=backupTables.filter(t => (format>=6||t!=='styles'&&t!=='styleRevisions')&& (!legacy || t !== 'attachments') && (format >= 5 || t !== 'roles' && t !== 'roleRevisions'));
    const previousSchema=payloadSchema.omit({styles:true,styleRevisions:true});
    const oldSchema=previousSchema.omit({roles:true,roleRevisions:true});
    const schema=format>=6?payloadSchema:format>=5?previousSchema:legacy?oldSchema.omit({attachments:true}):oldSchema;
    const packet=z.object({manifest:z.object({format:z.literal('vcamp-backup'),formatVersion:z.literal(format),databaseVersion:z.literal(format>=6?10:format>=5?9:legacy?7:8),createdAt:z.number(),types:z.array(z.string()),checksum:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),payload:schema,...(format>=6?{preferences:portablePreferencesSchema.optional()}:{})}).strict().parse(raw);
    if(canonical(packet)!==canonical(raw)||canonical([...packet.manifest.types].sort())!==canonical([...tables].sort())||await digest(format>=6?{payload:packet.payload,...('preferences' in packet&&packet.preferences?{preferences:packet.preferences}:{})}:packet.payload)!==packet.manifest.checksum)throw new Error();
    const payload=payloadSchema.parse({styles:[],styleRevisions:[],roles:[],roleRevisions:[],...packet.payload,attachments:legacy?[]:(packet.payload as BackupPayload).attachments});
    if(format<3&&(payload.artifacts.some(a=>a.webEvidence)||payload.workspaces.some(w=>w.chats.some(c=>c.draft.webEnabled!==undefined||c.messages?.some(m=>m.webEvidence)))||payload.jobs.some(j=>j.attempts.some(a=>a.webEvidence)||'input' in j.snapshot&&j.snapshot.web)))throw new Error();
    if(format<3&&(payload.templates.some(t=>t.outputProtocol)||payload.templateRevisions.some(t=>t.outputProtocol)||payload.artifacts.some(a=>a.type==='html')||payload.workspaces.some(w=>w.chats.some(c=>c.draft.knowledgeFollowup||c.messages?.some(m=>m.knowledgeContext)))||payload.jobs.some(j=>'input' in j.snapshot&&(j.snapshot.knowledgeFormat||j.snapshot.knowledgeContext))))throw new Error();
    for(const image of payload.attachments){const value=await validateImage(image);if(value.sha256!==image.sha256||value.bytes!==image.bytes)throw new Error();}
    return {payload,checksum:packet.manifest.checksum,...('preferences' in packet&&packet.preferences?{preferences:packet.preferences as PortablePreferences}:{})};
  } catch { throw new ApplicationError('invalid-message'); }
}
