// The media facade archive in a real browser under the production CSP: public_archive_projects is mocked with the
// recorded-shape fixture rows (tests/fixtures/archive-app-rows.mjs, 30 projects across every region with missing
// coordinates, broken media, unicode, Arabic and very long names). Expectations are derived from the same rows through
// the app's own mapping (client/archive-rows.mjs) and catalogue (catalog.js), never counted by hand.
import {test,expect} from './fixtures.mjs';
import AxeBuilder from '@axe-core/playwright';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {ARCHIVE_ROWS,LINKED_TO_CURATED} from '../tests/fixtures/archive-app-rows.mjs';
import {fromArchiveRows,ARCHIVE_COLUMNS} from '../client/archive-rows.mjs';

const require=createRequire(import.meta.url);
const X=require('../site-public-cleared/catalog.js');
const SUPABASE='https://aoltest.supabase.co',KEY='sb_publishable_test',VIEW=SUPABASE+'/rest/v1/public_archive_projects';
const PNG=readFileSync(new URL('../site-public-cleared/assets/icon-512.png',import.meta.url));
const cors={'access-control-allow-origin':'*','access-control-expose-headers':'Content-Range','content-type':'application/json'};
const {projects}=fromArchiveRows(ARCHIVE_ROWS,{publicURL:'https://light-architecture-jihyun.peppydegu2.chatgpt.site'});
const listed=projects.filter(p=>!LINKED_TO_CURATED[p.archive_slug]);
const H=3600e3;

// The app with the backend configured; the archive view answers from rows with PostgREST paging (Range headers,
// 206 + Content-Range), or fails with an HTTP status. Everything else on the backend is down.
async function archiveMode(page,{rows=ARCHIVE_ROWS,fail=0}={}){
 const calls=[],server={rows,fail};
 await page.route('**/config.js',async r=>{const res=await r.fetch();await r.fulfill({contentType:'text/javascript',body:(await res.text())+`\nwindow.AOL_CONFIG.SUPABASE_URL='${SUPABASE}';window.AOL_CONFIG.SUPABASE_PUBLISHABLE_KEY='${KEY}';`})});
 await page.routeWebSocket(/supabase\.co/,ws=>ws.close());
 await page.route(SUPABASE+'/**',r=>r.fulfill({status:503,headers:cors,body:'{"message":"down"}'}));
 await page.route(u=>u.href.startsWith(VIEW+'?'),async r=>{
  const u=new URL(r.request().url()),h=r.request().headers(),[from,to]=String(h.range||'0-999').split('-').map(Number);
  calls.push({select:u.searchParams.get('select'),order:u.searchParams.get('order'),apikey:h.apikey,authorization:h.authorization||null,range:h.range,rangeUnit:h['range-unit'],prefer:h.prefer});
  if(server.fail)return r.fulfill({status:server.fail,headers:cors,body:'{"message":"error"}'});
  const part=server.rows.slice(from,Math.min(to,from+999)+1);
  await r.fulfill({status:206,headers:{...cors,'content-range':part.length?`${from}-${from+part.length-1}/${server.rows.length}`:`*/${server.rows.length}`},body:JSON.stringify(part)});
 });
 await page.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//,r=>r.fulfill({contentType:'image/png',body:PNG}));
 await page.route(/^https:\/\/media\.example\.org\//,r=>r.fulfill({status:404,body:''}));
 await page.route(/^https:\/\/([abc]\.)?tile\.openstreetmap\.org\//,r=>r.fulfill({contentType:'image/png',body:PNG}));
 return {calls,server};
}
const status=page=>page.evaluate(()=>window.AOL_ARCHIVE?.status);
const count=async page=>Number((await page.locator('#placeResults .result-meta').textContent()).match(/([\d,]+)곳/)[1].replace(/,/g,''));
const curatedCount=page=>page.evaluate(()=>AOLApp.places().length);

test('the archive is read once with the publishable key, in pages, and its projects join the places',async({page})=>{
 const {calls}=await archiveMode(page);
 await page.goto('/#explore');
 await expect.poll(()=>status(page)).toBe('ok');
 expect(calls).toEqual([{select:ARCHIVE_COLUMNS,order:'slug.asc',apikey:KEY,authorization:null,range:'0-999',rangeUnit:'items',prefer:'count=exact'}]);
 const curated=await curatedCount(page);
 await expect.poll(()=>count(page)).toBe(curated+listed.length);
 // A project linked to a curated place is that place, not a second entry.
 await page.locator('#placeSearch').fill('코엑스 K-POP');
 await expect(page.locator('#placeResults .place-card')).toHaveCount(1);
 await expect(page.locator('#placeResults')).toContainText('코엑스 K-POP 스퀘어 WAVE');
 // Every language and alias, best match first: decomposed unicode, Arabic, Japanese, an acronym, a credit.
 for(const [q,name] of [['fête','리옹 빛의 축제'],['برج خليفة','부르즈 할리파 LED 파사드'],['渋谷','Shibuya Crossing screens'],['AEC','아르스 일렉트로니카 센터'],['Plensa','Crown Fountain']]){
  await page.locator('#placeSearch').fill(q);
  await expect(page.locator('#placeResults h3').first()).toHaveText(name);
 }
});

test('a list longer than a page is read with Range paging, at most 5000 projects',async({page})=>{
 test.setTimeout(60000);
 const many=Array.from({length:6200},(_,i)=>({...ARCHIVE_ROWS[0],slug:'p-'+String(i).padStart(5,'0'),name_ko:'프로젝트 '+i,media:[],assessments:[]}));
 const {calls}=await archiveMode(page,{rows:many});
 await page.goto('/#settings');
 await expect.poll(()=>status(page),{timeout:30000}).toBe('ok');
 expect(calls.map(c=>c.range)).toEqual(['0-999','1000-1999','2000-2999','3000-3999','4000-4999']);
 expect(await page.evaluate(()=>window.AOL_ARCHIVE.projects.length)).toBe(5000);
});

test('the list is kept for 6 hours; a failed refresh keeps it up to 72 hours',async({page})=>{
 const {calls,server}=await archiveMode(page);
 await page.goto('/#explore');
 await expect.poll(()=>status(page)).toBe('ok');
 await page.reload();await page.waitForLoadState('networkidle');
 expect(await status(page)).toBe('cached');expect(calls.length).toBe(1);
 const age=ms=>page.evaluate(ms=>{const v=JSON.parse(localStorage.getItem('aol_archive_v1'));v.fetchedAt=new Date(Date.now()-ms).toISOString();localStorage.setItem('aol_archive_v1',JSON.stringify(v))},ms);
 server.fail=500;await age(7*H);await page.reload();
 await expect.poll(()=>status(page)).toBe('stale');
 expect(calls.length).toBe(2);
 await page.locator('#placeSearch').fill('Crown');await expect(page.locator('#placeResults .place-card')).toHaveCount(1);
 // The refresh state is internal (v0.17): settings shows no sync row; the previous list keeps working.
 await page.goto('/#settings');
 await expect(page.locator('#view')).toBeVisible();
 await expect(page.locator('#archiveSyncTime, #archiveSyncCount')).toHaveCount(0);
 await age(73*H);await page.reload();
 await expect.poll(()=>status(page)).toBe('unavailable');
 expect(await page.evaluate(()=>window.AOL_ARCHIVE.projects.length)).toBe(0);
});

test('filters: facets with counts, country and city, year range, photos; chips remove them; sorts',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await archiveMode(page);
 await page.goto('/#explore');
 await expect.poll(()=>status(page)).toBe('ok');
 const panel=page.locator('.filter-aside');
 await expect(panel).toBeVisible();
 // Region: the chip shows how many places it adds.
 const europe=panel.locator('[data-facet="region"][data-value="europe"]');
 await expect(europe).toContainText(String(listed.filter(p=>p.region==='europe').length));
 await europe.click();
 const inEurope=listed.filter(p=>p.region==='europe').length;
 await expect.poll(()=>count(page)).toBe(inEurope);
 await expect(europe).toHaveAttribute('aria-pressed','true');
 await expect(europe).toBeFocused();
 // Technology inside Europe (under "세부 분류", folded by default); then the country select (names in Korean, values
 // are ISO codes).
 await panel.locator('[data-more-filters]').click();
 await panel.locator('[data-facet="technology"][data-value="led_rgb"]').click();
 await expect.poll(()=>count(page)).toBe(listed.filter(p=>p.region==='europe'&&p.technologies.includes('led_rgb')).length);
 await panel.locator('select[data-search-filter="country"]').selectOption('오스트리아');
 await expect(page.locator('#placeResults .result-meta')).toHaveText(`오스트리아 · ${listed.filter(p=>p.country_iso2==='AT'&&p.technologies.includes('led_rgb')).length}곳`);
 await expect(page.locator('.active-filters .chip')).toHaveText(['오스트리아','유럽','RGB LED']);
 await page.locator('.active-filters [data-clear-filter="facet:technology:led_rgb"]').click();
 await page.locator('.active-filters [data-clear-filter="country"]').click();
 await expect.poll(()=>count(page)).toBe(inEurope);
 await page.locator('.active-filters [data-clear-filter="facet:region:europe"]').click();
 // Year range: by year installed, else completed (places without a year drop out).
 await panel.locator('[data-search-filter="year_from"]').fill('2010');await panel.locator('[data-search-filter="year_from"]').press('Enter');
 await panel.locator('[data-search-filter="year_to"]').fill('2014');await panel.locator('[data-search-filter="year_to"]').press('Enter');
 const all=await page.evaluate(()=>allPlaces().length);
 const inYears=await page.evaluate(()=>allPlaces().filter(p=>{const y=AOLCatalog.yearOf(p);return y!==null&&y>=2010&&y<=2014}).length);
 expect(inYears).toBeGreaterThan(3);
 await expect.poll(()=>count(page)).toBe(inYears);
 await expect(page.locator('.active-filters')).toContainText('2010–2014년');
 await page.locator('.active-filters [data-clear-filter="years"]').click();
 await expect.poll(()=>count(page)).toBe(all);
 // The record origin and review group is research data (exports), not a public filter (v0.17).
 await expect(panel.locator('[data-facet="origin"]')).toHaveCount(0);
 // Photos: only places whose photo is cleared.
 await panel.locator('[data-filter-toggle="has_photo"]').click();
 await expect.poll(()=>count(page)).toBe(await page.evaluate(()=>allPlaces().filter(p=>mediaFor(p).length).length));
 await expect(page.locator('#placeResults')).toContainText('아르스 일렉트로니카 센터');
 await panel.getByRole('button',{name:'모두 지우기'}).click();
 await expect.poll(()=>count(page)).toBe(all);
 // Sorts: year (unknown years last), name in the current language.
 await page.locator('select[data-search-filter="sort"]').selectOption('year_asc');
 const years=await page.locator('#placeResults .place-card h3').evaluateAll(hs=>hs.map(h=>h.textContent));
 // Korean results first when no country is chosen (v0.18), each group in the chosen order.
 const expected=await page.evaluate(()=>{const ys=allPlaces().filter(p=>AOLCatalog.yearOf(p)!==null),kr=ys.filter(AOLCatalog.isKR);return (kr.length?kr:ys).sort((a,b)=>AOLCatalog.yearOf(a)-AOLCatalog.yearOf(b))[0].name_kr});
 expect(years[0]).toBe(expected);
 await page.locator('select[data-search-filter="sort"]').selectOption('name');
 const names=await page.locator('#placeResults .place-card h3').evaluateAll(hs=>hs.map(h=>h.textContent));
 expect(names).toEqual([...names].sort((a,b)=>a.localeCompare(b,'ko')));
 // Type chips under the search box: the archive's typology, multi-select.
 await page.locator('#typeChips [data-facet="project_type"][data-value="urban_screen"]').click();
 await page.locator('#typeChips [data-facet="project_type"][data-value="media_wall"]').click();
 await expect.poll(()=>count(page)).toBe(await page.evaluate(()=>allPlaces().filter(p=>['urban_screen','media_wall'].includes(AOLCatalog.typeOf(p))).length));
 await page.locator('#typeChips [data-type-all]').click();
 await expect.poll(()=>count(page)).toBe(all);
});

test.describe('phone',()=>{
 test.use({viewport:{width:390,height:844}});
 test('the filter sheet fills the screen, keeps its header and live count in view, and closes onto chips',async({page})=>{
  await archiveMode(page);
  await page.goto('/#explore');
  await expect.poll(()=>status(page)).toBe('ok');
  const all=await count(page);
  await page.locator('.advanced-filters summary').click();
  const sheet=page.locator('#filterPanel');
  await expect(sheet).toBeVisible();
  // Full screen once it has slid in.
  await expect.poll(async()=>JSON.stringify(await sheet.boundingBox())).toBe(JSON.stringify({x:0,y:0,width:390,height:844}));
  const head=sheet.locator('.sheet-head'),foot=sheet.locator('.sheet-foot');
  await expect(head.getByRole('button',{name:'필터 닫기'})).toBeVisible();
  await expect(head.getByRole('button',{name:'모두 지우기'})).toBeDisabled();
  await expect(foot.getByRole('button')).toHaveText(`${all}개 결과 보기`);
  // Scroll the body to the bottom: header and footer stay where they are, and choices keep the scroll position.
  const body=sheet.locator('.sheet-body');
  await body.evaluate(e=>e.scrollTop=e.scrollHeight);
  await sheet.locator('[data-more-filters]').click();
  await body.evaluate(e=>e.scrollTop=e.scrollHeight);
  const facet=sheet.locator('[data-facet="technology"][data-value="led_rgb"]');
  await facet.scrollIntoViewIfNeeded();
  const before=await body.evaluate(e=>e.scrollTop);
  await facet.click();
  await expect(facet).toHaveAttribute('aria-pressed','true');
  expect(Math.abs(await body.evaluate(e=>e.scrollTop)-before)).toBeLessThan(2);
  const n=await page.evaluate(()=>allPlaces().filter(p=>(p.technologies||[]).includes('led_rgb')).length);
  expect(n).toBeGreaterThan(1);
  await expect(foot.getByRole('button')).toHaveText(`${n}개 결과 보기`);
  expect((await head.boundingBox()).y).toBe(0);
  const fb=await foot.boundingBox();expect(fb.y+fb.height).toBeCloseTo(844,0);
  await expect(head.getByRole('button',{name:'모두 지우기'})).toBeEnabled();
  await foot.getByRole('button').click();
  await expect(sheet).toBeHidden();
  await expect.poll(()=>count(page)).toBe(n);
  await expect(page.locator('.active-filters .chip')).toHaveText(['RGB LED']);
  await expect(page.locator('.filter-button .count-badge')).toHaveText('1');
  await page.locator('.active-filters .chip').click();
  await expect.poll(()=>count(page)).toBe(all);
 });
});

// The one invariant of the map: its pins, the list under it and the count are the explore results that have usable
// coordinates (exact or street precision with a source, or verified), and they always agree.
// Pins are grid clusters (v0.17): a marker stands for one place (aolId) or a cluster of places (aolIds).
async function mapState(page){return page.evaluate(()=>{const b=currentMap?currentMap.getBounds():null,all=mapMarkers.flatMap(m=>m.aolIds||[m.aolId]),ids=all.filter(id=>{const p=place(id);return !b||b.contains([p.latitude,p.longitude])}).sort();return {pins:all.length,inView:ids.length,ids,list:[...document.querySelectorAll('#mapResults [data-map-select]')].map(e=>e.dataset.mapSelect).sort(),count:Number(document.querySelector('#mapResults .result-meta b').textContent.match(/([\d,]+)곳/)[1].replace(/,/g,'')),results:results().length,mappable:results().filter(AOLCatalog.mappable).length,canvasPoints:Number(document.querySelector('#mapCanvas')?.dataset.points||0)}})}
for(const viewport of [{width:390,height:844},{width:1440,height:900}])test(`map pins, the list under the map and its count agree with the explore results @${viewport.width}`,async({page})=>{
 await page.setViewportSize(viewport);
 await archiveMode(page);
 // The world view: every explore result (v0.18: the map opens on Korea, qa/v18.spec.mjs).
 await page.goto('/#map/world');
 await expect.poll(()=>status(page)).toBe('ok');
 const mappable=listed.filter(X.mappable);
 await expect(page.locator('#mapResults .result-meta b')).toContainText(`${mappable.length}곳`);
 // No coordinate review classes on the public map (v0.17): one kind of point, places without a location listed apart.
 await expect(page.locator('#view')).not.toContainText(/검증 전|편집 검증 좌표|수집 출처 좌표/);
 await page.locator('.map-consent [data-load-map]').click();
 await expect(page.locator('#mapCanvas.map-loaded')).toBeVisible();
 let s=await mapState(page);
 expect(s.pins).toBe(mappable.length);expect(s.mappable).toBe(mappable.length);expect(s.canvasPoints).toBe(mappable.length);
 expect(s.list).toEqual(s.ids);expect(s.count).toBe(s.inView);expect(s.inView).toBe(s.pins);
 // The same filter narrows explore and the map together.
 await page.locator('#typeChips [data-facet="project_type"][data-value="urban_screen"]').click();
 await expect.poll(async()=>(await mapState(page)).pins).toBe(mappable.filter(p=>p.project_type==='urban_screen').length);
 s=await mapState(page);expect(s.list).toEqual(s.ids);expect(s.count).toBe(s.inView);
 await expect(page.locator('#mapResults .map-off')).toContainText(`위치 정보가 없는 ${s.results-s.mappable}곳은 목록에서만 보여요.`);
 // Typing filters the map after a short pause; list, count and pins follow.
 await page.locator('#typeChips [data-type-all]').click();
 await page.locator('#placeSearch').fill('Times');
 await expect.poll(async()=>(await mapState(page)).pins).toBe(1);
 s=await mapState(page);expect(s.list).toEqual(['AR-times-square-screens']);expect(s.count).toBe(1);
 // Moving the map: the list and the count are the places in view.
 await page.locator('#placeSearch').fill('');
 await expect.poll(async()=>(await mapState(page)).pins).toBe(mappable.length);
 await page.evaluate(()=>currentMap.setView([48.3,14.28],9));
 // Only places near the view are drawn (clusters are rebuilt on every move), so the pins narrow with the view too.
 await expect.poll(async()=>{const m=await mapState(page);return m.count===m.inView&&m.list.join()===m.ids.join()&&m.inView<m.mappable&&m.mappable===mappable.length}).toBe(true);
 // Explore shows the same results; the map shows the part with coordinates.
 await page.goto('/#explore');
 expect(await count(page)).toBe((await curatedCount(page))+listed.length);
});

test('without a backend there is no archive request, and no account or sync control is offered',async({page})=>{
 const requests=[];page.on('request',r=>{if(/supabase\.co/.test(r.url()))requests.push(r.url())});
 await page.goto('/#settings');
 await expect.poll(()=>status(page)).toBe('disabled');
 await expect(page.locator('#archiveSyncCount')).toHaveCount(0);
 await expect(page.locator('#view')).not.toContainText(/동기화|서버에 연결/);
 await page.goto('/#my');await expect(page.locator('#view a[href="#account"], #view [data-sync]')).toHaveCount(0);
 await page.goto('/#saved');await expect(page.locator('#view')).not.toContainText('동기화 상태');
 await page.waitForLoadState('networkidle');
 expect(requests).toEqual([]);
});

test('archive detail: facts by group, sources, assessments, citation, similar projects; no review vocabulary',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await page.setViewportSize({width:1440,height:900});
 await archiveMode(page);
 await page.goto('/#place/AR-ars-electronica-center');
 await expect(page.locator('#view h1')).toHaveText('아르스 일렉트로니카 센터');
 const info=page.locator('#detailArchive');
 await expect(info.locator('.field-group h3')).toHaveText(['기본 정보','기술·건축 정보','맥락']);
 await expect(info.locator('.kv',{hasText:'설치 연도'})).toContainText('2009');
 await expect(info.locator('.kv',{hasText:'표시 면적'})).toContainText('5,100 ㎡');
 await expect(info.locator('.kv',{hasText:'참여자'})).toContainText('건축가: Treusch architecture');
 // Facts in plain words (v0.17): no field states, no list of unknown fields, no data-status card. Only known values.
 await expect(page.locator('#view .state-badge, #view .unknown-fields, #detailStatus')).toHaveCount(0);
 for(const label of ['운영 시작 연도','해상도','픽셀 피치(mm)'])await expect(info.locator('.kv dt',{hasText:label})).toHaveCount(0);
 // Sources: the official site first, then each source with its publisher and kind; every one links out.
 const sources=page.locator('#detailSources .source-item');
 await expect(sources.first()).toContainText('Ars Electronica');
 await expect(sources.first().locator('.pill')).toHaveText(['공식']);
 await expect(sources.first().locator('a')).toHaveAttribute('href','https://ars.electronica.art/center/');
 await expect(page.locator('#detailSources')).not.toContainText(/신뢰도|정상|확인 중/);
 // Researcher assessments are labelled as interpretation.
 await expect(page.locator('#detailAssess .assess-label')).toHaveText('연구자의 해석이에요. 수집된 데이터와 따로 보여드려요.');
 await expect(page.locator('#detailAssess .assess-item')).toContainText('확신 보통');
 // Citation with the record URL and today's access date; the copy button copies exactly that text.
 const cite=page.locator('#citationText');
 const today=await page.evaluate(()=>AOLCore.today());
 await expect(cite).toHaveText(`빛의 건축 아카이브, 「아르스 일렉트로니카 센터」, https://light-architecture-jihyun.peppydegu2.chatgpt.site/#place/AR-ars-electronica-center (${today} 접속).`);
 await page.getByRole('button',{name:'인용문 복사'}).click();
 await expect(page.locator('#toast')).toContainText('인용문을 복사했어요');
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(await cite.textContent());
 // Similar projects with the reasons they are similar.
 const similar=page.locator('#detailRelated .similar-item');
 const expected=X.similar(projects.find(p=>p.archive_slug==='ars-electronica-center'),listed).length;
 expect(expected).toBeGreaterThan(2);
 await expect(similar.first().locator('.similar-why span').first()).toHaveText('같은 유형: 미디어파사드');
 await expect(page.locator('#detailRelated .similar-item',{hasText:'쿤스트하우스 그라츠 BIX 파사드'}).locator('.similar-why span')).toHaveText(['같은 유형: 미디어파사드','같은 권역: 유럽','같은 연대: 2000년대']);
 // A broken official link and a broken source are said as such, never linked.
 await page.goto('/#place/AR-al-bahr-towers');
 await expect(page.locator('#view h1')).toHaveText('Al Bahr Towers');
 await expect(page.locator('.detail-sub bdi')).toHaveText('أبراج البحر');
 await expect(page.locator('#detailSources .link-broken')).toContainText('지금은 열리지 않는 링크');
 await expect(page.locator('#detailSources a[href="https://albahr.example/"]')).toHaveCount(0);
 // A failed image falls back to the placeholder and keeps its credit; an unlicensed one is never shown.
 await page.goto('/#place/AR-burj-khalifa-led');
 await expect(page.locator('.detail-hero .photo-failed')).toBeVisible();
 await expect(page.locator('.detail-hero .image-credit')).toContainText('Gulf Photo · CC BY 4.0');
 await page.goto('/#place/AR-shibuya-crossing-screens');
 await expect(page.locator('img[data-place-photo]')).toHaveCount(0);
 await expect(page.locator('#detailPhotos')).toContainText('아직 자유 라이선스로 공개된 사진이 없어요.');
 await expect(page.locator('#detailPhotos .gallery-empty .ph')).toBeVisible();
 // A curated place enriched by its archive record shows the archive's facts.
 await page.goto('/#place/SEOUL007');
 await expect(page.locator('#detailArchive .kv',{hasText:'프로젝트 유형'})).toContainText('도시 대형 스크린');
 await expect(page.locator('#view .state-badge, #detailStatus')).toHaveCount(0);
 // A very long title wraps inside the page.
 await page.setViewportSize({width:320,height:700});
 await page.goto('/#place/AR-convention-centre-north-atrium-interactive-facade-phase-two');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBe(0);
});

// CSV as the app writes it: every cell quoted, CRLF, a BOM, a '#' warning line before the header.
const parseCSV=text=>text.replace(/^﻿/,'').split('\r\n').filter(Boolean).map(line=>line.startsWith('#')?line:[...line.matchAll(/"((?:[^"]|"")*)"/g)].map(m=>m[1].replace(/""/g,'"')));
test('research data page: statistics of the filtered set; CSV and JSON exports carry provenance, the dictionary and licences',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await archiveMode(page);
 await page.goto('/#explore');
 await expect.poll(()=>status(page)).toBe('ok');
 await page.locator('.filter-aside [data-facet="region"][data-value="europe"]').click();
 const europe=listed.filter(p=>p.region==='europe');
 await expect.poll(()=>count(page)).toBe(europe.length);
 await page.getByRole('link',{name:'이 결과의 통계와 내보내기'}).click();
 await expect(page).toHaveURL(/#data$/);
 await expect(page.locator('#view h1')).toHaveText('연구 데이터');
 await expect(page.locator('.data-scope-line')).toContainText(`${europe.length}곳`);
 await expect(page.locator('.data-scope .chip')).toHaveText(['유럽']);
 // Statistics: the same set, counted per value, every bar labelled with its number.
 const st=X.stats(europe);
 await expect(page.locator('#chartRegion .bars li')).toHaveCount(1);
 await expect(page.locator('#chartRegion .bars li')).toHaveText([`유럽${europe.length}`]);
 await expect(page.locator('#chartType .bar-value')).toHaveText(st.project_type.rows.map(r=>String(r[1])));
 await expect(page.locator('#chartTech .bar-value')).toHaveText(st.technology.rows.map(r=>String(r[1])));
 await expect(page.locator('#chartCountry .bar-label')).toHaveText(st.country.rows.map(r=>({AT:'오스트리아',DE:'독일',ES:'스페인',GB:'영국',FR:'프랑스'})[r[0]]));
 await expect(page.locator('#chartDecade small')).toContainText(`값 없음 ${st.decade.unknown}곳`);
 for(const id of ['chartRegion','chartCountry','chartDecade','chartType','chartMethod','chartTech'])await expect(page.locator('#'+id+' figcaption h3')).toBeVisible();
 // CSV: BOM, the warning line, the header from the data dictionary, one row per place with provenance.
 const [csvDownload]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'CSV 내려받기 (Excel)'}).click()]);
 expect(csvDownload.suggestedFilename()).toMatch(/^빛의건축_아카이브_\d{4}-\d{2}-\d{2}\.csv$/);
 const csv=readFileSync(await csvDownload.path(),'utf8');
 expect(csv.charCodeAt(0)).toBe(0xFEFF);
 const [warning,header,...rows]=parseCSV(csv);
 expect(warning).toBe('# '+X.WARNING.ko);
 expect(header).toEqual(X.EXPORT_FIELDS.map(f=>f[0]));
 expect(rows.length).toBe(europe.length);
 const col=k=>header.indexOf(k),ars=rows.find(r=>r[0]==='AR-ars-electronica-center');
 expect([ars[col('project_type')],ars[col('project_type_label')],ars[col('region')],ars[col('country_iso2')],ars[col('coordinate_source')],ars[col('data_origin')],ars[col('review_status')]]).toEqual(['media_facade','미디어파사드','europe','AT','verified','editor_verified','researcher_assessed']);
 expect(ars[col('field_states')]).toContain('latitude=editor_verified');
 expect(ars[col('source_urls')]).toContain('https://ars.electronica.art/center/');
 expect(ars[col('record_url')]).toBe('https://light-architecture-jihyun.peppydegu2.chatgpt.site/#place/AR-ars-electronica-center');
 const fete=rows.find(r=>r[0]==='AR-fete-des-lumieres');
 expect([fete[col('latitude')],fete[col('coordinate_source')]]).toEqual(['','']);
 // JSON: meta with the time, the filters, the dictionary, licence notes per source and the warning.
 const [jsonDownload]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'JSON 내려받기'}).click()]);
 expect(jsonDownload.suggestedFilename()).toMatch(/^빛의건축_아카이브_\d{4}-\d{2}-\d{2}\.json$/);
 const json=JSON.parse(readFileSync(await jsonDownload.path(),'utf8'));
 expect(Object.keys(json)).toEqual(['meta','projects']);
 expect(Date.now()-Date.parse(json.meta.generated_at)).toBeLessThan(60000);
 expect(json.meta.filters).toEqual({region:['europe']});
 expect(json.meta.count).toBe(europe.length);
 expect(json.meta.app_version).toMatch(/^\d+\.\d+\.\d+$/);
 await expect(page.locator('.sidebar .version')).toHaveText('빛의 건축 v'+json.meta.app_version);
 expect(json.meta.warning).toBe(X.WARNING.ko);
 expect(json.meta.licenses.wikidata).toContain('CC0');
 expect(json.meta.licenses.commons).toContain('파일마다 다름');
 expect(json.meta.licenses.editorial).toContain('운영자 확정 필요');
 expect(json.meta.data_dictionary.map(d=>d.field)).toEqual(X.EXPORT_FIELDS.map(f=>f[0]));
 expect(json.meta.citation).toContain(`${europe.length}곳`);
 expect(json.projects.map(p=>p.place_id).sort()).toEqual(europe.map(p=>p.place_id).sort());
 // Methodology for researchers, in plain words (v0.17): where the data comes from, how often it changes, how photos
 // are chosen, how it is classified, its limits and how to cite; no internal review or pipeline terms.
 const method=page.locator('#methodology');
 await expect(method.locator('h3')).toHaveText(['어디에서 오나요','얼마나 자주 바뀌나요','사진은 어떻게 고르나요','어떻게 분류하나요','한계','인용 방법']);
 for(const w of ['Wikidata','Wikimedia Commons','공식 웹사이트'])await expect(method).toContainText(w);
 await expect(method).not.toContainText(/검수|미검수|항목별 상태|6시간마다|수집기|GDELT/);
});

// The interface language: a compact switch in the top bar and a choice in settings, kept with the user's preferences,
// <html lang> follows. Covered screens switch fully (tests/i18n.test.cjs checks every string); data stays as recorded.
test('KO/EN: the top-bar switch and the settings choice change the interface, <html lang>, exports, and survive a reload',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await archiveMode(page);
 await page.goto('/#explore');await expect.poll(()=>status(page)).toBe('ok');
 const html=page.locator('html'),toggle=page.locator('#langToggle'),total=await curatedCount(page)+listed.length;
 await expect(html).toHaveAttribute('lang','ko');
 await expect(toggle).toHaveText('EN');await expect(toggle).toHaveAttribute('aria-label','Show in English');await expect(toggle).toHaveAttribute('lang','en');
 await toggle.click();
 await expect(html).toHaveAttribute('lang','en');
 // The switch names the other language, in that language.
 await expect(toggle).toHaveText('KO');await expect(toggle).toHaveAttribute('aria-label','한국어로 보기');await expect(toggle).toHaveAttribute('lang','ko');
 // Explore: title, navigation, search, count, filters, the link to the data page; the results are unchanged.
 await expect(page.locator('#view h1')).toHaveText('Archive search');
 await expect(page).toHaveTitle('Archive search · Architecture of Light');
 await expect(page.getByRole('link',{name:'Map',exact:true}).first()).toBeVisible();
 await expect(page.locator('#placeSearch')).toHaveAttribute('placeholder','Search names, cities, artists, buildings');
 await expect(page.locator('#placeResults .result-meta')).toContainText(`${total} places`);
 await expect(page.locator('#filterPanel')).toContainText('Filters');
 await page.locator('.filter-aside [data-facet="region"][data-value="europe"]').click();
 const europe=listed.filter(p=>p.region==='europe');
 await expect(page.locator('#placeResults .result-meta')).toContainText(`${europe.length} places`);
 await expect(page.locator('.active-filters .chip')).toHaveText(['Europe']);
 // A place page: English names first, archive groups, sources, citation; no unknown-field list or data status.
 await page.goto('/#place/AR-ars-electronica-center');
 await expect(page.locator('#view h1')).toHaveText('Ars Electronica Center');
 await expect(page.locator('#detailArchive .field-group h3')).toHaveText(['Basic information','Technical and architectural','Context']);
 await expect(page.locator('#detailArchive .unknown-fields, #detailStatus')).toHaveCount(0);
 await expect(page.locator('#detailSources h2')).toHaveText('Official site and sources');
 await expect(page.locator('#detailPhotos h2')).toHaveText('Photos and video');
 await expect(page.locator('#citationText')).toHaveText(/^Architecture of Light archive, “Ars Electronica Center,” .+ \(accessed \d{4}-\d{2}-\d{2}\)\.$/);
 await expect(page.getByRole('button',{name:'Copy citation'})).toBeVisible();
 await expect(page.locator('#detailRelated h2')).toHaveText('Similar projects');
 // The data page and its export in English: the warning and the dictionary follow the language.
 await page.goto('/#data');
 await expect(page.locator('#view h1')).toHaveText('Research data');
 const [csvDownload]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download CSV (Excel)'}).click()]);
 expect(csvDownload.suggestedFilename()).toMatch(/^architecture-of-light-archive_\d{4}-\d{2}-\d{2}\.csv$/);
 const [warning,header]=parseCSV(readFileSync(await csvDownload.path(),'utf8'));
 expect(warning).toBe('# '+X.WARNING.en);expect(header).toEqual(X.EXPORT_FIELDS.map(f=>f[0]));
 const [jsonDownload]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download JSON'}).click()]);
 const json=JSON.parse(readFileSync(await jsonDownload.path(),'utf8'));
 expect(json.meta.warning).toBe(X.WARNING.en);
 expect(json.meta.data_dictionary.find(d=>d.field==='country_iso2').description).toBe('Country code');
 // Settings: the language choice, each option in its own language; kept across a reload.
 await page.goto('/#settings');
 await expect(page.locator('#view h1')).toHaveText('Settings');
 await expect(page.getByRole('radio',{name:'English'})).toHaveAttribute('aria-checked','true');
 await expect(page.getByRole('radio',{name:'한국어'})).toHaveAttribute('lang','ko');
 await page.reload();
 await expect(html).toHaveAttribute('lang','en');await expect(page.locator('#view h1')).toHaveText('Settings');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem(AOLCore.KEY)).preferences.language)).toBe('en');
 // On a phone the switch stays in the top bar and the filter sheet speaks English.
 await page.setViewportSize({width:390,height:844});
 await page.goto('/#explore');await expect.poll(()=>status(page)).toMatch(/^(ok|cached)$/);
 await expect(toggle).toBeVisible();
 await page.locator('.advanced-filters summary').click();
 await expect(page.locator('#filterPanel')).toBeVisible();
 await expect(page.locator('#filterPanel').getByRole('button',{name:/^Show \d+ results$/})).toBeVisible();
 await expect(page.locator('#filterPanel').getByRole('button',{name:'Clear all'})).toBeVisible();
 await page.keyboard.press('Escape');
 // Back to Korean from settings.
 await page.goto('/#settings');
 await page.getByRole('radio',{name:'한국어'}).click();
 await expect(html).toHaveAttribute('lang','ko');await expect(page.locator('#view h1')).toHaveText('설정');await expect(toggle).toHaveText('EN');
 await page.reload();
 await expect(html).toHaveAttribute('lang','ko');await expect(page.locator('#view h1')).toHaveText('설정');
});

// No horizontal scroll on the archive screens at every width, in both themes; WCAG A/AA scans with archive data.
const SCREENS=['home','explore','map','data','place/AR-ars-electronica-center','place/AR-convention-centre-north-atrium-interactive-facade-phase-two','place/AR-burj-khalifa-led','place/SEOUL007','settings'];
for(const colorScheme of ['light','dark'])test.describe(colorScheme,()=>{
 test.use({colorScheme});
 test(`no horizontal scroll at 320, 390, 768, 1024 and 1440 px (${colorScheme})`,async({page})=>{
  test.setTimeout(120000);
  await archiveMode(page);
  await page.goto('/#explore');await expect.poll(()=>status(page)).toBe('ok');
  for(const width of [320,390,768,1024,1440]){
   await page.setViewportSize({width,height:width<500?800:900});
   for(const r of SCREENS){
    await page.goto('/#'+r);await expect(page.locator('#view h1').first()).toBeVisible();
    if(r==='explore'&&width<1360){await page.locator('.advanced-filters summary').click();await expect(page.locator('#filterPanel')).toBeVisible();await page.locator('#filterPanel').evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished)))}
    const over=await page.evaluate(()=>({x:document.documentElement.scrollWidth-document.documentElement.clientWidth,wide:[...document.querySelectorAll('#view *')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&e.checkVisibility()&&b.right>document.documentElement.clientWidth+1&&!e.closest('[class*=scroll],.chips,.rail,.carousel,.section-tabs,.leaflet-container')}).slice(0,3).map(e=>e.tagName+'.'+e.className)}));
    expect(over,`${r} @${width}`).toEqual({x:0,wide:[]});
   }
  }
 });
 for(const r of ['explore','map','data','place/AR-ars-electronica-center','place/AR-al-bahr-towers'])for(const width of [390,1440])test(`a11y ${colorScheme} #${r} @${width} with archive data`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await archiveMode(page);
  await page.goto('/#'+r);await expect.poll(()=>status(page)).toBe('ok');await page.waitForLoadState('networkidle');
  if(r==='explore'&&width<1360){await page.locator('.advanced-filters summary').click();await expect(page.locator('#filterPanel')).toBeVisible();await page.locator('#filterPanel').evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished)))}
  const {violations}=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  expect(violations.map(v=>`${v.id} (${v.impact}): ${v.nodes.slice(0,3).map(n=>n.target.join(' ')).join(' | ')}`)).toEqual([]);
 });
});
