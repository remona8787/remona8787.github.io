// Visits every SPA route and static page at phone and desktop widths.
// Fails on uncaught errors, same-origin request failures, horizontal overflow, or tap targets below 24px.
// The static archive dataset is served at /data/ as in production (the test fixture; qa/v17.spec.mjs covers a host
// without it).
import {test,expect} from './fixtures.mjs';
import {serveDataset,serveImages} from './fixtures/site-data-routes.mjs';
const routes=['home','explore','map','saved','my','magazine','routes','journal','calendar','account','settings','data','place/SEOUL001','place/AR-ars-electronica-center','place/AR-medialab-prado','curation/CUR001','nope'];
const pages=['about.html','privacy.html','terms.html','support.html','delete-account.html','404.html','admin/','nope/deep/path'];
for(const width of [360,1440]){
 for(const target of [...routes.map(r=>'/#'+r),...pages.map(p=>'/'+p)]){
  test(`${target} @${width}`,async({page,baseURL})=>{
   const errors=[];
   page.on('pageerror',e=>errors.push('pageerror: '+e.message));
   page.on('console',m=>{if(m.type()==='error'&&!/ERR_TUNNEL|ERR_PROXY|net::ERR|Failed to load resource/.test(m.text()))errors.push('console: '+m.text())});
   page.on('requestfailed',r=>{if(r.url().startsWith(baseURL))errors.push('requestfailed: '+r.url())});
   page.on('response',r=>{if(r.url().startsWith(baseURL)&&r.status()>=400&&!target.includes('nope'))errors.push(`http ${r.status()}: ${r.url()}`)});
   await serveDataset(page);await serveImages(page);
   await page.setViewportSize({width,height:width<500?800:900});
   await page.goto(target);await page.waitForLoadState('networkidle');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
   const wide=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>document.documentElement.clientWidth+1&&getComputedStyle(e).position!=='fixed'&&!e.closest('[class*=scroll],.chips,.rail,.carousel,[style*=overflow]')}).slice(0,5).map(e=>e.tagName+'.'+e.className+' right='+Math.round(e.getBoundingClientRect().right)));
   const small=await page.evaluate(()=>[...document.querySelectorAll('a,button,input,select,textarea,summary')].filter(e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&(r.height<24||r.width<24)&&!(e.tagName==='A'&&getComputedStyle(e.parentElement).display.includes('inline')===false&&s.display==='inline')}).slice(0,8).map(e=>`${e.tagName} "${(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,20)}" ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
   const slug=target.replace(/[^a-z0-9]+/gi,'_');
   await page.screenshot({path:`qa/artifacts/crawl/${slug}-${width}.png`,fullPage:true});
   expect.soft(errors,'runtime errors').toEqual([]);
   expect.soft(overflow,'horizontal overflow px; offenders: '+wide.join(', ')).toBeLessThanOrEqual(0);
   expect.soft(small,'tap targets under 24px').toEqual([]);
  });
 }
}
