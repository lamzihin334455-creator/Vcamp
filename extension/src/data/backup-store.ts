import { ApplicationError } from '../contracts/application';
import type { BackupPlan, BackupStreamManifest } from '../contracts/backup';
import { databaseTransaction } from './database';
import { backupTables, canonical, decode, encode, project, rowKey, type BackupPayload } from './backup-format';
import { checkPart, decodeStream, encodeStream, readStreamManifest } from './backup-stream';
import { mergeBackup } from './backup-merge';
import { validateBackup } from './backup-validation';
import type { StoredWorkspace } from './indexed-store';
import type {PortablePreferences,PortablePreferencesPort} from '../contracts/portable-preferences';
import {chromePortablePreferences} from './portable-preferences';

type Raw = Record<string, unknown[]>;
type Transfer = { expiresAt: number } & ({ kind: 'building' } | { kind: 'export'; manifest: string; parts: string[] } | { kind: 'import'; manifest: BackupStreamManifest; parts: string[] });
const transferLifetime = 10 * 60000;
// Observation timestamps and position do not change any conflict group or ID
// mapping. All other raw fields (including selections and unknown fields) fence
// the preview. Do not compare just the export projection: it strips local data.
function stamp(raw: Raw) {
  return canonical({ ...raw, workspaces: (raw.workspaces as StoredWorkspace[]).map(({ lastOpenedAt: _opened, watchPosition: _position, ...row }) => row) });
}
function resultingRows(raw: Raw, writes: Raw): Raw {
  return Object.fromEntries(backupTables.map(table => {
    const rows = new Map(raw[table].map(row => [rowKey(table, row), row]));
    for (const row of writes[table]) rows.set(rowKey(table, row), row);
    return [table, [...rows.values()]];
  }));
}
function preserveObservations(writes: Raw, raw: Raw): Raw {
  const current = new Map((raw.workspaces as StoredWorkspace[]).map(row => [row.id, row]));
  return { ...writes, workspaces: (writes.workspaces as StoredWorkspace[]).map(row => {
    const latest = current.get(row.id);
    if (!latest) return row;
    const { lastOpenedAt: _opened, watchPosition: _position, ...rest } = row;
    return { ...rest, ...(latest.lastOpenedAt !== undefined ? { lastOpenedAt: latest.lastOpenedAt } : {}), ...(latest.watchPosition !== undefined ? { watchPosition: latest.watchPosition } : {}) };
  }) };
}
function read(tx: IDBTransaction, ready: (rows: Raw) => void) {
  const rows: Raw = {}; let remaining = backupTables.length;
  for (const table of backupTables) { const r = tx.objectStore(table).getAll(); r.onsuccess = () => { rows[table] = r.result; if (--remaining === 0) ready(rows); }; }
}
export class IndexedBackupStore {
  private plans = new Map<string, { plan: BackupPlan; stamp: string; writes: Raw;preferences?:PortablePreferences;preferenceStamp:string }>();
  private transfers = new Map<string, Transfer>();
  constructor(private name = 'vcamp',private preferences:PortablePreferencesPort|undefined=chromePortablePreferences()) {}
  private reserve(): string {
    for (const [id, transfer] of this.transfers) if (transfer.expiresAt <= Date.now()) this.transfers.delete(id);
    if (this.transfers.size >= 2) throw new ApplicationError('resource-limit');
    const id = crypto.randomUUID(); this.transfers.set(id, { kind: 'building', expiresAt: Date.now() + transferLifetime }); return id;
  }
  private transfer(id: string): Transfer {
    const transfer = this.transfers.get(id);
    if (!transfer || transfer.expiresAt <= Date.now()) { this.transfers.delete(id); throw new ApplicationError('plan-expired'); }
    transfer.expiresAt = Date.now() + transferLifetime; return transfer;
  }
  releaseTransfer(id: string) { this.transfers.delete(id); }
  async beginExport() {
    const id = this.reserve();
    try {
      const preferences = await this.preferences?.read();
      const raw = await databaseTransaction<Raw>(this.name, backupTables, 'readonly', (tx, done) => read(tx, done));
      const packet = await encodeStream(project(raw, preferences), preferences);
      if (!this.transfers.has(id)) throw new ApplicationError('plan-expired');
      this.transfers.set(id, { kind: 'export', ...packet, expiresAt: Date.now() + transferLifetime });
      return { id, manifest: packet.manifest };
    } catch (error) { this.transfers.delete(id); throw error; }
  }
  exportPart(id: string, index: number) {
    const transfer = this.transfer(id);
    if (transfer.kind !== 'export' || !Number.isInteger(index) || index < 0 || index >= transfer.parts.length) throw new ApplicationError('invalid-message');
    return { id, data: transfer.parts[index] };
  }
  async beginImport(header: string) {
    const manifest = await readStreamManifest(header), id = this.reserve();
    this.transfers.set(id, { kind: 'import', manifest, parts: [], expiresAt: Date.now() + transferLifetime });
    return { id, nextIndex: 0 };
  }
  async appendImport(id: string, index: number, data: string) {
    const transfer = this.transfer(id);
    if (transfer.kind !== 'import' || index !== transfer.parts.length) throw new ApplicationError('invalid-message');
    await checkPart(transfer.manifest, index, data);
    if (this.transfers.get(id) !== transfer || index !== transfer.parts.length) throw new ApplicationError('revision-conflict');
    transfer.parts.push(data); return { id, nextIndex: transfer.parts.length };
  }
  async finishImport(id: string): Promise<BackupPlan> {
    const transfer = this.transfer(id);
    if (transfer.kind !== 'import' || transfer.parts.length !== transfer.manifest.parts.length) throw new ApplicationError('invalid-message');
    this.transfers.delete(id);
    const payload = await decodeStream(transfer.manifest, transfer.parts);
    return this.previewPayload(payload, transfer.manifest.checksum, transfer.manifest.preferences);
  }
  async export(): Promise<string> {
    const preferences=await this.preferences?.read();
    const raw=await databaseTransaction<Raw>(this.name, backupTables, 'readonly', (tx, done) => read(tx, done));
    return encode(project(raw,preferences),preferences);
  }
  async preview(file: string): Promise<BackupPlan> {
    const { payload, checksum, preferences } = await decode(file);
    return this.previewPayload(payload, checksum, preferences);
  }
  private async previewPayload(payload: BackupPayload, checksum: string, preferences?: PortablePreferences): Promise<BackupPlan> {
    validateBackup(payload);
    if(preferences?.activeRole&&!payload.roleRevisions.some(row=>row.roleId===preferences.activeRole!.roleId&&row.revisionId===preferences.activeRole!.revisionId))throw new ApplicationError('invalid-message');
    if(preferences?.htmlStyle&&!payload.styleRevisions.some(row=>row.styleId===preferences.htmlStyle!.styleId&&row.revisionId===preferences.htmlStyle!.revisionId))throw new ApplicationError('invalid-message');
    if(preferences?.libraryState?.scope.kind==='folder'&&!payload.folders.some(row=>row.id===(preferences.libraryState!.scope as {id:string}).id))throw new ApplicationError('invalid-message');
    const localPreferences=await this.preferences?.read();
    const raw = await databaseTransaction<Raw>(this.name, backupTables, 'readonly', (tx, done) => read(tx, done));
    const local = project(raw), merged = await mergeBackup(payload, local);
    const proposed = resultingRows(raw, merged.writes);
    // Validate the actual resulting graph too, including collisions with the
    // target and all bounded origin records, before making a committable plan.
    validateBackup(project(proposed));
    const counts: Record<string, number> = {};
    for (const table of backupTables) counts[table] = payload[table].length;
    counts.chats = payload.workspaces.reduce((sum, w) => sum + w.chats.length, 0);
    counts.preferences=preferences?Object.keys(preferences).length:0;
    counts.deletedEntries = payload.workspaces.filter(w => w.deleted).length + payload.workspaces.reduce((sum, w) => sum + w.chats.filter(c => c.deleted).length, 0) + [...payload.artifacts, ...payload.scribbles, ...payload.subtitleVersions].filter(r => r.deleted).length;
    counts.deletionConflicts = payload.workspaces.reduce((sum, w) => {
      const previous = local.workspaces.find(l => l.id === w.id);
      return sum + (previous && !!previous.deleted !== !!w.deleted ? 1 : 0) + w.chats.filter(c => previous?.chats.some(l => l.id === c.id && !!l.deleted !== !!c.deleted)).length;
    }, 0);
    const plan: BackupPlan = { planId: crypto.randomUUID(), checksum, expiresAt: Date.now() + 600000, added: merged.added, skipped: merged.skipped, conflicts: merged.conflicts, counts, warnings: ['保留本机最近对话、主字幕、观看位置和删除状态。冲突资料成组复制。', '导入任务仅保留历史；运行及排队状态转为中断，不自动调用模型。', '截图附件包含图像字节；缺图或损坏包拒绝。HTML 页面源码与旧版知识分别识别；导入不执行页面或调用模型。'], mapping: merged.mapping };
    if (this.plans.size >= 4) this.plans.delete(this.plans.keys().next().value!);
    const restored=preferences?structuredClone(preferences):undefined;
    if(restored?.activeRole){const map=(id:string)=>merged.mapping.find(item=>item.kind==='role'&&item.from===id)?.to??id;restored.activeRole={roleId:map(restored.activeRole.roleId),revisionId:map(restored.activeRole.revisionId)};}
    if(restored?.htmlStyle){const map=(id:string)=>merged.mapping.find(item=>item.kind==='style'&&item.from===id)?.to??id;restored.htmlStyle={styleId:map(restored.htmlStyle.styleId),revisionId:map(restored.htmlStyle.revisionId)};}
    if(restored?.libraryState?.scope.kind==='folder'){const scope=restored.libraryState.scope;scope.id=merged.mapping.find(item=>item.kind==='folder'&&item.from===scope.id)?.to??scope.id;}
    this.plans.set(plan.planId, { plan, stamp: stamp(raw), writes: merged.writes,preferences:restored,preferenceStamp:canonical(localPreferences??{}) }); return plan;
  }
  async execute(planId: string, checksum: string) {
    const saved = this.plans.get(planId);
    if (!saved || saved.plan.checksum !== checksum || saved.plan.expiresAt < Date.now()) throw new ApplicationError('plan-expired');
    if(canonical(await this.preferences?.read()??{})!==saved.preferenceStamp)throw new ApplicationError('plan-expired');
    const result = await databaseTransaction<{ added: number; skipped: number; conflicts: number }>(this.name, backupTables, 'readwrite', (tx, done, fail) => read(tx, raw => {
      if (stamp(raw) !== saved.stamp) return fail(new ApplicationError('plan-expired'));
      try {
        // Rebase ONLY observation fields inside this same readwrite transaction;
        // the confirmed groups, counts and mappings are never recomputed.
        const writes = preserveObservations(saved.writes, raw);
        validateBackup(project(resultingRows(raw, writes)));
        for (const table of backupTables) for (const row of writes[table]) tx.objectStore(table).put(row);
      }
      catch (error) { return fail(error instanceof ApplicationError ? error : new ApplicationError('storage-failed')); }
      done({ added: saved.plan.added, skipped: saved.plan.skipped, conflicts: saved.plan.conflicts });
    }));
    let preferencesRestored:boolean|undefined;
    if(saved.preferences){try{if(!this.preferences)throw new Error();await this.preferences.write(saved.preferences);preferencesRestored=true;}catch{preferencesRestored=false;}}
    this.plans.delete(planId); return {...result,...(preferencesRestored!==undefined?{preferencesRestored}:{})};
  }
}
