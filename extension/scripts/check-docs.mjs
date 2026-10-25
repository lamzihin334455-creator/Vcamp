import {execFileSync} from 'node:child_process';
import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const root=resolve('..');
const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(name=>name.endsWith('.md')))];
const findings=[];let checked=0;
for(const name of files){
  const path=resolve(root,name);let source;
  try{source=await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')continue;throw error;}
  // Code examples are literal text, not navigable project documentation links.
  source=source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm,'').replace(/`[^`\n]+`/g,'');checked++;
  for(const match of source.matchAll(/\]\(([^)\n]+)\)/g)){
    const href=match[1].split(' "')[0].replace(/^<|>$/g,'');
    if(!href||href.startsWith('#')||/^[A-Za-z][\w+.-]*:/.test(href))continue;
    let target;try{target=decodeURIComponent(href.split('#')[0]);}catch{findings.push({file:name,href,reason:'invalid URI'});continue;}
    try{await stat(resolve(dirname(path),target));}catch{findings.push({file:name,href,reason:'missing local target'});}
  }
}
console.log(JSON.stringify({checked,findings},null,2));if(findings.length)process.exitCode=1;
