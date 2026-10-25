import {build} from 'esbuild';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
let key=process.env.VCAMP_LIVE_API_KEY;
if(!key){try{key=/^DEEPSEEK_API_KEY=([^\r\n]+)$/m.exec(await readFile('.env.local','utf8'))?.[1];}catch{}}
if(!key)throw Error('Missing local key. No request made.');
const directory=resolve('.tmp/live-subtitle-0.1.59');await mkdir(directory,{recursive:true});
await build({entryPoints:['tests/manual/subtitle-live.ts'],outfile:resolve(directory,'runner.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@provider-endpoint':resolve('src/generation/provider-endpoint.ts')},logLevel:'silent'});
await (await import(pathToFileURL(resolve(directory,'runner.mjs')).href)).run(directory,key,process.argv[2]??'probe');
