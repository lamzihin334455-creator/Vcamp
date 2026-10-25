import {afterEach,expect,test,vi} from 'vitest';
import {createChromeClient} from '../../src/app/chrome-client';

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
test('unanswered snapshot reads time out; task mutations keep their original single response and never retry',async()=>{
  vi.useFakeTimers();
  const requests:Array<{message:any;resolve:(response:unknown)=>void}>=[];
  vi.stubGlobal('chrome',{windows:{getCurrent:async()=>({id:1})},runtime:{sendMessage:(message:any)=>new Promise(resolve=>requests.push({message,resolve}))}});
  const client=createChromeClient(false),read=client.query();void read.catch(()=>{});
  await vi.advanceTimersByTimeAsync(8000);
  await expect(read).rejects.toMatchObject({code:'disconnected'});
  const target={kind:'chat' as const,workspaceId:'w',chatId:'c'};
  let settled=false;
  const stop=client.generation!({type:'generation.stop',jobId:crypto.randomUUID()}).then(value=>{settled=true;return value;});
  await vi.advanceTimersByTimeAsync(20000);
  expect(settled).toBe(false);expect(requests).toHaveLength(2);
  const response=(request:typeof requests[number],generation=false)=>({version:1,requestId:request.message.requestId,ok:true,view:{mode:'interactive',workspaceId:null,chatId:null,title:'',draft:null,...(generation?{generation:{target,jobs:[],messages:[]}}:{})}});
  requests[0].resolve(response(requests[0])); // late read is no longer applied
  requests[1].resolve(response(requests[1],true));
  expect(await stop).toMatchObject({target});expect(vi.getTimerCount()).toBe(0);
});
