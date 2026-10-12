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
await build({entryPoints:[path.join(root,'client/cloud.js'),path.join(root,'client/native.js'),path.join(root,'client/supabase.js'),path.join(root,'client/live-media.js')],bundle:true,minify:true,format:'esm',target:'es2022',outdir:path.join(root,'dist/assets')});
// Third-party browser libraries are self-hosted (pinned by package-lock) instead of loaded from public CDNs.
const leaflet=path.join(root,'node_modules/leaflet/dist');
await mkdir(path.join(root,'dist/assets/vendor/leaflet'),{recursive:true});
for(const f of ['leaflet.js','leaflet.css','images'])await cp(path.join(leaflet,f),path.join(root,'dist/assets/vendor/leaflet',f),{recursive:true});

// The service worker serves the shell cache-first, so its cache name must change whenever any cached file does.
// Derive it from the built files' contents instead of relying on a manual bump.
{
 const {createHash}=await import('node:crypto');
 const {writeFile}=await import('node:fs/promises');
 const swPath=path.join(root,'dist/sw.js');
 const sw=await readFile(swPath,'utf8');
 const assets=JSON.parse(sw.match(/const ASSETS=(\[[^\]]*\]);/)[1].replace(/'/g,'"'));
 const hash=createHash('sha256');
 for(const a of assets)hash.update(a).update(await readFile(path.join(root,'dist',a)));
 const name='aol-'+hash.digest('hex').slice(0,12);
 if(!/const CACHE='[^']*';/.test(sw))throw Error('sw.js CACHE declaration not found');
 await writeFile(swPath,sw.replace(/const CACHE='[^']*';/,`const CACHE='${name}';`));
 console.log('Service worker cache',name);
}
