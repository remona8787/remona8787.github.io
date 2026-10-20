// Live acceptance check on the public URL in a real browser: the visitor scenario, step by step, with evidence.
import {chromium} from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
const BASE='https://remona8787.github.io/', WANT=process.env.WANT_BUILD||'';
await mkdir('explore/live',{recursive:true});
for(let i=0;i<60;i++){try{const m=await (await fetch(BASE+'data/manifest.json?t='+Date.now())).json();if(!WANT||m.build_id===WANT)break}catch{}await new Promise(r=>setTimeout(r,10000))}
const b=await chromium.launch();const out={at:new Date().toISOString(),want:WANT,steps:{}};
const banned=['재확인 시점 경과','확인 기록 있음','검토 목록','편집 검수','자동 수집','미검수','수집 실패','검토 대기','수록 일정상','개발 진행 중'];
for(const [w,h] of [[390,844],[1440,900]]){
 const ctx=await b.newContext({viewport:{width:w,height:h},locale:'ko-KR'});const p=await ctx.newPage();const errs=[],bad=[];
 p.on('pageerror',e=>errs.push('pageerror '+e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200))});
 p.on('response',r=>{if(r.status()>=400)bad.push(r.status()+' '+r.url().slice(0,140))});
 const txt=async()=>(await p.locator('#view').innerText()).replace(/\s+/g,' ');
 const imgs=async()=>p.evaluate(()=>[...document.querySelectorAll('#view img')].filter(i=>i.getBoundingClientRect().height>40).map(i=>({ok:i.complete&&i.naturalWidth>0,src:i.currentSrc.slice(0,120)})));
 const S={};const t0=Date.now();
 await p.goto(BASE+'#home',{waitUntil:'load'});await p.waitForTimeout(6000);S.home={text:(await txt()).slice(0,500),images:await imgs(),ms:Date.now()-t0};await p.screenshot({path:`explore/live/1-home-${w}.png`});
 await p.goto(BASE+'#explore');await p.waitForTimeout(5000);S.explore={count:((await txt()).match(/전체 · [\d,]+곳/)||[])[0]};await p.screenshot({path:`explore/live/2-explore-${w}.png`});
 const q=p.locator('#placeSearch, input[type=search]').first();
 for(const term of ['Barcelona','Kraków','Montreal','Graz','Berlin','Seoul']){await q.fill(term);await p.waitForTimeout(1500);S['search_'+term]=((await txt()).match(/전체 · [\d,]+곳/)||[])[0]}
 await q.fill('');await p.waitForTimeout(800);
 const sel=p.locator('select[data-search-filter="country"]');if(await sel.count()){const opts=await sel.locator('option').allInnerTexts();S.country_options=opts.length-1;for(const c of ['스페인','캐나다','독일']){await sel.selectOption({label:c});await p.waitForTimeout(1500);S['country_'+c]=((await txt()).match(/전체 · [\d,]+곳|[\d,]+곳/)||[])[0]}await sel.selectOption({index:0})}
 await p.screenshot({path:`explore/live/3-filter-${w}.png`});
 await p.goto(BASE+'#map');await p.waitForTimeout(2000);const lb=p.getByRole('button',{name:/지도 불러오기/});if(await lb.count()){await lb.first().click()}await p.waitForTimeout(6000);
 S.map={text:(await txt()).match(/[^ ]+ · [\d,]+곳/g)?.slice(0,3),tiles:await p.locator('.leaflet-tile-loaded').count(),canvas:await p.locator('.leaflet-container canvas, .leaflet-marker-icon').count()};await p.screenshot({path:`explore/live/4-map-${w}.png`});
 for(const id of ['AR-CAT-0QJFC3C','AR-Q15014400','AR-CAT-06RUPY4']){await p.goto(BASE+'#place/'+id);await p.waitForTimeout(5000);S['detail_'+id]={text:(await txt()).slice(0,220),images:(await imgs()).slice(0,4)}}
 await p.screenshot({path:`explore/live/5-detail-${w}.png`});
 await p.reload();await p.waitForTimeout(5000);S.reload=(await txt()).slice(0,120);
 const found={};for(const r of ['#home','#explore','#place/AR-Q15014400','#settings','#data']){await p.goto(BASE+r);await p.waitForTimeout(2500);const all=await p.locator('body').innerText();const hit=banned.filter(x=>all.includes(x));if(hit.length)found[r]=hit}
 S.banned=found;S.progress_page=(await p.goto(BASE+'progress.html')).status();S.errors=errs.slice(0,20);S.http_errors=bad.slice(0,20);
 out.steps[w]=S;await ctx.close()}
await b.close();await writeFile('explore/live/check.json',JSON.stringify(out,null,1));
