import {build} from 'esbuild';
import {mkdir,access,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// No browser profile, installed extension, credential store, or UI access.
const input=process.argv[2];
let key=process.env.VCAMP_LIVE_API_KEY;
if(!key){try{const config=await readFile('.env.local','utf8');key=/^DEEPSEEK_API_KEY=([^\r\n]+)$/m.exec(config)?.[1];}catch{}}
if(!input||!key){
  process.stderr.write('Not run: supply the real subtitle input file and local VCAMP_LIVE_API_KEY. No API calls made.\n');
  process.exitCode=2;
}else{
  try{
    if(!['--images','--video','--video-resume','--workflow','--extension-workflow'].includes(input))await access(input);
    const directory=resolve('.tmp/live-vision');await mkdir(directory,{recursive:true});
    const module=resolve(directory,'runner.mjs');
    await build({entryPoints:[input==='--extension-workflow'?'tests/manual/vision-extension-workflow.ts':input==='--workflow'?'tests/manual/vision-workflow.ts':input==='--images'?'tests/manual/vision-real-images.ts':input?.startsWith('--video')?'tests/manual/vision-real-video.ts':'tests/manual/vision-live.ts'],outfile:module,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@provider-endpoint':resolve('src/generation/provider-endpoint.ts')},logLevel:'silent'});
    const runner=await import(pathToFileURL(module).href);
    if(input==='--extension-workflow')await runner.runExtensionWorkflow(directory,key);
    else if(input==='--workflow')await runner.runWorkflow(directory,key);
    else if(input==='--images')await runner.runRealImages(directory,key);
    else if(input?.startsWith('--video'))await runner.runRealVideo(directory,key,input==='--video-resume');
    else await runner.runLiveVision(resolve(input),resolve(directory,'result.json'),key,Number(process.argv[3]??3));
  }catch{
    // Avoid printing transport objects, headers, request text or credentials.
    process.stderr.write('Live qualification did not pass. Check local input and .tmp/live-vision/result.json if present.\n');
    process.exitCode=1;
  }
}
