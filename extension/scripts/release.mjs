import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {zipSync,unzipSync} from 'fflate';

const root=resolve('..'),dist=resolve(process.argv[2]??'dist');
const pkg=JSON.parse(await readFile('package.json','utf8'));
const manifest=JSON.parse(await readFile(resolve(dist,'manifest.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(manifest.version!==pkg.version.split('-')[0]||(manifest.version_name??manifest.version)!==pkg.version)throw Error('Package/manifest version mismatch');
if(!/^\d+(?:\.\d+){0,3}$/.test(manifest.version))throw Error('Invalid Chrome version');
if(manifest.host_permissions.some(p=>!p.startsWith('https://')))throw Error('Non-production host permission');
if(manifest.content_security_policy.extension_pages.includes('unsafe-'))throw Error('Unsafe extension CSP');
const entries={},inventory=[];
async function walk(dir){
  for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.isSymbolicLink())throw Error('Symlink in production bundle');
    const path=resolve(dir,entry.name),name=relative(dist,path).replaceAll('\\','/');
    if(entry.isDirectory()){if(!['assets','icons'].includes(name))throw Error('Unexpected build directory: '+name);await walk(path);continue;}
    if(!/^(?:manifest\.json|(?:sidepanel|reader|sandbox|executor)\.html|assets\/[\w.-]+\.(?:js|css)|icons\/(?:icon-\d+\.png|vcamp-(?:icon|logo|play)\.svg))$/.test(name))throw Error('Unexpected production file: '+name);
    const bytes=await readFile(path);
    if(/\.(?:js|html|json)$/.test(name)&&/https?:\/\/(?:127\.0\.0\.1|localhost)(?=[:/"'])|VCAMP_LIVE_API_KEY|-----BEGIN (?:RSA )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}/.test(bytes.toString('utf8')))throw Error('Private/test material in '+name);
    entries[name]=[bytes,{mtime:new Date('2026-01-01T00:00:00Z')}];
    inventory.push({path:name,bytes:bytes.length,sha256:hash(bytes)});
  }
}
await walk(dist);
for(const required of ['manifest.json','sidepanel.html','reader.html','sandbox.html','assets/background.js'])if(!entries[required])throw Error('Missing '+required);
for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md'])entries[name]=[await readFile(resolve(root,name)),{mtime:new Date('2026-01-01T00:00:00Z')}];
async function licenses(dir){for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=resolve(dir,entry.name);if(entry.isDirectory())await licenses(path);else entries[relative(root,path).replaceAll('\\','/')]=[await readFile(path),{mtime:new Date('2026-01-01T00:00:00Z')}];}}
await licenses(resolve(root,'third-party-licenses'));
const output=resolve(root,'out');await mkdir(output,{recursive:true});
const filename=`Vcamp-${pkg.version}.zip`,zip=zipSync(entries,{level:9});
const decoded=unzipSync(zip);
for(const [name,[bytes]]of Object.entries(entries))if(hash(decoded[name])!==hash(bytes))throw Error('Archive roundtrip failed');
if(Object.keys(decoded).length!==Object.keys(entries).length)throw Error('Archive file count mismatch');
await writeFile(resolve(output,filename),zip);
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const sourceTree=execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim().length>0;
const result={version:manifest.version,versionName:pkg.version,channel:pkg.version.includes('-')?'candidate':'stable',commit,sourceTree,dirty,node:process.version,platform:process.platform,architecture:process.arch,packageLockSha256:hash(await readFile('package-lock.json')),zip:filename,zipSha256:hash(zip),zipBytes:zip.length,archiveFiles:Object.keys(entries).length,inventory};
const metadata=JSON.stringify(result,null,2)+'\n';
await writeFile(resolve(output,'build-manifest.json'),metadata);
await writeFile(resolve(output,'SHA256SUMS.txt'),`${result.zipSha256}  ${filename}\n${hash(metadata)}  build-manifest.json\n`);
console.log(JSON.stringify({version:result.version,commit,dirty,zip:filename,sha256:result.zipSha256,files:inventory.length}));
