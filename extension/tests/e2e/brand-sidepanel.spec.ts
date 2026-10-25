import {test,expect,chromium,type CDPSession} from '@playwright/test';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

async function attach(client:CDPSession,targetId:string){
  const {sessionId}=await client.send('Target.attachToTarget',{targetId,flatten:false});
  let sequence=0;
  return async(method:string,params:object={})=>{
    const id=++sequence;
    return new Promise<any>((done,fail)=>{
      const timer=setTimeout(()=>{client.off('Target.receivedMessageFromTarget',receive);fail(Error('CDP timeout: '+method));},5000);
      const receive=(event:any)=>{if(event.sessionId!==sessionId)return;const message=JSON.parse(event.message);if(message.id!==id)return;clearTimeout(timer);client.off('Target.receivedMessageFromTarget',receive);message.error?fail(Error(JSON.stringify(message.error))):done(message.result);};
      client.on('Target.receivedMessageFromTarget',receive);
      void client.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(fail);
    });
  };
}

for(const motion of ['no-preference','reduce'] as const)test(`native side panel displays startup on first open and close/reopen (${motion})`,async()=>{
  await mkdir('.profiles',{recursive:true});
  const extension=resolve(process.env.BRAND_EXTENSION??process.env.EXPERIENCE_BUNDLE??'dist');
  // Native SIDE_PANEL targets are not Playwright pages, so context media
  // emulation does not cover them. Pin the browser preference before creation.
  const motionFlag=motion==='reduce'?'--force-prefers-reduced-motion':'--force-prefers-no-reduced-motion';
  const context=await chromium.launchPersistentContext(await mkdtemp(resolve('.profiles/NativeBrand-')),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,motionFlag]});
  try{
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
    const origin=`chrome-extension://${new URL(worker.url()).host}`;
    await worker.evaluate(()=>{(globalThis as any).panelEvents=[];(chrome.sidePanel as any).onOpened?.addListener((e:any)=>(globalThis as any).panelEvents.push({kind:'open',...e}));(chrome.sidePanel as any).onClosed?.addListener((e:any)=>(globalThis as any).panelEvents.push({kind:'close',...e}));});
    const page=await context.newPage();await page.goto(`${origin}/reader.html?library=1`);
    const client=await context.newCDPSession(page);
    for(let round=0;round<2;round++){
      const opened=await client.send('Runtime.evaluate',{expression:'chrome.windows.getCurrent().then(w=>chrome.sidePanel.open({windowId:w.id}))',awaitPromise:true,userGesture:true,returnByValue:true});
      expect(opened.exceptionDetails).toBeUndefined();
      let targetId='';
      await expect.poll(async()=>{targetId=(await client.send('Target.getTargets')).targetInfos.find(t=>t.url===`${origin}/sidepanel.html`)?.targetId??'';return !!targetId;}).toBe(true);
      const rpc=await attach(client,targetId);
      const contexts=await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']}));
      expect(contexts).toHaveLength(1);
      const sampling=rpc('Runtime.evaluate',{expression:`new Promise(resolve=>{const samples=[];let count=0;const timer=setInterval(()=>{const overlay=document.querySelector('[data-testid="launch-overlay"]');samples.push({reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,hidden:document.hidden,visibility:document.visibilityState,width:innerWidth,height:innerHeight,overlay:!!overlay,rotation:overlay?.querySelector('[data-rotation]')?.getAttribute('data-rotation'),opacity:overlay?getComputedStyle(overlay).opacity:null});if(++count===80){clearInterval(timer);resolve(samples)}},25)})`,awaitPromise:true,returnByValue:true});
      await mkdir(`test-results/native-brand/${motion}`,{recursive:true});
      await rpc('Runtime.evaluate',{expression:`new Promise(resolve=>{let n=0;const timer=setInterval(()=>{const angle=Number(document.querySelector('[data-rotation]')?.getAttribute('data-rotation'));if(angle>20||++n>80){clearInterval(timer);resolve(angle)}},10)})`,awaitPromise:true});
      const screenshot=await rpc('Page.captureScreenshot',{format:'png'});
      await writeFile(`test-results/native-brand/${motion}/round-${round}.png`,Buffer.from(screenshot.data,'base64'));
      const sample=await sampling;
      await writeFile(`test-results/native-brand/${motion}/round-${round}.json`,JSON.stringify(sample.result.value,null,2));
      expect(sample.result.value.every((s:any)=>s.reducedMotion===(motion==='reduce'))).toBe(true);
      expect(sample.result.value.some((s:any)=>s.overlay&&!s.hidden),'visible native panel must actually show the launch overlay').toBe(true);
      if(motion==='reduce')expect(sample.result.value.filter((s:any)=>s.overlay).every((s:any)=>+s.rotation===0)).toBe(true);
      else expect(sample.result.value.some((s:any)=>s.rotation&&+s.rotation>20)).toBe(true);
      expect(sample.result.value.some((s:any)=>s.opacity&&+s.opacity>0&&+s.opacity<.8)).toBe(true);
      expect(sample.result.value.at(-1).overlay).toBe(false);
      await client.send('Runtime.evaluate',{expression:'chrome.windows.getCurrent().then(w=>chrome.sidePanel.close({windowId:w.id}))',awaitPromise:true,userGesture:true});
      await expect.poll(async()=>await worker.evaluate(()=>(globalThis as any).panelEvents.filter((e:any)=>e.kind==='close').length)).toBe(round+1);
    }
  }finally{await context.close();}
});
