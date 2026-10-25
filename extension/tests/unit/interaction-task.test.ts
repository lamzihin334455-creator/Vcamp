import 'fake-indexeddb/auto';
import {test,expect,vi} from 'vitest';
import {createChromeTaskHost} from '../../src/generation/task-service';

test('allocating a generation executor never creates or navigates a browser tab',async()=>{
  const created:any[]=[],navigated:any[]=[];
  vi.stubGlobal('chrome',{runtime:{getURL:(p:string)=>'chrome-extension://fixture/'+p},tabs:{create:async(v:any)=>{created.push(v);return {id:42};},update:async(...v:any[])=>{navigated.push(v);},remove:async()=>{}}});
  try{const host=createChromeTaskHost();await host.create();expect(created).toEqual([]);expect(navigated).toEqual([]);}finally{vi.unstubAllGlobals();}
});
