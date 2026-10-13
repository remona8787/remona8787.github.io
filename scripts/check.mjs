import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');let count=0;
for(const relative of ['site-public-cleared/app.js','site-public-cleared/core.js','site-public-cleared/sw.js','site-public-cleared/account.js','site-public-cleared/catalog.js','client/cloud.js','client/private-photos.js','client/image-safety.js','client/native.js','admin/app.js','site-public-cleared/admin/app.js']){
 const r=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);count++;
}
const index=await readFile(path.join(root,'site-public-cleared/index.html'),'utf8');
for(const [,asset] of index.matchAll(/(?:src|href)="\.\/([^"#]+)"/g))await readFile(path.join(root,'dist',asset));
for(const name of ['refresh-media-rights','cache-commons-media','promote-candidate','sync-place-media','discover-city-candidates','sync-seoul-cultural-events','sync-global-places']){
 const source=await readFile(path.join(root,'edge-functions',name,'index.ts'),'utf8');if(!source.includes('authorizedSecret'))throw Error('Missing explicit auth check: '+name);
}
const admin=await readFile(path.join(root,'admin/app.js'),'utf8');if(admin!==await readFile(path.join(root,'site-public-cleared/admin/app.js'),'utf8'))throw Error('Admin copies diverged');
console.log(`Syntax checked ${count} scripts; local entry assets, auth guards, admin consistency passed.`);

const {transform}=await import('esbuild');
async function checkEdge(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await checkEdge(file);else if(entry.name.endsWith('.ts'))await transform(await readFile(file,'utf8'),{loader:'ts',sourcefile:file})}}
await checkEdge(path.join(root,'edge-functions'));console.log('All Edge Function TypeScript syntax checked (not server execution).');
