import 'fake-indexeddb/auto';
import {expect,test,vi} from 'vitest';
import {IndexedLibraryStore} from '../../src/data/library-store';
import {IndexedWorkspaceStore} from '../../src/data/indexed-store';

test('repeated playback observations repair sibling covers once without scanning and rewriting history every time',async()=>{
  const name=`observation-pressure-${crypto.randomUUID()}`,spaces=new IndexedWorkspaceStore(name),library=new IndexedLibraryStore(name);
  const source={platform:'bilibili' as const,videoId:'BVpressure',partId:'11',title:'视频',coverUrl:'https://i0.hdslb.com/bfs/archive/cover.jpg'};
  const first=await spaces.open(source),sibling=await spaces.open({...source,partId:'12',coverUrl:undefined});
  const other=await spaces.open({...source,videoId:'BVother',coverUrl:undefined});
  const scan=vi.spyOn(IDBObjectStore.prototype,'getAll');
  const write=vi.spyOn(IDBObjectStore.prototype,'put');
  try{
    for(let index=0;index<25;index++)await library.recordObservation(source,index,1000+index);
    expect(scan.mock.calls.length,'playback should scan sibling history once, not once per event').toBe(1);
    expect(write.mock.calls.length).toBe(26); // 25 current positions, one sibling repair
    expect((await spaces.read(sibling.id))?.source.coverUrl).toBe(source.coverUrl);
    expect((await spaces.read(other.id))?.source.coverUrl).toBeUndefined();
    expect((await library.resolve({workspaceId:first.id,entityType:'workspace',id:first.id})).position).toBe(24);
    const changed={...source,coverUrl:'https://i0.hdslb.com/bfs/archive/new.jpg'};
    const scans=scan.mock.calls.length;
    await library.recordObservation(changed,25,2000);
    expect(scan.mock.calls.length).toBe(scans+1);
    expect((await spaces.read(sibling.id))?.source.coverUrl).toBe(changed.coverUrl);
    await library.recordObservation(source,0,900); // stale events cannot revert cover or position
    expect((await spaces.read(sibling.id))?.source.coverUrl).toBe(changed.coverUrl);
  }finally{scan.mockRestore();write.mockRestore();}
});
