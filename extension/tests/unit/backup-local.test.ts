import {readFile} from 'node:fs/promises';
import 'fake-indexeddb/auto';
import {expect,test} from 'vitest';
import {payloadSchema} from '../../src/data/backup-format';
import {IndexedBackupStore} from '../../src/data/backup-store';

test.skipIf(!process.env.VCAMP_BACKUP_FILE)('local backup payload uses the current portable schemas',async()=>{
  const packet=JSON.parse(await readFile(process.env.VCAMP_BACKUP_FILE!,'utf8'));
  const result=payloadSchema.safeParse(packet.payload);
  const issues=result.success?[]:result.error.issues.slice(0,16).map(issue=>({path:issue.path,code:issue.code,message:issue.message}));
  expect(result.success,JSON.stringify(issues)).toBe(true);
});

test.skipIf(!process.env.VCAMP_BACKUP_FILE)('local backup opens a restore preview in an empty database',async()=>{
  const file=await readFile(process.env.VCAMP_BACKUP_FILE!,'utf8');
  const importer=new IndexedBackupStore(crypto.randomUUID());
  const plan=await importer.preview(file);await importer.execute(plan.planId,plan.checksum);
  const original=JSON.parse(file).payload,restored=JSON.parse(await importer.export()).payload;
  for(const table of ['attachments','workspaces','jobs','artifacts','noteRevisions','subtitleVersions','scribbles','folders','favorites'])expect(restored[table].length,table).toBe(original[table].length);
  await expect(new IndexedBackupStore(crypto.randomUUID()).preview(JSON.stringify(JSON.parse(await importer.export())))).resolves.toHaveProperty('planId');
},60000);
