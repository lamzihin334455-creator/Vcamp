import { ApplicationError } from '../contracts/application';
import { templateFieldsSchema, type Template, type TemplateFields, type TemplateRevision } from '../contracts/template';
import { presetTemplates, presetRevisions, resolveTemplateRevision } from '../workbench/template-presets';
import { databaseTransaction } from './database';
import { orderedPrompts, reorderPrompts } from './prompt-order';

export class IndexedTemplateStore {
  constructor(private name = 'vcamp') {}
  list(): Promise<Template[]> {
    return databaseTransaction(this.name, ['templates'], 'readonly', (tx, done) => {
      const rows = tx.objectStore('templates').getAll(); rows.onsuccess = () => done(orderedPrompts(presetTemplates, rows.result));
    });
  }
  revision(templateId: string, revisionId: string): Promise<TemplateRevision> {
    return databaseTransaction(this.name, ['templateRevisions'], 'readonly', (tx, done, fail) => {
      const rows = tx.objectStore('templateRevisions').getAll();
      rows.onsuccess = () => { const revision = resolveTemplateRevision(templateId, revisionId, rows.result); if (!revision) return fail(new ApplicationError('not-found')); done(revision); };
    });
  }
  create(fields: TemplateFields): Promise<Template> { return this.write(crypto.randomUUID(), null, fields); }
  reorder(ids: string[]) { return reorderPrompts(this.name, 'templates', presetTemplates, ids); }
  save(id: string, expectedRevision: number, fields: TemplateFields): Promise<Template> { return this.write(id, expectedRevision, fields); }
  delete(id: string, expectedRevision: number) { return this.write(id, expectedRevision); }
  private write(id: string, expectedRevision: number | null, fields?: TemplateFields): Promise<Template> {
    const parsed = fields ? templateFieldsSchema.safeParse(fields) : undefined;
    if (parsed && !parsed.success) return Promise.reject(new ApplicationError('invalid-message'));
    return databaseTransaction(this.name, ['templates', 'templateRevisions'], 'readwrite', (tx, done, fail) => {
      const revisions = tx.objectStore('templateRevisions'), history = revisions.getAll();
      const rows = tx.objectStore('templates'), request = rows.get(id);
      request.onsuccess = () => {
        const old: Template | undefined = request.result ?? presetTemplates.find(row => row.id === id);
        if (expectedRevision !== null && (!old || old.deleted)) return fail(new ApplicationError('not-found'));
        if (old && old.revision !== expectedRevision) return fail(new ApplicationError('revision-conflict'));
        // Local edits can occupy numbers introduced by a later app preset.
        // Fill only the existing history prefix; never replace or branch it.
        const occupied = new Set(history.result.filter((row: TemplateRevision) => row.templateId === id).map((row: TemplateRevision) => row.revision));
        for (const revision of presetRevisions.filter(row => row.templateId === id && row.revision <= (old?.revision ?? 0) && !occupied.has(row.revision))) revisions.add(revision);
        if (!parsed?.success) { const row = { ...old!, deleted: true }; rows.put(row); done(row); return; }
        const row: Template = { ...parsed.data, id, revisionId: crypto.randomUUID(), revision: (old?.revision ?? 0) + 1, builtin: old?.builtin ?? false, ...(old?.sortIndex !== undefined ? { sortIndex: old.sortIndex } : {}), ...(old?.backupOriginalId ? { backupOriginalId: old.backupOriginalId } : {}) };
        const { id: templateId, builtin: _builtin, backupOriginalId: _origin, sortIndex: _order, ...revision } = row;
        tx.objectStore('templateRevisions').add({ ...revision, templateId }); rows.put(row); done(row);
      };
    });
  }
}
