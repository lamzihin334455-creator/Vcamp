// Read-only live-site smoke test in a disposable profile. It stores only status
// and counts, never transcript bodies, cookies or account state.
import {chromium} from '@playwright/test';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const [bundlePath,outputPath,videoUrl='https://www.bilibili.com/video/BV1Y3rHBSE1n/']=process.argv.slice(2);
if(!bundlePath||!outputPath)throw Error('Provide a production bundle and private evidence directory');
const url=new URL(videoUrl);if(url.origin!=='https://www.bilibili.com'||!url.pathname.startsWith('/video/'))throw Error('Unsupported site target');
const output=resolve(outputPath);await mkdir(output,{recursive:true});await mkdir('.profiles',{recursive:true});
const bundle=resolve(bundlePath),profile=await mkdtemp(resolve('.profiles/ReleaseSite-'));
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--load-extension=${bundle}`,`--disable-extensions-except=${bundle}`]});
const report={target:videoUrl,browser:context.browser()?.version(),isolatedProfile:true,loggedIn:false,paidRequests:0,passed:false,status:'starting'};
try{
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),page=await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
  const site=await context.newPage();await site.goto(videoUrl,{waitUntil:'domcontentloaded',timeout:30000});await site.bringToFront();
  const deadline=Date.now()+40000;
  while(Date.now()<deadline){
    const result=await page.evaluate(async()=>{
      const response=await chrome.runtime.sendMessage({version:1,requestId:crypto.randomUUID(),windowId:(await chrome.windows.getCurrent()).id,operation:{type:'workspace.query'}});
      const video=response.view?.video;
      return {ok:response.ok,status:video?.status??'unbound',cueCount:video?.cues?.length??0,videoId:video?.binding?.videoId,partId:video?.binding?.partId};
    });
    Object.assign(report,result);
    if(result.status==='ready'&&result.cueCount>0){report.passed=true;break;}
    if(['no-subtitles','auth-failed','permission-denied','unsupported','network','protocol'].includes(result.status))break;
    await new Promise(done=>setTimeout(done,1000));
  }
}catch(error){report.status=error instanceof Error&&error.name==='TimeoutError'?'site-timeout':'site-failed';}
finally{await writeFile(resolve(output,'live-site-smoke.json'),JSON.stringify(report,null,2));await context.close();}
console.log(JSON.stringify(report));
