import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
// Always test fresh bundles. Keep the developer's installed dist untouched.
function run(script,args,env=process.env){
  const result=spawnSync(process.execPath,[resolve(script),...args],{stdio:'inherit',env});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
const production=resolve('.tmp/qa-production');
run('node_modules/vite/bin/vite.js',['build','--outDir',production]);
run('node_modules/vite/bin/vite.js',['build','--mode','test-extension']);
run('node_modules/vite/bin/vite.js',['build','--mode','capture-test']);
run('node_modules/@playwright/test/cli.js',['test',...process.argv.slice(2)],{...process.env,EXPERIENCE_BUNDLE:production});
