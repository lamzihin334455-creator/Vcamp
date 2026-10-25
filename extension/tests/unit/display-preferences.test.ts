import 'fake-indexeddb/auto';
import {expect,test} from 'vitest';
import {IndexedBackupStore} from '../../src/data/backup-store';
import {IndexedStyleStore} from '../../src/data/style-store';
import {decode} from '../../src/data/backup-format';
import type {PortablePreferences,PortablePreferencesPort} from '../../src/contracts/portable-preferences';

test('global style and subtitle display preferences restore without a chat dependency',async()=>{
 const sourceName=crypto.randomUUID(),style=(await new IndexedStyleStore(sourceName).list()).find(item=>item.name==='新拟态')!;
 const current:PortablePreferences={htmlStyle:{styleId:style.id,revisionId:style.revisionId},subtitleFontSize:24,subtitleAuxiliaryFontSize:18,subtitleAutoReturn:false};
 const sourcePort:PortablePreferencesPort={async read(){return current;},async write(){}};
 const file=await new IndexedBackupStore(sourceName,sourcePort).export();expect((await decode(file)).payload.styleRevisions).toContainEqual(expect.objectContaining({revisionId:style.revisionId}));
 let restored:PortablePreferences={};const targetPort:PortablePreferencesPort={async read(){return structuredClone(restored);},async write(value){restored=structuredClone(value);}};
 const targetName=crypto.randomUUID(),target=new IndexedBackupStore(targetName,targetPort),plan=await target.preview(file);await target.execute(plan.planId,plan.checksum);
 expect(restored).toMatchObject({subtitleFontSize:24,subtitleAuxiliaryFontSize:18,subtitleAutoReturn:false});expect(await new IndexedStyleStore(targetName).revision(restored.htmlStyle!.styleId,restored.htmlStyle!.revisionId)).toMatchObject({name:'新拟态',description:style.description});
 expect((await target.preview(file)).added).toBe(0);
});
test('retired material style is absent from choices while its historical revision stays readable',async()=>{
 const store=new IndexedStyleStore(crypto.randomUUID()),choices=await store.list();expect(choices.map(item=>item.name)).toContain('新拟态');expect(choices.map(item=>item.name)).not.toContain('拟物风');
 expect(await store.revision('builtin-style-skeuomorphic','builtin-style-skeuomorphic:v1')).toMatchObject({name:'拟物风'});
 expect(choices.find(item=>item.name==='新拟态')!.description).toContain('Neumorphism');
});
