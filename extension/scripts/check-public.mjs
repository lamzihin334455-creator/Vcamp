import {execFileSync} from 'node:child_process';
import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve('..');
const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))];
const rules=[
  ['provider credential',/\bsk-[A-Za-z0-9_-]{20,}/],
  ['GitHub credential',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})/],
  ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['AWS credential',/\bAKIA[A-Z0-9]{16}\b/],
  ['personal machine path',/[CD]:[\\/]+Users[\\/]+[^\s"']+/i],
];
const findings=[];let checked=0;
for(const file of files){
  const path=resolve(root,file);
  try{if(!(await stat(path)).isFile())continue;}catch(error){if(error.code==='ENOENT')continue;throw error;}
  if(/(?:^|\/)(?:\.env(?:\..*)?|node_modules|\.profiles|\.tmp|test-results[^/]*|dist(?:-test|-capture)?)(?:\/|$)/.test(file)&&!file.endsWith('.env.example'))findings.push({file,rule:'excluded material'});
  const content=(await readFile(path)).toString('utf8');checked++;
  for(const [rule,pattern]of rules)if(pattern.test(content))findings.push({file,rule});
}
// Values and matching excerpts are deliberately never printed.
console.log(JSON.stringify({checked,findings},null,2));
if(findings.length)process.exitCode=1;
