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
 await page.goto('/#settings');
 await expect(page.locator('#archiveSyncTime')).toContainText('최근 갱신 실패, 이전 결과 사용 중');
 await age(73*H);await page.reload();
 await expect.poll(()=>status(page)).toBe('unavailable');
 expect(await page.evaluate(()=>window.AOL_ARCHIVE.projects.length)).toBe(0);
});

test('filters: facets with counts, country and city, year range, origin, photos; chips remove them; sorts',async({page})=>{
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
 // Technology inside Europe; then the country select (names in Korean, values are ISO codes).
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
 // Origin groups: unreviewed automatic records are a filter of their own.
 await panel.locator('[data-facet="origin"][data-value="unreviewed"]').click();
 await expect.poll(()=>count(page)).toBe(listed.filter(p=>X.originOf(p)==='unreviewed').length);
 await panel.locator('[data-facet="origin"][data-value="unreviewed"]').click();
 // Photos: only places whose photo is cleared.
 await panel.locator('[data-filter-toggle="has_photo"]').click();
 await expect.poll(()=>count(page)).toBe(await page.evaluate(()=>allPlaces().filter(p=>mediaFor(p).length).length));
 await expect(page.locator('#placeResults')).toContainText('아르스 일렉트로니카 센터');
 await panel.getByRole('button',{name:'모두 지우기'}).click();
 await expect.poll(()=>count(page)).toBe(all);
 // Sorts: year (unknown years last), name in the current language.
 await page.locator('select[data-search-filter="sort"]').selectOption('year_asc');
 const years=await page.locator('#placeResults .place-card h3').evaluateAll(hs=>hs.map(h=>h.textContent));
 const expected=await page.evaluate(()=>allPlaces().filter(p=>AOLCatalog.yearOf(p)!==null).sort((a,b)=>AOLCatalog.yearOf(a)-AOLCatalog.yearOf(b))[0].name_kr);
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
  const facet=sheet.locator('[data-facet="origin"][data-value="editor_verified"]');
  await facet.scrollIntoViewIfNeeded();
  const before=await body.evaluate(e=>e.scrollTop);
  await facet.click();
  await expect(facet).toHaveAttribute('aria-pressed','true');
  expect(Math.abs(await body.evaluate(e=>e.scrollTop)-before)).toBeLessThan(2);
  const n=listed.filter(p=>X.originOf(p)==='editor_verified').length;
  await expect(foot.getByRole('button')).toHaveText(`${n}개 결과 보기`);
  expect((await head.boundingBox()).y).toBe(0);
  const fb=await foot.boundingBox();expect(fb.y+fb.height).toBeCloseTo(844,0);
  await expect(head.getByRole('button',{name:'모두 지우기'})).toBeEnabled();
  await foot.getByRole('button').click();
  await expect(sheet).toBeHidden();
  await expect.poll(()=>count(page)).toBe(n);
  await expect(page.locator('.active-filters .chip')).toHaveText(['편집 검수']);
  await expect(page.locator('.filter-button .count-badge')).toHaveText('1');
  await page.locator('.active-filters .chip').click();
  await expect.poll(()=>count(page)).toBe(all);
 });
});

// The one invariant of the map: its pins, the list under it and the count are the explore results that have usable
// coordinates (exact or street precision with a source, or verified), and they always agree.
async function mapState(page){return page.evaluate(()=>{const b=currentMap?currentMap.getBounds():null,inView=mapMarkers.filter(m=>!b||b.contains(m.getLatLng()));return {pins:mapMarkers.length,inView:inView.length,ids:inView.map(m=>m.aolId).sort(),list:[...document.querySelectorAll('#mapResults [data-map-select]')].map(e=>e.dataset.mapSelect).sort(),count:Number(document.querySelector('#mapResults .result-meta b').textContent.match(/([\d,]+)곳/)[1].replace(/,/g,'')),results:results().length,mappable:results().filter(AOLCatalog.mappable).length,kinds:mapMarkers.reduce((a,m)=>(a[m.aolSource]=(a[m.aolSource]||0)+1,a),{})}})}
for(const viewport of [{width:390,height:844},{width:1440,height:900}])test(`map pins, the list under the map and its count agree with the explore results @${viewport.width}`,async({page})=>{
 await page.setViewportSize(viewport);
 await archiveMode(page);
 await page.goto('/#map');
 await expect.poll(()=>status(page)).toBe('ok');
 const mappable=listed.filter(X.mappable);
 await expect(page.locator('#mapResults .result-meta b')).toContainText(`${mappable.length}곳`);
 await expect(page.locator('#mapResults .result-meta')).toContainText(`검증 좌표 ${mappable.filter(p=>X.coordKind(p)==='verified').length}곳 · Wikidata 좌표 0곳 · 출처 좌표 ${mappable.filter(p=>X.coordKind(p)==='source').length}곳`);
 await expect(page.locator('.map-legend')).toContainText('편집 검증 좌표');
 await expect(page.locator('.map-legend')).toContainText('수집 출처 좌표 · 검증 전');
 await page.locator('.legend-rule summary').click();
 await expect(page.locator('.legend-rule p')).toContainText('도시 수준 좌표');
 await page.locator('.map-consent [data-load-map]').click();
 await expect(page.locator('#mapCanvas.map-loaded')).toBeVisible();
 let s=await mapState(page);
 expect(s.pins).toBe(mappable.length);expect(s.mappable).toBe(mappable.length);
 expect(s.list).toEqual(s.ids);expect(s.count).toBe(s.inView);expect(s.inView).toBe(s.pins);
 expect(s.kinds).toEqual({verified:mappable.filter(p=>X.coordKind(p)==='verified').length,source:mappable.filter(p=>X.coordKind(p)==='source').length});
 // The same filter narrows explore and the map together.
 await page.locator('#typeChips [data-facet="project_type"][data-value="urban_screen"]').click();
 await expect.poll(async()=>(await mapState(page)).pins).toBe(mappable.filter(p=>p.project_type==='urban_screen').length);
 s=await mapState(page);expect(s.list).toEqual(s.ids);expect(s.count).toBe(s.inView);
 await expect(page.locator('#mapResults .map-off')).toContainText(`${s.results-s.mappable}곳은 지도에 없어요`);
 // Typing filters the map after a short pause; list, count and pins follow.
 await page.locator('#typeChips [data-type-all]').click();
 await page.locator('#placeSearch').fill('Times');
 await expect.poll(async()=>(await mapState(page)).pins).toBe(1);
 s=await mapState(page);expect(s.list).toEqual(['AR-times-square-screens']);expect(s.count).toBe(1);
 // Moving the map: the list and the count are the pins in view.
 await page.locator('#placeSearch').fill('');
 await expect.poll(async()=>(await mapState(page)).pins).toBe(mappable.length);
 await page.evaluate(()=>currentMap.setView([48.3,14.28],9));
 await expect.poll(async()=>{const m=await mapState(page);return m.count===m.inView&&m.list.join()===m.ids.join()&&m.inView<m.pins}).toBe(true);
 // Explore shows the same results; the map shows the part with coordinates.
 await page.goto('/#explore');
 expect(await count(page)).toBe((await curatedCount(page))+listed.length);
});

test('without a backend there is no archive request and the status says so',async({page})=>{
 const requests=[];page.on('request',r=>{if(/supabase\.co/.test(r.url()))requests.push(r.url())});
 await page.goto('/#settings');
 await expect.poll(()=>status(page)).toBe('disabled');
 await expect(page.locator('#archiveSyncCount')).toHaveText('서버에 연결되지 않아 편집부 수록 장소와 Wikidata 장소만 보여요');
 await page.waitForLoadState('networkidle');
 expect(requests).toEqual([]);
});

test('archive detail: archive record by group, the 미확인 disclosure, sources, data status, assessments, citation, similar projects',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await page.setViewportSize({width:1440,height:900});
 await archiveMode(page);
 await page.goto('/#place/AR-ars-electronica-center');
 await expect(page.locator('#view h1')).toHaveText('아르스 일렉트로니카 센터');
 const info=page.locator('#detailArchive');
 await expect(info.locator('.field-group h3')).toHaveText(['기본 정보','기술·건축 정보','맥락']);
 await expect(info.locator('.kv',{hasText:'설치 연도'})).toContainText('2009');
 await expect(info.locator('.kv',{hasText:'설치 연도'}).locator('.state-badge')).toHaveText('편집 확인');
 await expect(info.locator('.kv',{hasText:'표시 면적'})).toContainText('5,100 ㎡');
 await expect(info.locator('.kv',{hasText:'표시 면적'}).locator('.state-badge')).toHaveText('출처 기재');
 await expect(info.locator('.kv',{hasText:'인터랙션'}).locator('.state-badge')).toHaveText('연구자 평가');
 await expect(info.locator('.kv',{hasText:'참여자'})).toContainText('건축가: Treusch architecture');
 // Unknown fields are listed apart, collapsed, and never filled in.
 const unknown=info.locator('.unknown-fields');
 await expect(unknown.locator('summary')).toHaveText('미확인 항목 3개');
 await expect(unknown.locator('li').first()).toBeHidden();
 await unknown.locator('summary').click();
 await expect(unknown.locator('li')).toHaveText(['운영 시작 연도','해상도','픽셀 피치(mm)']);
 // Sources: publisher, kind, licence, dates, link state, reliability, supported fields.
 const sources=page.locator('#detailSources .source-item');
 await expect(sources).toHaveCount(2);
 await expect(sources.first()).toContainText('Ars Electronica');
 await expect(sources.first().locator('.pill')).toHaveText(['공식','신뢰도 높음 90']);
 await expect(sources.first()).toContainText('2026-09-01');
 await expect(sources.first()).toContainText('2026-10-15 · 정상');
 await expect(sources.first()).toContainText('위도, 경도, 설치 연도, 운영 상태');
 await expect(sources.nth(1)).toContainText('CC BY 4.0');
 await expect(sources.first().locator('a')).toHaveAttribute('href','https://ars.electronica.art/center/');
 // Data status: record origin, review, collected and verified times, update state, in plain words.
 const status=page.locator('#detailStatus');
 await expect(status).toContainText('편집부 등록');await expect(status).toContainText('연구자 평가');await expect(status).toContainText('2026. 10. 10.');
 await expect(status).toContainText('6시간마다 자동 갱신돼요');
 // Researcher assessments are labelled as interpretation.
 await expect(page.locator('#detailAssess .assess-label')).toHaveText('연구자의 해석이에요. 수집된 데이터와 따로 보여드려요.');
 await expect(page.locator('#detailAssess .assess-item')).toContainText('확신 보통');
 // Citation with the record URL and today's access date; the copy button copies exactly that text.
 const cite=page.locator('#citationText');
 const today=await page.evaluate(()=>AOLCore.today());
 await expect(cite).toHaveText(`빛의 건축 아카이브, 「아르스 일렉트로니카 센터」, 편집 검수, https://light-architecture-jihyun.peppydegu2.chatgpt.site/#place/AR-ars-electronica-center (${today} 접속).`);
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
 await expect(page.locator('#detailSources .link-broken')).toContainText('링크 연결 안 됨');
 await expect(page.locator('#detailSources a[href="https://albahr.example/"]')).toHaveCount(0);
 await expect(page.locator('.detail-pills .pill').first()).toHaveText('링크 오류 · 확인 중');
 // A failed image falls back to the placeholder and keeps its credit; an unlicensed one is never shown.
 await page.goto('/#place/AR-burj-khalifa-led');
 await expect(page.locator('.detail-hero .photo-failed')).toBeVisible();
 await expect(page.locator('.detail-hero .image-credit')).toContainText('Gulf Photo · CC BY 4.0');
 await page.goto('/#place/AR-shibuya-crossing-screens');
 await expect(page.locator('img[data-place-photo]')).toHaveCount(0);
 await expect(page.locator('#detailPhotos')).toContainText('권리가 확인된 사진이 아직 없어요.');
 // A curated place enriched by its archive record shows the archive sections with the archive's states.
 await page.goto('/#place/SEOUL007');
 await expect(page.locator('#detailArchive .kv',{hasText:'프로젝트 유형'})).toContainText('도시 대형 스크린');
 await expect(page.locator('#detailArchive .kv',{hasText:'프로젝트 유형'}).locator('.state-badge')).toHaveText('편집 확인');
 await expect(page.locator('#detailStatus')).toContainText('편집부 수록');
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
 await expect(page.locator('#chartDecade small')).toContainText(`미확인 ${st.decade.unknown}곳`);
 for(const id of ['chartRegion','chartCountry','chartDecade','chartType','chartMethod','chartTech','chartOrigin'])await expect(page.locator('#'+id+' figcaption h3')).toBeVisible();
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
 expect(json.meta.warning).toBe(X.WARNING.ko);
 expect(json.meta.licenses.wikidata).toContain('CC0');
 expect(json.meta.licenses.commons).toContain('파일마다 다름');
 expect(json.meta.licenses.editorial).toContain('운영자 확정 필요');
 expect(json.meta.data_dictionary.map(d=>d.field)).toEqual(X.EXPORT_FIELDS.map(f=>f[0]));
 expect(json.meta.citation).toContain(`${europe.length}곳`);
 expect(json.projects.map(p=>p.place_id).sort()).toEqual(europe.map(p=>p.place_id).sort());
 // Methodology: sources, cadence, classification, review, field states and how to cite.
 const method=page.locator('#methodology');
 for(const h of ['출처','갱신 주기','분류','검수','항목별 상태','지도 표시 기준','인용 방법'])await expect(method.locator('h3',{hasText:h})).toHaveCount(1);
 await expect(method).toContainText('6시간마다 자동 갱신돼요');
 await expect(method).toContainText('웹·뉴스에서 찾은 후보는 편집 검수 후 공개돼요');
 await expect(method.locator('.state-list .state-badge')).toHaveText(['검증 전','출처 기재','분류 추정','편집 확인','연구자 평가']);
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
