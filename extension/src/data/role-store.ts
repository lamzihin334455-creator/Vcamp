import { ApplicationError } from '../contracts/application';
import { roleFieldsSchema, type PromptRole, type RoleFields, type RoleRevision } from '../contracts/role';
import { presetRoles, presetRoleRevisions, resolveRoleRevision } from '../workbench/role-presets';
import { databaseTransaction } from './database';

export class IndexedRoleStore {
  constructor(private name = 'vcamp') {}
  list(): Promise<PromptRole[]> {
    return databaseTransaction(this.name, ['roles'], 'readonly', (tx, done) => {
      const rows = tx.objectStore('roles').getAll();
      rows.onsuccess = () => done([...new Map([...presetRoles, ...rows.result].map(row => [row.id, row])).values()].filter(row => !row.deleted));
    });
  }
  revision(roleId: string, revisionId: string): Promise<RoleRevision> {
    return databaseTransaction(this.name, ['roleRevisions'], 'readonly', (tx, done, fail) => {
      const rows = tx.objectStore('roleRevisions').getAll();
      rows.onsuccess = () => { const revision = resolveRoleRevision(roleId, revisionId, rows.result); if (!revision) return fail(new ApplicationError('not-found')); done(revision); };
    });
  }
  create(fields: RoleFields) { return this.write(crypto.randomUUID(), null, fields); }
  save(id: string, expectedRevision: number, fields: RoleFields) { return this.write(id, expectedRevision, fields); }
  delete(id: string, expectedRevision: number) { return this.write(id, expectedRevision); }
  private write(id: string, expectedRevision: number | null, fields?: RoleFields): Promise<PromptRole> {
    const parsed = fields ? roleFieldsSchema.safeParse(fields) : undefined;
    if (parsed && !parsed.success) return Promise.reject(new ApplicationError('invalid-message'));
    return databaseTransaction(this.name, ['roles', 'roleRevisions'], 'readwrite', (tx, done, fail) => {
      const revisions = tx.objectStore('roleRevisions'), history = revisions.getAll();
      const rows = tx.objectStore('roles'), request = rows.get(id);
      request.onsuccess = () => {
        const old: PromptRole | undefined = request.result ?? presetRoles.find(row => row.id === id);
        if (expectedRevision !== null && (!old || old.deleted)) return fail(new ApplicationError('not-found'));
        if (old && old.revision !== expectedRevision) return fail(new ApplicationError('revision-conflict'));
        // Local edits can occupy numbers introduced by a later app preset.
        // Fill only the existing history prefix; never replace or branch it.
        const occupied = new Set(history.result.filter((row: RoleRevision) => row.roleId === id).map((row: RoleRevision) => row.revision));
        for (const revision of presetRoleRevisions.filter(row => row.roleId === id && row.revision <= (old?.revision ?? 0) && !occupied.has(row.revision))) revisions.add(revision);
        if (!parsed?.success) { const row = { ...old!, deleted: true }; rows.put(row); done(row); return; }
        const row: PromptRole = { ...parsed.data, id, revisionId: crypto.randomUUID(), revision: (old?.revision ?? 0) + 1, builtin: old?.builtin ?? false, ...(old?.backupOriginalId ? { backupOriginalId: old.backupOriginalId } : {}) };
        const { id: roleId, builtin: _builtin, backupOriginalId: _origin, ...revision } = row;
        tx.objectStore('roleRevisions').add({ ...revision, roleId }); rows.put(row); done(row);
      };
    });
  }
}
