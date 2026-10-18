// Nationwide/worldwide places from the SERVER (Supabase view public_discovered_places, filled every 6 hours by the
// Edge Function sync-global-places) in a real browser under the production CSP. The REST API is mocked with the rows
// the view returns after a server run over the same recorded-shape fixtures the browser sync tests use.
import {test,expect} from './fixtures.mjs';
import {readFileSync} from 'node:fs';
import {BRANCHES,branchIdOf,parseBranch,mergeItems} from '../edge-functions/_shared/global-places.mjs';
import {toServerRows,SERVER_COLUMNS,SERVER_MEDIA_COLUMNS} from '../edge-functions/_shared/global-places-server.mjs';
import {wdqsBranch,commonsPage,commonsResponse,BRANCH_ROWS,FAILING,FILES} from '../tests/fixtures/global-places-fixtures.mjs';
import {serverViewRows} from '../tests/fixtures/global-places-server-fixtures.mjs';

const SUPABASE='https://aoltest.supabase.co',KEY='sb_publishable_test',VIEW=SUPABASE+'/rest/v1/public_discovered_places';
const PNG=readFileSync(new URL('../site-public-cleared/assets/icon-512.png',import.meta.url));
const cors={'access-control-allow-origin':'*','access-control-expose-headers':'Content-Range','content-type':'application/json'};
const H=3600e3;
const status=page=>page.evaluate(()=>window.AOL_GLOBAL?.status);
const rail=(page,title)=>page.locator('section',{has:page.locator('h2',{hasText:title})});

// The app with the backend configured, a server whose view answers with `rows` (or `fail` as an HTTP status), and the
// Wikidata/Commons APIs counted (the browser sync must not run while the server answers).
async function serverMode(page,{rows=[],fail=0}={}){
 const calls={list:[],media:[],branches:0,live:0,commons:0},server={rows,fail};
 await page.route('**/config.js',async r=>{const res=await r.fetch();await r.fulfill({contentType:'text/javascript',body:(await res.text())+`\nwindow.AOL_CONFIG.SUPABASE_URL='${SUPABASE}';window.AOL_CONFIG.SUPABASE_PUBLISHABLE_KEY='${KEY}';`})});
 // Everything else on the backend (catalog, auth, realtime) is down: the app keeps its built-in catalogue.
 await page.routeWebSocket(/supabase\.co/,ws=>ws.close());
 await page.route(SUPABASE+'/**',r=>r.fulfill({status:503,headers:cors,body:'{"message":"down"}'}));
 await page.route(u=>u.href.startsWith(VIEW+'?'),async r=>{
  const u=new URL(r.request().url()),q=u.searchParams,headers=r.request().headers();
  const entry={select:q.get('select'),apikey:headers.apikey,authorization:headers.authorization||null,prefer:headers.prefer||null,qid:q.get('qid'),order:q.get('order'),limit:q.get('limit'),offset:q.get('offset')};
  (entry.qid?calls.media:calls.list).push(entry);
  if(server.fail)return r.fulfill({status:server.fail,headers:cors,body:'{"message":"server error"}'});
  if(entry.qid){const want=new Set(entry.qid.replace(/^in\.\(|\)$/g,'').split(','));return r.fulfill({headers:cors,body:JSON.stringify(server.rows.filter(x=>want.has(x.qid)))})}
  // PostgREST paging: max rows 1000 per response, the total in Content-Range when asked for (Prefer: count=exact).
  const from=Number(entry.offset||0),page_=server.rows.slice(from,from+Math.min(Number(entry.limit||1000),1000));
  await r.fulfill({headers:{...cors,'content-range':page_.length?`${from}-${from+page_.length-1}/${server.rows.length}`:`*/${server.rows.length}`},body:JSON.stringify(page_)});
 });
 await page.route('https://query.wikidata.org/**',async r=>{
  const id=branchIdOf(new URLSearchParams(r.request().postData()||'').get('query'));
  if(!id){calls.live++;return r.fulfill({headers:cors,body:JSON.stringify({head:{vars:[]},results:{bindings:[]}})})}
  calls.branches++;
  if(FAILING[id]==='http500')return r.fulfill({status:500,headers:cors,body:'{}'});
  if(FAILING[id]==='invalid')return r.fulfill({headers:cors,body:'{}'});
  await r.fulfill({headers:cors,body:JSON.stringify(wdqsBranch(BRANCH_ROWS[id]||[]))});
 });
 await page.route('https://commons.wikimedia.org/w/api.php**',async r=>{
  calls.commons++;
  const titles=new URL(r.request().url()).searchParams.get('titles').split('|').map(t=>t.replace(/^File:/,''));
  await r.fulfill({headers:cors,body:JSON.stringify(commonsResponse(Object.fromEntries(titles.map(t=>[t,FILES[t]?commonsPage(FILES[t]):{missing:true}]))))});
 });
 await page.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//,r=>r.fulfill({contentType:'image/png',body:PNG}));
 await page.route(/^https:\/\/([abc]\.)?tile\.openstreetmap\.org\//,r=>r.fulfill({contentType:'image/png',body:PNG}));
 return {calls,server};
}

test('server mode: one request with the publishable key replaces the Wikidata queries; photos come with the server verdicts',async({page})=>{
 const seenAt=new Date(Date.now()-H).toISOString();
 const {calls}=await serverMode(page,{rows:await serverViewRows({seenAt})});
 await page.goto('/#home');
 const korea=rail(page,'전국의 빛'),world=rail(page,'세계의 빛');
 await expect(korea.locator('.place-card')).toHaveCount(4);
 for(const name of ['진주남강유등축제','광안대교','서울빛초롱축제','BUSAN X the SKY'])await expect(korea).toContainText(name);
 for(const dup of ['롯데월드타워','남산서울타워','동대문디자인플라자'])await expect(korea).not.toContainText(dup);
 await expect(world.locator('.place-card')).toHaveCount(6);
 const first=world.locator('.place-card').first();
 await expect(first).toContainText('비비드 시드니');
 await expect(first.locator('.image-credit')).toContainText('Lee Photographer · CC BY-SA 4.0');
 await expect.poll(()=>first.locator('img[data-place-photo]').evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
 await expect(korea.locator('.place-card',{hasText:'진주남강유등축제'}).locator('.image-credit')).toContainText('Park · CC BY 2.0');
 for(const name of ['빛의 축제','쿤스트하우스 그라츠'])await expect(world.locator('.place-card',{hasText:name}).locator('img[data-place-photo]')).toHaveCount(0);
 await expect.poll(()=>status(page)).toBe('ok');
 // One request: the view, with the publishable key as apikey (no bearer token), the columns the app reads, a page of 1000.
 expect(calls.list).toEqual([{select:SERVER_COLUMNS,apikey:KEY,authorization:null,prefer:'count=exact',qid:null,order:'qid.asc',limit:'1000',offset:'0'}]);
 expect(await page.evaluate(()=>window.AOL_GLOBAL.fetchedAt),'the time of the server sync').toBe(seenAt);
 // No Wikidata branch query and no Commons check from this browser.
 await page.goto('/#place/WD-Q4167');
 await expect(page.locator('h1')).toHaveText('빛의 축제');
 await expect(page.locator('#syncedPhotoStatus')).toHaveText('대표 사진(P18)은 자동 표시 조건에 맞지 않아 표시하지 않습니다: 파노라마의 자유가 없는 나라의 건축물·작품 사진.');
 await page.goto('/#place/WD-Q7937834');
 const fig=page.locator('.image-gallery figure');
 await expect(fig).toContainText('Lee Photographer');
 await expect(fig.locator('a',{hasText:'이미지 원본'})).toHaveAttribute('href','https://commons.wikimedia.org/wiki/File:Vivid_Sydney_2019.jpg');
 await page.goto('/#settings');
 await expect(page.locator('#globalSyncCount')).toContainText('국내 4곳 / 해외 35곳');
 await expect(page.locator('#globalSyncErrors')).toHaveCount(0);
 await page.waitForLoadState('networkidle');
 expect([calls.branches,calls.commons,calls.media.length]).toEqual([0,0,0]);
});

test('server mode keeps the 6-hour cache: no request on reload; a copy whose server data is 6 hours old is asked again',async({page})=>{
 const {calls}=await serverMode(page,{rows:await serverViewRows({seenAt:new Date(Date.now()-H).toISOString()})});
 await page.goto('/#home');
 await expect.poll(()=>status(page)).toBe('ok');
 expect(calls.list.length).toBe(1);
 await page.reload();
 await expect(rail(page,'세계의 빛')).toContainText('비비드 시드니');
 await page.waitForLoadState('networkidle');
 expect(await status(page)).toBe('cached');
 expect(calls.list.length,'fresh: not asked again').toBe(1);
 await expect(rail(page,'세계의 빛').locator('.image-credit').first()).toContainText('Lee Photographer');
 const age=(data,checked)=>page.evaluate(([d,c])=>{const v=JSON.parse(localStorage.getItem('aol_global_v1'));v.fetchedAt=new Date(Date.now()-d).toISOString();v.checkedAt=new Date(Date.now()-c).toISOString();localStorage.setItem('aol_global_v1',JSON.stringify(v))},[data,checked]);
 // The server's data is 7 hours old (its next run is due) but this browser asked 10 minutes ago: wait.
 await age(7*H,10*60e3);
 await page.reload();await page.waitForLoadState('networkidle');
 expect(calls.list.length).toBe(1);
 // Asked 31 minutes ago: ask again.
 await age(7*H,31*60e3);
 await page.reload();
 await expect.poll(()=>calls.list.length).toBe(2);
 await expect.poll(()=>status(page)).toBe('ok');
 // This browser's copy is 6 hours old even though the server data looks new: ask again.
 await age(H,6.5*H);
 await page.reload();
 await expect.poll(()=>calls.list.length).toBe(3);
 expect(calls.branches).toBe(0);
});

test('a server without rows, or failing, makes the browser run the Wikidata queries itself',async({page})=>{
 const {calls,server}=await serverMode(page,{rows:[]});
 await page.goto('/#settings');
 await expect.poll(()=>status(page)).toBe('partial');
 expect(calls.list.length).toBe(1);
 expect(calls.branches).toBe(BRANCHES.length);
 await expect(page.locator('#globalSyncCount')).toContainText('국내 4곳 / 해외 35곳');
 await expect(page.locator('#globalSyncErrors')).toContainText('world:genres (HTTP 500)');
 // The browser's own result is cached as such; "지금 동기화" asks the server again first, then falls back once more.
 server.fail=503;
 await page.getByRole('button',{name:'지금 동기화'}).click();
 await expect(page.locator('#toast')).toContainText('동기화했어요');
 expect(calls.list.length).toBe(2);
 expect(calls.branches).toBe(2*BRANCHES.length);
 // Photos of the browser-synced places are checked on Commons as before.
 await page.goto('/#place/WD-Q7937834');
 await expect(page.locator('.image-gallery figure')).toContainText('Lee Photographer');
 expect(calls.commons).toBeGreaterThan(0);
});

test('a server list longer than one page is read with Content-Range paging',async({page})=>{
 test.setTimeout(60000);
 const seenAt=new Date(Date.now()-H).toISOString();
 const many=Array.from({length:2500},(_,i)=>({qid:'Q'+(8000000+i),en:'Light installation '+i,coord:`Point(${(-170+i*0.1).toFixed(3)} ${(-60+i*0.04).toFixed(3)})`,country:'Q17|일본',city:'Q1490|도쿄',kind:'Light Art',sitelinks:i%7}));
 const rows=toServerRows(mergeItems([parseBranch(wdqsBranch(many),'world:classes-art').items])).map(r=>({...r,image_status:'none',image_reasons:[],media:[],media_checked_at:null,last_seen_at:seenAt}));
 const {calls}=await serverMode(page,{rows});
 await page.goto('/#settings');
 await expect.poll(()=>status(page),{timeout:30000}).toBe('ok');
 expect(calls.list.map(c=>c.offset)).toEqual(['0','1000','2000']);
 expect(await page.evaluate(()=>window.AOL_GLOBAL.places.length)).toBe(2500);
 await expect(page.locator('#globalSyncCount')).toContainText('국내 0곳 / 해외 2500곳');
 expect(calls.branches).toBe(0);
});

test('a photo verdict this browser no longer has is asked from the server, not from Commons',async({page})=>{
 const {calls}=await serverMode(page,{rows:await serverViewRows({seenAt:new Date(Date.now()-H).toISOString()})});
 await page.goto('/#home');
 await expect.poll(()=>status(page)).toBe('ok');
 // The stored verdicts are gone (e.g. they did not all fit); the place list is still fresh.
 await page.evaluate(()=>localStorage.removeItem('aol_global_media_v1'));
 await page.goto('/#place/WD-Q7937834');await page.reload();
 await expect(page.locator('.image-gallery figure')).toContainText('Lee Photographer · CC BY-SA 4.0');
 expect(calls.list.length,'the list itself was not fetched again').toBe(1);
 expect(calls.media.length).toBeGreaterThan(0);
 expect(calls.media[0]).toMatchObject({select:SERVER_MEDIA_COLUMNS,apikey:KEY,authorization:null});
 expect(calls.media.some(c=>/^in\.\((Q\d+,)*Q7937834(,Q\d+)*\)$/.test(c.qid))).toBe(true);
 expect(calls.commons).toBe(0);
});
