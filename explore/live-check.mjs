// Opens the public site in a real browser and records what a visitor sees: counts, data requests, console errors.
import {chromium} from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
await mkdir('explore/live',{recursive:true});
const b=await chromium.launch();const out={at:new Date().toISOString(),pages:{}};
for(const [w,h] of [[390,844],[1440,900]]){
 const ctx=await b.newContext({viewport:{width:w,height:h},locale:'ko-KR'});const p=await ctx.newPage();
 const reqs=[],errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,300))});p.on('pageerror',e=>errs.push('pageerror '+e.message));
 p.on('response',r=>{const u=r.url();if(/wikidata|wikimedia|\/data\//.test(u))reqs.push({u:u.slice(0,160),s:r.status()})});
 p.on('requestfailed',r=>{const u=r.url();if(/wikidata|wikimedia|\/data\//.test(u))reqs.push({u:u.slice(0,160),s:'FAILED '+(r.failure()?.errorText||'')})});
 await p.goto('https://remona8787.github.io/#home',{waitUntil:'load'});await p.waitForTimeout(25000);
 const home=await p.evaluate(()=>({h1:document.querySelector('#view h1')?.textContent,text:document.querySelector('#view')?.innerText.slice(0,600),global:window.AOL_GLOBAL?{status:window.AOL_GLOBAL.status,count:(window.AOL_GLOBAL.places||window.AOL_GLOBAL.list||[]).length,keys:Object.keys(window.AOL_GLOBAL)}:null}));
 await p.screenshot({path:`explore/live/home-${w}.png`});
 await p.goto('https://remona8787.github.io/#explore');await p.waitForTimeout(6000);
 const ex=await p.evaluate(()=>({text:document.querySelector('#view')?.innerText.slice(0,500)}));
 await p.screenshot({path:`explore/live/explore-${w}.png`});
 out.pages[w]={home,explore:ex,requests:reqs.slice(0,60),errors:errs.slice(0,30)};await ctx.close()}
await b.close();await writeFile('explore/live/check.json',JSON.stringify(out,null,1));
