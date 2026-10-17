// Builds preview/ from dist/ for hosting inside a sandboxed page viewer (e.g. a claude.ai artifact link).
// Such viewers wrap the page in their own document and block third-party requests, so the preview:
// - keeps only <title>, description and stylesheet links from <head> plus the full <body>,
// - turns off the Wikidata/Commons sync and the account backend (they would only time out),
// - shows a banner saying which parts need the real deployment.
// Usage: npm run build && node scripts/build-preview.mjs
import {cp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),dist=path.join(root,'dist'),out=path.join(root,'preview');
const html=await readFile(path.join(dist,'index.html'),'utf8').catch(()=>{throw Error('dist/index.html missing: run npm run build first')});
const head=(html.match(/<head>([\s\S]*?)<\/head>/i)||[])[1]||'';
const body=(html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)||[])[1];
if(!body)throw Error('dist/index.html has no <body>');
const keep=[...head.matchAll(/<title>[\s\S]*?<\/title>|<meta name="description"[^>]*>|<link rel="stylesheet"[^>]*>/gi)].map(m=>m[0]);
if(!keep.some(t=>/^<title>/i.test(t)))throw Error('dist/index.html has no <title>');
const configTag=body.match(/<script src="\.\/config\.js"><\/script>/);
if(!configTag)throw Error('config.js script tag not found in dist/index.html');
const banner=`<style>.preview-banner{position:sticky;top:0;z-index:1000;padding:10px 16px;font:500 13px/1.5 system-ui,-apple-system,sans-serif;background:#1C1F4A;color:#F4F1FF;text-align:center}</style>`;
const page=[...keep,banner,body.replace(configTag[0],configTag[0]+'<script src="./assets/preview-config.js"></script>')].join('\n');
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
await cp(dist,out,{recursive:true});
await writeFile(path.join(out,'index.html'),page+'\n');
await writeFile(path.join(out,'assets/preview-config.js'),`// Preview only: the viewer blocks third-party APIs, so external sync and the account backend are off.
Object.assign(window.AOL_CONFIG=window.AOL_CONFIG||{},{MEDIA_LIVE_SYNC:false,PLACE_GLOBAL_SYNC:false,SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:''});
window.AOL_PREVIEW=true;
document.addEventListener('DOMContentLoaded',()=>{const b=document.createElement('div');b.className='preview-banner';b.setAttribute('role','note');b.textContent='미리보기 화면입니다. 사진, 전국·세계 장소 동기화, 지도 배경, 로그인은 실제 배포 주소에서만 동작합니다. 저장·코스·기록·백업은 여기서도 동작합니다.';document.body.prepend(b)});
`);
// Files the viewer cannot use: service worker (not allowed in the sandbox) and host config files.
for(const f of ['sw.js','_headers','netlify.toml','vercel.json','Dockerfile','DEPLOY.md'])await rm(path.join(out,f),{force:true});
console.log('Built preview/ from dist/ ('+keep.length+' head tags kept)');
