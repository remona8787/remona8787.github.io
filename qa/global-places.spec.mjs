// Nationwide/worldwide Wikidata place sync in a real browser, under the production CSP, against recorded-shape
// WDQS responses chosen per branch (the mock reads the branch tag of each POSTed query) and Commons metadata.
// The last test talks to the real APIs when they are reachable and prints what the live sync found.
import {test,expect} from './fixtures.mjs';
import AxeBuilder from '@axe-core/playwright';
import {readFileSync} from 'node:fs';
import {BRANCHES,branchIdOf} from '../edge-functions/_shared/global-places.mjs';
import {wdqsBranch,commonsPage,commonsResponse,BRANCH_ROWS,FAILING,FILES} from '../tests/fixtures/global-places-fixtures.mjs';

const PNG=readFileSync(new URL('../site-public-cleared/assets/icon-512.png',import.meta.url));
const cors={'access-control-allow-origin':'*','content-type':'application/json'};
const EMPTY={head:{vars:[]},results:{bindings:[]}};
// Fixture totals: 4 Korean places (5 more are curated places, by QID, and are hidden) and 35 abroad (incl. 30 in Tokyo
// and one named only in Japanese; an item without any label and a never-show duplicate are dropped).
const KOREA_SHOWN=4,WORLD_SHOWN=35,CURATED_HIDDEN=5;

async function mockApis(page,{commons=true,rows=BRANCH_ROWS,failing=FAILING}={}){
 const calls={branches:[],live:0,commons:0},state={failAll:false};
 await page.route('https://query.wikidata.org/**',async r=>{
  expect(r.request().method()).toBe('POST');
  const id=branchIdOf(new URLSearchParams(r.request().postData()||'').get('query'));
  if(!id){calls.live++;return r.fulfill({headers:cors,body:JSON.stringify(EMPTY)})} // the curated-place photo sync
  calls.branches.push(id);
  if(state.failAll||failing[id]==='http500')return r.fulfill({status:500,headers:cors,body:'{}'});
  if(failing[id]==='invalid')return r.fulfill({headers:cors,body:'{}'});
  await r.fulfill({headers:cors,body:JSON.stringify(wdqsBranch(rows[id]||[]))});
 });
 await page.route('https://commons.wikimedia.org/w/api.php**',async r=>{
  calls.commons++;
  if(!commons)return; // never answers: no photo may appear before the rights check
  const titles=new URL(r.request().url()).searchParams.get('titles').split('|').map(t=>t.replace(/^File:/,''));
  await r.fulfill({headers:cors,body:JSON.stringify(commonsResponse(Object.fromEntries(titles.map(t=>[t,FILES[t]?commonsPage(FILES[t]):{missing:true}]))))});
 });
 await page.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//,r=>r.fulfill({contentType:'image/png',body:PNG}));
 await page.route(/^https:\/\/([abc]\.)?tile\.openstreetmap\.org\//,r=>r.fulfill({contentType:'image/png',body:PNG}));
 return {calls,state};
}
const status=page=>page.evaluate(()=>window.AOL_GLOBAL?.status);
// Many synced places of realistic size: rows abroad (more sitelinks, English descriptions) and Korean local ones.
const many=(n,{korea=0,desc=true}={})=>({
 world:Array.from({length:n},(_,i)=>({qid:'Q'+(6000000+i),en:'Observation deck '+i+' of Some Tower in a large city',...(desc?{den:'observation deck on the top floor of a skyscraper in a large city, open in the evening'}:{}),coord:`Point(${(-170+(i*0.097)%340).toFixed(5)} ${(-60+(i*0.031)%120).toFixed(5)})`,image:`Some Tower observation deck ${i} at dusk.jpg`,country:'Q'+(100+i%60)+'|나라'+(i%60),city:'Q'+(200000+i%400)+'|City '+(i%400),site:'https://www.example-tower-'+i+'.com/',kind:'Nightscape',sitelinks:3+i%40})),
 korea:Array.from({length:korea},(_,i)=>({qid:'Q'+(7000000+i),ko:'어느 지역 빛 축제 '+i,dko:'대한민국 어느 시군에서 열리는 지역 빛 축제',coord:`Point(${(127+(i*0.001)).toFixed(5)} ${(36+(i*0.001)).toFixed(5)})`,country:'Q884|대한민국',city:'Q42144|진주시',kind:'Festival',sitelinks:i%3})),
});
const canvases=page=>page.evaluate(()=>({dom:document.querySelectorAll('#mapCanvas .leaflet-overlay-pane canvas').length,layers:(()=>{let n=0;currentMap.eachLayer(l=>{if(l instanceof L.Canvas)n++});return n})()}));
const rail=(page,title)=>page.locator('section',{has:page.locator('h2',{hasText:title})});

test('home: 전국의 빛 and 세계의 빛 rails, curated duplicates hidden, photos only after the rights check',async({page})=>{
 await mockApis(page);
 await page.goto('/#home');
 const korea=rail(page,'전국의 빛'),world=rail(page,'세계의 빛');
 await expect(korea.locator('.place-card')).toHaveCount(KOREA_SHOWN);
 for(const name of ['진주남강유등축제','광안대교','서울빛초롱축제','BUSAN X the SKY'])await expect(korea).toContainText(name);
 // The same items as curated places (by the QIDs in the seed): 반포대교 is SEOUL045's host bridge, 서울로 7017 SEOUL046's.
 for(const dup of ['롯데월드타워','남산서울타워','동대문디자인플라자','반포대교','서울로 7017'])await expect(korea).not.toContainText(dup);
 await expect(korea.locator('.pill').first()).toHaveText('Wikidata 공동 편집 데이터');
 await expect(world.locator('.place-card')).toHaveCount(6);
 // Photos first: Vivid Sydney's photo clears (CC BY-SA), Lyon's is blocked (NoFoP-France), Graz's is NC.
 const first=world.locator('.place-card').first();
 await expect(first).toContainText('비비드 시드니');
 await expect(first.locator('.image-credit')).toContainText('Lee Photographer · CC BY-SA 4.0');
 await expect.poll(()=>first.locator('img[data-place-photo]').evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
 for(const name of ['빛의 축제','쿤스트하우스 그라츠'])await expect(world.locator('.place-card',{hasText:name}).locator('img[data-place-photo]')).toHaveCount(0);
 // Region section: countries and cities with counts; Festival is a category. Synced Seoul places count under 서울
 // with the curated ones (not under their district), and Busan's districts make one city.
 await expect(page.locator('[data-country-link="일본"]')).toContainText('일본 · 31곳');
 const curated=await page.evaluate(()=>AOLApp.places().length);
 await expect(page.locator('.region-card[data-city-link="서울"]')).toContainText(`${curated+1}개 프로젝트`);
 await expect(page.locator('.region-card[data-city-link="부산"]')).toContainText('2개 프로젝트');
 for(const district of ['중구','수영구','해운대구'])await expect(page.locator(`.region-card[data-city-link="${district}"]`)).toHaveCount(0);
 await expect(page.locator('.category-tile[data-discover-category="Festival"]')).toContainText('빛 축제');
 await expect(page.locator('.category-tile[data-discover-category="Festival"]')).toContainText('4개 프로젝트');
 // Entity-encoded markup in a label is shown as text, never run.
 await expect(world).toContainText('<img src=x onerror="window.__xss=1">빛');
 expect(await page.evaluate(()=>window.__xss)).toBeUndefined();
});

test('explore: country and city filters from all places, 24 results per page, search covers synced places',async({page})=>{
 await mockApis(page);
 await page.goto('/#explore');
 await expect.poll(()=>status(page)).toBe('partial');
 await page.locator('.advanced-filters summary').click();
 const country=page.locator('select[data-search-filter="country"]');
 for(const c of ['대한민국','일본','오스트레일리아','프랑스','오스트리아'])await expect(country.locator('option',{hasText:c})).toHaveCount(1);
 await country.selectOption('일본');
 await expect(page.locator('.result-meta')).toHaveText('31개 프로젝트 · 24개 표시');
 await expect(page.locator('#placeResults .place-card')).toHaveCount(24);
 await page.getByRole('button',{name:'더 보기'}).click();
 await expect(page.locator('#placeResults .place-card')).toHaveCount(31);
 await expect(page.getByRole('button',{name:'더 보기'})).toHaveCount(0);
 await page.locator('select[data-search-filter="city"]').selectOption('미나토구');
 await expect(page.locator('.result-meta')).toContainText('30개 프로젝트');
 await page.getByRole('button',{name:'초기화'}).click();
 await page.locator('#placeSearch').fill('시드니');
 await expect(page.locator('#placeResults .place-card')).toHaveCount(1);
 await expect(page.locator('#placeResults')).toContainText('비비드 시드니');
 // A place with only a Japanese label is named (and found) by it, never by its QID.
 await page.locator('#placeSearch').fill('光のアート');
 await expect(page.locator('#placeResults .place-card')).toHaveCount(1);
 await expect(page.locator('#placeResults h3')).toHaveText('光のアート回廊');
 await expect(page.locator('#view')).not.toContainText('Q99200002');
 // The 세계의 빛 rail's "전체 보기" lists every place outside Korea.
 await page.goto('/#home');
 await rail(page,'세계의 빛').getByRole('button',{name:'전체 보기'}).click();
 await expect(page.locator('.result-meta')).toContainText(`${WORLD_SHOWN}개 프로젝트 · 24개 표시`);
});

test('map: Wikidata coordinates are counted apart and drawn as circles on one canvas that name their source',async({page})=>{
 await mockApis(page);
 await page.goto('/#map');
 await expect.poll(()=>status(page)).toBe('partial');
 await expect(page.locator('#mapResults .result-meta')).toContainText(`검증 좌표 0곳 · Wikidata 좌표 ${KOREA_SHOWN+WORLD_SHOWN}곳`);
 await expect(page.locator('#mapResults .map-list-item')).toHaveCount(24);
 await page.getByRole('button',{name:'지도 불러오기'}).click();
 await expect(page.locator('#mapCanvas.map-loaded')).toBeVisible();
 const markers=await page.evaluate(()=>({all:mapMarkers.length,wikidata:mapMarkers.filter(m=>m.aolSource==='wikidata'&&m instanceof L.CircleMarker).length}));
 expect(markers).toEqual({all:KOREA_SHOWN+WORLD_SHOWN,wikidata:KOREA_SHOWN+WORLD_SHOWN});
 // Sydney sits at lon 151, lat -33 (WKT is longitude first).
 expect(await page.evaluate(()=>{const m=mapMarkers.find(x=>x.aolId==='WD-Q7937834').getLatLng();return [m.lat,m.lng]})).toEqual([-33.8688,151.2093]);
 await page.locator('[data-map-select="WD-Q7937834"]').click();
 await expect(page.locator('.leaflet-popup-content')).toContainText('비비드 시드니 상세 보기');
 await expect(page.locator('.leaflet-popup-content')).toContainText('좌표 출처: Wikidata 등록 좌표');
 // Typing filters the map after a short pause, on the same single canvas; background updates add none either.
 expect(await canvases(page)).toEqual({dom:1,layers:1});
 const input=page.locator('#placeSearch');
 await input.click();
 await input.pressSequentially('도쿄 빛',{delay:30}); // four keystrokes, each an input event
 await expect.poll(()=>page.evaluate(()=>mapMarkers.length)).toBe(30);
 await expect(page.locator('#mapResults .result-meta')).toContainText('Wikidata 좌표 30곳');
 expect(await canvases(page)).toEqual({dom:1,layers:1});
 await page.evaluate(()=>{for(let i=0;i<5;i++)AOLApp.softRender()});
 expect(await canvases(page)).toEqual({dom:1,layers:1});
 await input.fill('');
 await expect.poll(()=>page.evaluate(()=>mapMarkers.length)).toBe(KOREA_SHOWN+WORLD_SHOWN);
 expect(await canvases(page)).toEqual({dom:1,layers:1});
});

test('detail: Wikidata facts with sources, and the photo with full attribution once its rights check passes',async({page})=>{
 await mockApis(page);
 await page.goto('/#place/WD-Q7937834');
 await expect(page.locator('h1')).toHaveText('비비드 시드니');
 await expect(page.locator('.synced-note')).toHaveText('Wikidata 공동 편집 데이터 · 6시간마다 자동 갱신 · 방문 전 공식 정보 확인');
 const info=page.locator('.synced-info');
 await expect(info).toContainText('빛 축제');
 await expect(info).toContainText('오스트레일리아 · 시드니');
 await expect(info).toContainText('-33.86880, 151.20930');
 await expect(info.locator('a',{hasText:'OpenStreetMap에서 보기'})).toHaveAttribute('href','https://www.openstreetmap.org/?mlat=-33.8688&mlon=151.2093#map=16/-33.8688/151.2093');
 await expect(info.locator('a',{hasText:'바로가기'})).toHaveAttribute('href','https://www.vividsydney.com/');
 await expect(info.locator('a',{hasText:'Wikidata Q7937834'})).toHaveAttribute('href','https://www.wikidata.org/wiki/Q7937834');
 const fig=page.locator('.image-gallery figure');
 await expect(fig).toContainText('Lee Photographer');
 await expect(fig).toContainText('CC BY-SA 4.0');
 await expect(fig).toContainText('2019-05-30');
 await expect(fig.locator('a',{hasText:'이미지 원본'})).toHaveAttribute('href','https://commons.wikimedia.org/wiki/File:Vivid_Sydney_2019.jpg');
 await expect(fig.locator('a',{hasText:'사용조건'})).toHaveAttribute('href','https://creativecommons.org/licenses/by-sa/4.0');
 // A blocked photo is never shown; the page says why photos may be missing.
 await page.goto('/#place/WD-Q4167');
 await expect(page.locator('h1')).toHaveText('빛의 축제');
 await expect(page.locator('#syncedPhotoStatus')).toHaveText('대표 사진(P18)은 자동 표시 조건에 맞지 않아 표시하지 않습니다: 파노라마의 자유가 없는 나라의 건축물·작품 사진.');
 await expect(page.locator('.image-gallery figure')).toHaveCount(0);
 await expect(page.locator('img[data-place-photo]')).toHaveCount(0);
 await page.goto('/#place/WD-Q597137');
 await expect(page.locator('#syncedPhotoStatus')).toContainText('자유 라이선스(CC BY·CC BY-SA·CC0·퍼블릭 도메인)가 아님');
 await expect(page.locator('img[data-place-photo]')).toHaveCount(0);
 // Korean freedom of panorama: shown under the operator's policy, with its basis recorded.
 await page.goto('/#place/WD-Q12618343');
 await expect(page.locator('.image-gallery figure')).toContainText('Park · CC BY 2.0');
});

test('no photo is shown while its rights check has not answered',async({page})=>{
 const {calls}=await mockApis(page,{commons:false});
 await page.goto('/#place/WD-Q7937834');
 await expect(page.locator('h1')).toHaveText('비비드 시드니');
 await expect.poll(()=>calls.commons).toBeGreaterThan(0);
 await expect(page.locator('#syncedPhotoStatus')).toContainText('권리를 확인하는 중입니다');
 await expect(page.locator('.photo-pending')).toBeVisible();
 await expect(page.locator('img[data-place-photo]')).toHaveCount(0);
 await page.goto('/#home');
 await expect(rail(page,'세계의 빛').locator('.place-card')).toHaveCount(6);
 await expect(rail(page,'세계의 빛').locator('img[data-place-photo]')).toHaveCount(0);
 await expect(rail(page,'전국의 빛').locator('img[data-place-photo]')).toHaveCount(0);
});

test('a saved, planned and recorded Wikidata place survives a reload without the sync',async({page})=>{
 const {state}=await mockApis(page);
 await page.goto('/#place/WD-Q12618343');
 await expect(page.locator('h1')).toHaveText('진주남강유등축제');
 await page.getByRole('button',{name:'저장',exact:true}).click();
 await expect(page.getByRole('button',{name:'저장됨',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'답사 코스에 담기',exact:true}).click();
 await page.locator('#newRouteForm input[name=name]').fill('남강 유등 답사');
 await page.locator('#newRouteForm button[type=submit]').click();
 await expect(page.locator('h1')).toHaveText('남강 유등 답사');
 await expect(page.locator('.list-row')).toContainText('진주남강유등축제');
 await page.goto('/#place/WD-Q12618343');
 await page.getByRole('button',{name:'기록',exact:true}).click();
 await page.locator('#visitForm textarea[name=note]').fill('유등이 강 위에 떠 있다');
 await page.locator('#visitForm button[type=submit]').click();
 await expect(page.locator('#toast')).toContainText('현장 기록을 저장했습니다');
 // The sync result is gone and every query fails: the user's own records still show the place.
 state.failAll=true;
 await page.evaluate(()=>{localStorage.removeItem('aol_global_v1');localStorage.removeItem('aol_global_media_v1')});
 await page.goto('/#saved');await page.reload();
 await expect.poll(()=>status(page)).toBe('unavailable');
 await expect(page.locator('.place-card')).toContainText('진주남강유등축제');
 await page.goto('/#journal');
 await expect(page.locator('#view')).toContainText('진주남강유등축제');
 await expect(page.locator('#view')).toContainText('유등이 강 위에 떠 있다');
 await page.goto('/#routes');
 await page.locator('.collection',{hasText:'남강 유등 답사'}).click();
 await expect(page.locator('.list-row')).toContainText('진주남강유등축제');
 await page.goto('/#place/WD-Q12618343');
 await expect(page.locator('h1')).toHaveText('진주남강유등축제');
 await expect(page.locator('.synced-info a',{hasText:'Wikidata Q12618343'})).toHaveAttribute('href','https://www.wikidata.org/wiki/Q12618343');
 await expect(page.locator('.synced-info')).toContainText('대한민국 · 진주시');
 // Its photo is still rights-checked lazily from the stored record.
 await expect(page.locator('.image-gallery figure')).toContainText('Park · CC BY 2.0');
});

test('a failing branch does not break the others; settings shows counts, failures and manual sync',async({page})=>{
 const {calls}=await mockApis(page);
 await page.goto('/#settings');
 await expect(page.locator('#globalSyncCount')).toContainText(`국내 ${KOREA_SHOWN}곳 / 해외 ${WORLD_SHOWN}곳`);
 await expect(page.locator('#globalSyncCount')).toContainText(`수록 장소와 같은 ${CURATED_HIDDEN}곳 제외`);
 await expect(page.locator('#globalSyncTime')).toContainText('일부 검색 실패');
 await expect(page.locator('#globalSyncErrors')).toContainText('world:genres (HTTP 500)');
 await expect(page.locator('#globalSyncErrors')).toContainText('world:lantern (invalid_wdqs_payload)');
 expect(calls.branches.slice().sort()).toEqual(BRANCHES.map(b=>b.id).sort());
 const before={branches:calls.branches.length,live:calls.live};
 await page.getByRole('button',{name:'지금 동기화'}).click();
 await expect.poll(()=>calls.branches.length).toBe(before.branches+BRANCHES.length);
 await expect.poll(()=>calls.live).toBe(before.live+1);
 await expect(page.locator('#toast')).toContainText('동기화했습니다');
});

test('results are cached for 6 hours; a failed refresh keeps the last good result',async({page})=>{
 const {calls,state}=await mockApis(page);
 await page.goto('/#home');
 await expect(rail(page,'세계의 빛')).toContainText('비비드 시드니');
 await expect.poll(()=>status(page)).toBe('partial');
 const n=calls.branches.length;expect(n).toBe(BRANCHES.length);
 await page.reload();
 await expect(rail(page,'세계의 빛')).toContainText('비비드 시드니');
 await page.waitForLoadState('networkidle');
 expect(calls.branches.length,'fresh cache: no new queries').toBe(n);
 expect(await status(page)).toBe('cached');
 // Age the cache past 6 hours and make every branch fail.
 await page.evaluate(()=>{const v=JSON.parse(localStorage.getItem('aol_global_v1'));v.fetchedAt=new Date(Date.now()-7*3600e3).toISOString();localStorage.setItem('aol_global_v1',JSON.stringify(v))});
 state.failAll=true;
 await page.goto('/#settings');await page.reload();
 await expect.poll(()=>calls.branches.length).toBe(2*n);
 await expect(page.locator('#globalSyncTime')).toContainText('최근 갱신 실패');
 await expect(page.locator('#globalSyncCount')).toContainText(`해외 ${WORLD_SHOWN}곳`);
 await page.goto('/#home');
 await expect(rail(page,'세계의 빛')).toContainText('비비드 시드니');
 // Past 72 hours the old list is not shown any more, even though every refresh keeps failing.
 await page.evaluate(()=>{const v=JSON.parse(localStorage.getItem('aol_global_v1'));v.fetchedAt=new Date(Date.now()-73*3600e3).toISOString();localStorage.setItem('aol_global_v1',JSON.stringify(v))});
 await page.goto('/#settings');await page.reload();
 await expect.poll(()=>status(page)).toBe('unavailable');
 expect(await page.evaluate(()=>window.AOL_GLOBAL.places.length)).toBe(0);
 expect(await page.evaluate(()=>localStorage.getItem('aol_global_v1'))).toBeNull();
 await expect(page.locator('#globalSyncTime')).toContainText('지금은 불러올 수 없음');
});

test('a list too big for storage keeps every Korean and saved place; the cut copy is not treated as fresh',async({page})=>{
 test.setTimeout(90000);
 const big=many(6000,{korea:400});
 const rows={'world:classes-events':big.world,'korea:name-keywords':big.korea};
 const {calls,state}=await mockApis(page,{rows,failing:{}});
 await page.goto('/#settings');
 await expect.poll(()=>status(page),{timeout:30000}).toBe('ok');
 // Save a place abroad with the fewest sitelinks (it would be cut first), then sync again so it is stored first.
 const saved='WD-Q6000000';
 await page.goto('/#place/'+saved);
 await page.getByRole('button',{name:'저장',exact:true}).click();
 await expect(page.getByRole('button',{name:'저장됨',exact:true})).toBeVisible();
 await page.goto('/#settings');
 const n=calls.branches.length;
 await page.getByRole('button',{name:'지금 동기화'}).click();
 await expect.poll(()=>calls.branches.length).toBe(n+BRANCHES.length);
 await expect(page.locator('#toast')).toContainText('동기화했습니다');
 const before=await page.evaluate(()=>{const s=localStorage.getItem('aol_global_v1'),v=JSON.parse(s);return {all:AOL_GLOBAL.places.length,korea:AOL_GLOBAL.places.filter(p=>p.scope==='korea').length,chars:s.length,rows:v.rows.length,truncated:v.truncated}});
 expect(before.all).toBe(6400);expect(before.korea).toBe(400);
 expect(before.truncated,'this list does not fit even with short descriptions').toBe(true);
 expect(before.rows).toBeLessThan(6400);expect(before.chars).toBeLessThan(1_050_000);
 await expect(page.locator('#globalSyncCount')).toContainText('국내 400곳 / 해외 6000곳 · 기기 저장 공간 때문에 일부만 보관');
 // Reload while every query fails: the stored copy is shown, with all Korean places and the saved one…
 state.failAll=true;
 const m=calls.branches.length;
 await page.reload();
 await expect.poll(()=>status(page),{timeout:30000}).toBe('stale');
 const after=await page.evaluate(id=>({all:AOL_GLOBAL.places.length,korea:AOL_GLOBAL.places.filter(p=>p.scope==='korea').length,saved:AOL_GLOBAL.places.some(p=>p.place_id===id)}),saved);
 expect(after).toEqual({all:before.rows,korea:400,saved:true});
 await expect(page.locator('#globalSyncCount')).toContainText(`국내 400곳 / 해외 ${before.rows-400}곳`);
 // …and, although it is only minutes old, it was not taken as fresh: the sync ran again.
 expect(calls.branches.length).toBe(m+BRANCHES.length);
});

test('the photo index is not rebuilt on every card: home renders fast in server-snapshot mode and with photo sync off',async({page})=>{
 test.setTimeout(90000);
 const big=many(3500,{desc:false});
 await mockApis(page,{rows:{'world:classes-art':big.world},failing:{}});
 await page.goto('/#settings');
 await expect.poll(()=>status(page),{timeout:30000}).toBe('ok');
 const r=await page.evaluate(()=>{
  window.AOL_GLOBAL_MEDIA=Array.from({length:300},(_,i)=>({place_code:'WD-Q'+(6000000+i),provider_asset_id:'f'+i+'.jpg',display_url:'https://upload.wikimedia.org/f'+i+'.jpg',clearance_status:'cleared'}));
  history.replaceState(null,'','#home');
  const time=()=>{const a=performance.now();AOLApp.render();return performance.now()-a};
  time();const normal=Math.min(time(),time());
  window.AOL_MEDIA=[{place_code:'SEOUL001',provider_asset_id:'s.jpg',display_url:'https://upload.wikimedia.org/s.jpg',clearance_status:'cleared'}];
  time();const index=mediaIndex,server=Math.min(time(),time()),serverSame=mediaIndex===index;
  delete window.AOL_MEDIA;const live=window.AOL_LIVE;window.AOL_LIVE=undefined;
  time();const index2=mediaIndex,off=Math.min(time(),time()),offSame=mediaIndex===index2;
  window.AOL_LIVE=live;
  return {normal,server,off,serverSame,offSame}});
 expect(r.serverSame,'server mode keeps one index').toBe(true);
 expect(r.offSame,'photo sync off keeps one index').toBe(true);
 expect(r.server,`server ${r.server.toFixed(0)} ms vs ${r.normal.toFixed(0)} ms`).toBeLessThan(r.normal*4+150);
 expect(r.off,`sync off ${r.off.toFixed(0)} ms vs ${r.normal.toFixed(0)} ms`).toBeLessThan(r.normal*4+150);
});

test('when localStorage is full the sync keeps its result in memory',async({page})=>{
 await page.addInitScript(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(String(k).startsWith('aol_global'))throw new DOMException('full','QuotaExceededError');return set.call(this,k,v)}});
 await mockApis(page);
 await page.goto('/#home');
 await expect(rail(page,'전국의 빛').locator('.place-card')).toHaveCount(KOREA_SHOWN);
 await expect(rail(page,'세계의 빛').locator('.image-credit')).toContainText('Lee Photographer');
 expect(await page.evaluate(()=>localStorage.getItem('aol_global_v1'))).toBeNull();
});

for(const r of ['home','explore','map','settings','place/WD-Q7937834'])test(`a11y with synced places #${r}`,async({page})=>{
 await mockApis(page);
 await page.goto('/#'+r);
 await expect.poll(()=>status(page)).toBe('partial');
 if(r==='home')await expect(rail(page,'세계의 빛').locator('.image-credit')).toContainText('Lee Photographer');
 if(r.startsWith('place/'))await expect(page.locator('.image-gallery figure')).toContainText('Lee Photographer');
 const {violations}=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
 expect(violations.map(v=>`${v.id} (${v.impact}): ${v.nodes.slice(0,3).map(n=>n.target.join(' ')).join(' | ')}`)).toEqual([]);
});

test.describe('real Wikidata',()=>{
 test.use({liveApis:true});
 test('nationwide/worldwide sync finds places with sources and coordinates',async({page,request})=>{
  const reach=await request.get('https://query.wikidata.org/sparql?query=ASK%7B%7D&format=json',{timeout:10000}).then(r=>r.ok(),()=>false);
  test.skip(!reach,'query.wikidata.org unreachable from this runner');
  test.setTimeout(10*60*1000);
  await page.goto('/#settings');
  await expect.poll(()=>status(page),{timeout:9*60*1000,intervals:[5000]}).toMatch(/^(ok|partial)$/);
  const g=await page.evaluate(()=>({places:window.AOL_GLOBAL.places,branches:window.AOL_GLOBAL.branches}));
  const korea=g.places.filter(p=>p.scope==='korea').length;
  console.log(`global sync: ${g.places.length} places (국내 ${korea} / 해외 ${g.places.length-korea})`);
  for(const b of g.branches)console.log(`  ${b.id.padEnd(24)} ${b.ok?'ok    ':'FAILED'} ${String(b.count).padStart(5)} rows ${String(b.ms).padStart(6)} ms${b.error?' '+b.error:''}`);
  expect(g.places.length).toBeGreaterThan(0);
  for(const p of g.places){expect(p.place_id).toMatch(/^WD-Q\d+$/);expect(Math.abs(p.latitude)).toBeLessThanOrEqual(90);expect(Math.abs(p.longitude)).toBeLessThanOrEqual(180);expect(p.coordinate_source_url).toBe('https://www.wikidata.org/wiki/'+p.wikidata)}
  // Photos are checked lazily for the places on screen: open the home rails and wait for the Commons checks.
  await page.goto('/#home');await page.reload();await page.waitForLoadState('networkidle');
  const media=await page.evaluate(()=>window.AOL_GLOBAL_MEDIA||[]);
  console.log(`global sync: ${media.length} rights-cleared photos for the places on the home screen`);
  for(const m of media){expect(m.creator).toBeTruthy();expect(m.license_code).toBeTruthy();expect(m.source_url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/)}
 });
});
