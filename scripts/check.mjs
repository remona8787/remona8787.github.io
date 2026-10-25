import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');let count=0;
for(const relative of ['site-public-cleared/app.js','site-public-cleared/core.js','site-public-cleared/sw.js','site-public-cleared/account.js','site-public-cleared/catalog.js','client/cloud.js','client/cloud-boot.js','client/private-photos.js','client/image-safety.js','client/native.js','admin/app.js','site-public-cleared/admin/app.js']){
 const r=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);count++;
}
const index=await readFile(path.join(root,'site-public-cleared/index.html'),'utf8');
for(const [,asset] of index.matchAll(/(?:src|href)="\.\/([^"#]+)"/g))await readFile(path.join(root,'dist',asset));
for(const name of ['refresh-media-rights','cache-commons-media','promote-candidate','sync-place-media','discover-city-candidates','sync-seoul-cultural-events','sync-global-places','archive-collect','archive-check-links']){
 const source=await readFile(path.join(root,'edge-functions',name,'index.ts'),'utf8');if(!source.includes('authorizedSecret'))throw Error('Missing explicit auth check: '+name);
}
// archive-websub is public by design (hubs call it): its guard is the HMAC check of every push, so require that
// explicitly instead of skipping it.
{const src=await readFile(path.join(root,'edge-functions/archive-websub/index.ts'),'utf8'),lib=await readFile(path.join(root,'edge-functions/_shared/archive/websub.mjs'),'utf8'),svc=await readFile(path.join(root,'edge-functions/_shared/archive/service.mjs'),'utf8');
 if(!src.includes('handlePush(')||!src.includes('signatureHeader(')||!/verifySignature\(body, signature, sub\.secret\)/.test(svc)||!lib.includes('crypto.subtle')||!/timingSafeEqual\(expected, sig\.hex\)/.test(lib))throw Error('Missing HMAC signature check: archive-websub');}
const admin=await readFile(path.join(root,'admin/app.js'),'utf8');if(admin!==await readFile(path.join(root,'site-public-cleared/admin/app.js'),'utf8'))throw Error('Admin copies diverged');
console.log(`Syntax checked ${count} scripts; local entry assets, auth guards (archive-websub: HMAC), admin consistency passed.`);

const {transform}=await import('esbuild');
async function checkEdge(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await checkEdge(file);else if(entry.name.endsWith('.ts'))await transform(await readFile(file,'utf8'),{loader:'ts',sourcefile:file})}}
await checkEdge(path.join(root,'edge-functions'));console.log('All Edge Function TypeScript syntax checked (not server execution).');
