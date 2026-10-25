import { ApplicationError } from '../contracts/application';
import { styleFieldsSchema, type PromptStyle, type StyleFields, type StyleRevision } from '../contracts/style';
import { presetStyles, presetStyleRevisions, resolveStyleRevision, retiredStyleIds } from '../workbench/style-presets';
import { databaseTransaction } from './database';
import { orderedPrompts, reorderPrompts } from './prompt-order';

export class IndexedStyleStore {
  constructor(private name = 'vcamp') {}
  list(): Promise<PromptStyle[]> {
    return databaseTransaction(this.name, ['styles'], 'readonly', (tx, done) => {
      const rows = tx.objectStore('styles').getAll();
      rows.onsuccess = () => done(orderedPrompts(presetStyles, rows.result).filter(row => !retiredStyleIds.has(row.id)));
    });
  }
  revision(styleId: string, revisionId: string): Promise<StyleRevision> {
    return databaseTransaction(this.name, ['styleRevisions'], 'readonly', (tx, done, fail) => {
      const rows = tx.objectStore('styleRevisions').getAll();
      rows.onsuccess = () => { const revision = resolveStyleRevision(styleId, revisionId, rows.result); if (!revision) return fail(new ApplicationError('not-found')); done(revision); };
    });
  }
  create(fields: StyleFields) { return this.write(crypto.randomUUID(), null, fields); }
  reorder(ids: string[]) { return reorderPrompts(this.name, 'styles', presetStyles, ids); }
  save(id: string, expectedRevision: number, fields: StyleFields) { return this.write(id, expectedRevision, fields); }
  delete(id: string, expectedRevision: number) { return this.write(id, expectedRevision); }
  private write(id: string, expectedRevision: number | null, fields?: StyleFields): Promise<PromptStyle> {
    const parsed = fields ? styleFieldsSchema.safeParse(fields) : undefined;
    if (parsed && !parsed.success) return Promise.reject(new ApplicationError('invalid-message'));
    return databaseTransaction(this.name, ['styles', 'styleRevisions'], 'readwrite', (tx, done, fail) => {
      const revisions = tx.objectStore('styleRevisions'), history = revisions.getAll();
      const rows = tx.objectStore('styles'), request = rows.get(id);
      request.onsuccess = () => {
        const old: PromptStyle | undefined = request.result ?? presetStyles.find(row => row.id === id);
        if (expectedRevision !== null && (!old || old.deleted)) return fail(new ApplicationError('not-found'));
        if (old && old.revision !== expectedRevision) return fail(new ApplicationError('revision-conflict'));
        // Local edits can occupy numbers introduced by a later app preset.
        // Fill only the existing history prefix; never replace or branch it.
        const occupied = new Set(history.result.filter((row: StyleRevision) => row.styleId === id).map((row: StyleRevision) => row.revision));
        for (const revision of presetStyleRevisions.filter(row => row.styleId === id && row.revision <= (old?.revision ?? 0) && !occupied.has(row.revision))) revisions.add(revision);
        if (!parsed?.success) { const row = { ...old!, deleted: true }; rows.put(row); done(row); return; }
        const row: PromptStyle = { ...parsed.data, id, revisionId: crypto.randomUUID(), revision: (old?.revision ?? 0) + 1, builtin: old?.builtin ?? false, ...(old?.sortIndex !== undefined ? { sortIndex: old.sortIndex } : {}), ...(old?.backupOriginalId ? { backupOriginalId: old.backupOriginalId } : {}) };
        const { id: styleId, builtin: _builtin, backupOriginalId: _origin, sortIndex: _order, ...revision } = row;
        tx.objectStore('styleRevisions').add({ ...revision, styleId }); rows.put(row); done(row);
      };
    });
  }
}
