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
// A floating pill, not a top bar: the app pins its sidebar and detail app bar to the top edge.
const banner=`<style>.preview-banner{position:fixed;z-index:1000;left:50%;transform:translateX(-50%);bottom:calc(var(--tabbar-h,64px) + env(safe-area-inset-bottom) + 12px);width:max-content;max-width:min(92vw,640px);display:flex;gap:10px;align-items:center;padding:8px 8px 8px 14px;border-radius:14px;font:500 12.5px/1.45 system-ui,-apple-system,sans-serif;background:#1C1F4A;color:#F4F1FF;box-shadow:0 6px 24px rgb(0 0 0/.25)}.preview-banner button{flex:none;min-width:32px;min-height:32px;border:0;border-radius:10px;background:#F4F1FF;color:#1C1F4A;font:600 13px system-ui,sans-serif;cursor:pointer}@media(min-width:768px){.preview-banner{bottom:16px}}</style>`;
const page=[...keep,banner,body.replace(configTag[0],configTag[0]+'<script src="./assets/preview-config.js"></script>')].join('\n');
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
await cp(dist,out,{recursive:true});
await writeFile(path.join(out,'index.html'),page+'\n');
await writeFile(path.join(out,'assets/preview-config.js'),`// Preview only: the viewer blocks third-party APIs, so external sync and the account backend are off.
Object.assign(window.AOL_CONFIG=window.AOL_CONFIG||{},{MEDIA_LIVE_SYNC:false,PLACE_GLOBAL_SYNC:false,SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:''});
window.AOL_PREVIEW=true;
document.addEventListener('DOMContentLoaded',()=>{const b=document.createElement('div');b.className='preview-banner';b.setAttribute('role','note');const t=document.createElement('span');t.textContent='미리보기 화면입니다. 사진, 전국·세계 장소 동기화, 지도 배경, 로그인은 실제 배포 주소에서만 동작합니다. 저장·코스·기록·백업은 여기서도 동작합니다.';const x=document.createElement('button');x.type='button';x.textContent='닫기';x.setAttribute('aria-label','미리보기 안내 닫기');x.onclick=()=>b.remove();b.append(t,x);document.body.append(b)});
`);
// The viewer blocks images from other hosts, so show the designed "photo pending" state instead of load errors.
await writeFile(path.join(out,'assets/reviewed-media.js'),'// Preview only: externally hosted photos are blocked in the viewer.\nwindow.AOL_REVIEWED_MEDIA=[];\n');
// Files the viewer cannot use: service worker (not allowed in the sandbox) and host config files.
for(const f of ['sw.js','_headers','netlify.toml','vercel.json','Dockerfile','DEPLOY.md'])await rm(path.join(out,f),{force:true});
console.log('Built preview/ from dist/ ('+keep.length+' head tags kept)');
