import {cp,rm,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(await readFile(path.join(root,'.openai/hosting.json'),'utf8'));
if(manifest.static?.directory!=='dist')throw Error('Expected dist output');
await rm(path.join(root,'dist'),{recursive:true,force:true});
await mkdir(path.join(root,'dist'),{recursive:true});
await cp(path.join(root,'site-public-cleared'),path.join(root,'dist'),{recursive:true});
console.log('Built static app from site-public-cleared → dist');

const {build}=await import('esbuild');
await build({entryPoints:[path.join(root,'client/cloud.js'),path.join(root,'client/native.js'),path.join(root,'client/supabase.js')],bundle:true,minify:true,format:'esm',target:'es2022',outdir:path.join(root,'dist/assets')});
// Third-party browser libraries are self-hosted (pinned by package-lock) instead of loaded from public CDNs.
const leaflet=path.join(root,'node_modules/leaflet/dist');
await mkdir(path.join(root,'dist/assets/vendor/leaflet'),{recursive:true});
for(const f of ['leaflet.js','leaflet.css','images'])await cp(path.join(leaflet,f),path.join(root,'dist/assets/vendor/leaflet',f),{recursive:true});
