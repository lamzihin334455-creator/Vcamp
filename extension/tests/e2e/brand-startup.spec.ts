import {test,expect,chromium,type Page} from '@playwright/test';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const evidence=resolve('test-results/brand-startup');
async function install(reducedMotion:'reduce'|'no-preference'='no-preference'){
  await mkdir(evidence,{recursive:true});
  await mkdir(resolve('.profiles'),{recursive:true});
  const profile=await mkdtemp(resolve('.profiles/BrandStartup-'));
  const extension=resolve(process.env.EXPERIENCE_BUNDLE ?? 'dist');
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:400,height:800},reducedMotion,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  await context.route(/^https?:/,route=>route.abort());
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>{globalThis.fetch=async()=>{throw Error('No external network in brand test');};});
  const origin=`chrome-extension://${new URL(worker.url()).host}`;
  return {context,origin};
}
async function observe(page:Page){
  await page.addInitScript(()=>{
    const state={samples:[] as {time:number;opacity:number;rotation:number;childOpacity:number;pointer:string;w:number;h:number;cx:number;cy:number;stageX:number;stageY:number}[],ended:0,errors:[] as string[]};
    (window as any).startupEvidence=state;
    document.addEventListener('securitypolicyviolation',event=>state.errors.push(JSON.stringify({directive:event.violatedDirective,blocked:event.blockedURI,source:event.sourceFile,line:event.lineNumber,sample:event.sample})));
    let started=0;
    function sample(){
      const overlay=document.querySelector<HTMLElement>('[data-testid="launch-overlay"]');
      if(overlay){
        if(!started)started=performance.now();
        const mark=overlay.querySelector('svg')!.getBoundingClientRect(),stage=overlay.getBoundingClientRect();
        state.samples.push({time:performance.now()-started,opacity:Number(getComputedStyle(overlay).opacity),rotation:Number(overlay.querySelector('[data-rotation]')!.getAttribute('data-rotation')),childOpacity:Number(getComputedStyle(overlay.firstElementChild!).opacity),pointer:getComputedStyle(document.querySelector('[data-testid="startup"]')!).pointerEvents,w:mark.width,h:mark.height,cx:mark.x+mark.width/2,cy:mark.y+mark.height/2,stageX:stage.x+stage.width/2,stageY:stage.y+stage.height/2});
      }else if(started&&!state.ended){state.ended=performance.now()-started;}
      if(performance.now()<5000)requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
}

test('production startup: shared fade, original UI usable, no replay on interaction, reopen replays',async()=>{
  const {context,origin}=await install();
  try{
    const page=await context.newPage();
    const errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await observe(page);
    await page.goto(`${origin}/sidepanel.html`);
    await expect(page.getByTestId('startup')).toHaveCount(1);
    await page.screenshot({path:resolve(evidence,'01-v-logo.png')});
    await page.waitForFunction(()=>{const e=document.querySelector('[data-testid="launch-overlay"]');return e&&+getComputedStyle(e).opacity<.8&&+getComputedStyle(e).opacity>.15;});
    await page.screenshot({path:resolve(evidence,'02-shared-fade.png')});
    await expect(page.getByTestId('startup')).toHaveCount(0,{timeout:2500});
    const data=await page.evaluate(()=>(window as any).startupEvidence);
    await writeFile(resolve(evidence,'csp-events.json'),JSON.stringify(data,null,2));
    // Same two automation eval probes reproduced on unchanged 0.1.29; no application-script violations.
    expect(data.errors).toEqual(Array(2).fill(JSON.stringify({directive:'script-src',blocked:'eval',source:'chrome-extension',line:1,sample:''})));
    expect(errors).toEqual([]);
    expect(data.samples.length).toBeGreaterThan(15);
    expect(data.samples.some((s:any)=>s.opacity>.15&&s.opacity<.8)).toBe(true);
    expect(data.samples.every((s:any)=>s.childOpacity===1&&s.pointer==='none'&&s.w>100&&Math.abs(s.cx-s.stageX)<1&&Math.abs(s.cy-s.stageY)<1)).toBe(true);
    expect(data.samples.at(-1).opacity).toBeLessThan(.05);
    expect(data.ended).toBeGreaterThan(1000);
    expect(data.ended).toBeLessThan(1700);
    await page.getByRole('button',{name:'设置',exact:true}).click();
    await expect(page.getByTestId('startup')).toHaveCount(0);
    await page.screenshot({path:resolve(evidence,'03-settings-usable.png')});
    await page.close();
    const reopened=await context.newPage();
    await reopened.goto(`${origin}/sidepanel.html`);
    await expect(reopened.getByTestId('startup')).toHaveCount(1);
    // The actual control beneath the layer can be clicked while the animation is present.
    await reopened.getByRole('button',{name:'设置',exact:true}).click();
    await expect(reopened.getByRole('button',{name:'API 设置',exact:true})).toBeVisible();
    await expect(reopened.getByTestId('startup')).toHaveCount(0);
    await writeFile(resolve(evidence,'normal-samples.json'),JSON.stringify(data,null,2));
  }finally{await context.close();}
});

test('production reduced motion, narrow viewport, reader exclusion and icon metadata',async()=>{
  const {context,origin}=await install('reduce');
  try{
    const page=await context.newPage();
    await page.setViewportSize({width:320,height:600});
    await observe(page);
    await page.goto(`${origin}/sidepanel.html`);
    await expect(page.getByTestId('startup')).toHaveCount(0,{timeout:2000});
    const data=await page.evaluate(()=>(window as any).startupEvidence);
    expect(data.samples.length).toBeGreaterThan(2);
    expect(data.samples.every((s:any)=>s.rotation===0&&Math.abs(s.cx-s.stageX)<1)).toBe(true);
    expect(data.ended).toBeLessThan(600);
    // Same two automation eval probes reproduced on unchanged 0.1.29; no application-script violations.
    expect(data.errors).toEqual(Array(2).fill(JSON.stringify({directive:'script-src',blocked:'eval',source:'chrome-extension',line:1,sample:''})));
    await page.screenshot({path:resolve(evidence,'04-reduced-320.png')});
    await page.goto(`${origin}/reader.html?library=1`);
    await expect(page.getByTestId('startup')).toHaveCount(0);
    const bundle=resolve(process.env.EXPERIENCE_BUNDLE??'dist');
    const manifest=JSON.parse(await readFile(resolve(bundle,'manifest.json'),'utf8'));
    expect(manifest.version).toBe(JSON.parse(await readFile('package.json','utf8')).version.split('-')[0]);
    expect(manifest.version_name).toBe(JSON.parse(await readFile('package.json','utf8')).version);
    expect(manifest.icons['128']).toBe('icons/icon-128.png');
    expect(manifest.action.default_icon['16']).toBe('icons/icon-16.png');
    for(const size of [16,32,48,128,256]){
      const png=await readFile(resolve(bundle,`icons/icon-${size}.png`));
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
    await writeFile(resolve(evidence,'reduced-samples.json'),JSON.stringify(data,null,2));
  }finally{await context.close();}
});

test('production wide resize does not restart; motion preference change fades safely',async()=>{
  const {context,origin}=await install();
  try{
    const page=await context.newPage();
    await page.setViewportSize({width:1000,height:700});
    await page.goto(`${origin}/sidepanel.html`);
    await expect(page.getByTestId('startup')).toHaveCount(1);
    await page.setViewportSize({width:480,height:600});
    await page.emulateMedia({reducedMotion:'reduce'});
    await expect(page.getByTestId('startup')).toHaveCount(0,{timeout:1200});
    await expect(page.getByRole('button',{name:'设置',exact:true})).toBeEnabled();
    await page.screenshot({path:resolve(evidence,'05-resized-ready.png')});
  }finally{await context.close();}
});

test('side-panel visibility lifecycle: hidden mount waits, visible starts, reveal after hide restarts',async()=>{
  const {context,origin}=await install();
  try{
    const page=await context.newPage();
    // Deterministically reproduce Chromium creating the panel before showing its document.
    await page.addInitScript(()=>{
      let hidden=true;
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});
      (window as any).setPanelVisible=(visible:boolean)=>{hidden=!visible;document.dispatchEvent(new Event('visibilitychange'));};
    });
    await page.goto(`${origin}/sidepanel.html`);
    await expect(page.getByRole('button',{name:'设置',exact:true})).toBeEnabled();
    await expect(page.getByTestId('startup')).toHaveCount(0);
    await page.evaluate(()=>(window as any).setPanelVisible(true));
    await expect(page.getByTestId('startup')).toHaveCount(1,{timeout:1000});
    await expect(page.locator('[data-rotation]')).not.toHaveAttribute('data-rotation','0');
    await expect(page.getByTestId('startup')).toHaveCount(0,{timeout:2500});
    await page.evaluate(()=>(window as any).setPanelVisible(false));
    await page.evaluate(()=>(window as any).setPanelVisible(true));
    await expect(page.getByTestId('startup')).toHaveCount(1,{timeout:1000});
    await expect(page.getByTestId('startup')).toHaveCount(0,{timeout:2500});
    // Focus and component interaction are not panel-open signals.
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.getByRole('button',{name:'设置',exact:true}).click();
    await expect(page.getByTestId('startup')).toHaveCount(0);
  }finally{await context.close();}
});
