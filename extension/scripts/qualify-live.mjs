import {build} from 'esbuild';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
const [envPath,privateDirectory]=process.argv.slice(2);
if(!envPath||!privateDirectory)throw Error('Provide ENV path and private ledger directory');
try{
  await mkdir('.tmp',{recursive:true});const output=resolve('.tmp/release-live.mjs');
  await build({entryPoints:['tests/manual/release-live.ts'],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@provider-endpoint':resolve('src/generation/provider-endpoint.ts')},logLevel:'silent'});
  const {qualify}=await import(pathToFileURL(output).href);await qualify(resolve(envPath),resolve(privateDirectory));
  console.log('Qualification finished; inspect the private result and request ledger.');
}catch{console.error('Qualification failed; no transport objects or credentials printed. Inspect the private ledger.');process.exitCode=1;}
