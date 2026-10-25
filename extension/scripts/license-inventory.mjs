import {readFile,writeFile,mkdir,copyFile,readdir,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const rows=[];
for(const [path,info] of Object.entries(lock.packages)){
  if(!path||info.dev||info.optional)continue;
  const name=path.split('node_modules/').at(-1),pkg=JSON.parse(await readFile(resolve(path,'package.json'),'utf8'));
  const licenses=(await readdir(path)).filter(n=>/^(license|copying)(\.|$)/i.test(n));
  if(!licenses.length)throw Error('Missing license: '+name);
  const destination=`third-party-licenses/${name.replace('@','').replaceAll('/','__')}-${info.version}`;
  await mkdir(resolve('..',destination),{recursive:true});
  for(const file of licenses)await copyFile(resolve(path,file),resolve('..',destination,file));
  rows.push({name,version:info.version,license:pkg.license??info.license??'UNKNOWN',path:destination});
}
rows.sort((a,b)=>a.name.localeCompare(b.name));
// Remove only obsolete generated dependency directories after every current
// license has been found and copied successfully.
const licenseRoot=resolve('..','third-party-licenses');
const retained=new Set(rows.map(row=>resolve('..',row.path)));
for(const entry of await readdir(licenseRoot,{withFileTypes:true})){
  const target=resolve(licenseRoot,entry.name);
  if(dirname(target)!==licenseRoot)throw Error('License path escaped output root');
  if(entry.isDirectory()&&!entry.isSymbolicLink()&&!retained.has(target))await rm(target,{recursive:true});
}
const text='# Third-party notices\n\nGenerated from the production lockfile and installed package license texts. Project-owned code uses MIT; these dependencies retain their original licenses. Development tools and the separate video project have their own licenses.\n\n| Package | Version | License | Text |\n| --- | --- | --- | --- |\n'+rows.map(r=>`| ${r.name} | ${r.version} | ${r.license} | [license](${r.path}/) |`).join('\n')+'\n';
await writeFile('../THIRD_PARTY_NOTICES.md',text);
console.log(JSON.stringify({productionPackages:rows.length,licenses:[...new Set(rows.map(r=>r.license))]}));
