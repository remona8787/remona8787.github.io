// The v0.18 screens on the static archive dataset (qa/fixtures/site-data in the v0.18 shape, served at /data/ with
// synthetic images): the Korea-first menu, the home page and its sections, the image slot rules (a small image never
// fills a large slot), the Korean and world sections, Korean-first search, the map's Korea and world views, and the
// fallback to a home.json of the v0.17 shape (the live dataset until the pipeline writes the new sections).
import {test,expect} from './fixtures.mjs';
import {readFileSync} from 'node:fs';
import {serveDataset,serveImages,filesOf,FIXTURE} from './fixtures/site-data-routes.mjs';
import {siteData,RECORDS} from './fixtures/site-data-projects.mjs';

const HOME=FIXTURE['home.json'];
const tiles=page=>page.route(/^https:\/\/([abc]\.)?tile\.openstreetmap\.org\//,r=>r.fulfill({status:204,body:''}));
const rec=id=>RECORDS.find(r=>r.id===id);
// The largest width in an <img>'s srcset (or its src's px width): what the browser may load at most.
const widest=loc=>loc.evaluateAll(xs=>xs.map(x=>{const s=x.getAttribute('srcset');if(s)return Math.max(...s.split(',').map(p=>Number(p.trim().split(/\s+/)[1]?.replace('w',''))||0));const m=/\/(\d+)px-/.exec(x.getAttribute('src')||'');return m?Number(m[1]):-1}));
const SECTIONS=['home','korea','programs','map','world','explore','saved'];

test.describe('menu',()=>{
 test('wide screens list every section, Korea first; the archive search is one of them',async({page})=>{
  await serveDataset(page);await serveImages(page);
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/#home');
  await expect(page.locator('#navigation .nav-link')).toHaveCount(7);
  expect(await page.locator('#navigation .nav-link').evaluateAll(xs=>xs.map(x=>x.getAttribute('href')))).toEqual(SECTIONS.map(s=>'#'+s));
  await expect(page.locator('#navigation .nav-link .nav-label')).toHaveText(['홈','국내 미디어파사드','국내 미디어아트·전시','지도','세계 미디어파사드','아카이브 검색','내 컬렉션']);
  await expect(page.locator('#navigation a[href="#home"]')).toHaveAttribute('aria-current','page');
  await page.locator('#navigation a[href="#korea"]').click();
  await expect(page.locator('#view h1')).toHaveText('국내 미디어파사드');
  await expect(page.locator('#navigation a[href="#korea"]')).toHaveAttribute('aria-current','page');
  await expect(page.locator('.top-more')).toBeHidden();
 });
 test('a phone keeps five tabs; the top bar has the search and a menu of every section',async({page})=>{
  await serveDataset(page);await serveImages(page);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#home');
  const tabs=page.locator('#navigation .nav-link:visible');
  await expect(tabs).toHaveCount(5);
  await expect(tabs.locator('.nav-short')).toHaveText(['홈','국내','지도','세계','컬렉션']);
  // Every tab is a 44 px target at least.
  for(const b of await tabs.evaluateAll(xs=>xs.map(x=>{const r=x.getBoundingClientRect();return [r.width,r.height]})))expect(Math.min(...b)).toBeGreaterThanOrEqual(44);
  await page.locator('#quickSearch').click();
  await expect(page).toHaveURL(/#explore$/);
  await expect(page.locator('#view h1')).toHaveText('아카이브 검색');
  await page.locator('.top-more summary').click();
  const items=page.locator('#moreMenu .menu-item');
  expect(await items.evaluateAll(xs=>xs.map(x=>x.getAttribute('href')))).toEqual([...SECTIONS.map(s=>'#'+s),'#my','#data','#settings','./about.html','./support.html']);
  await items.filter({hasText:'국내 미디어아트·전시'}).click();
  await expect(page).toHaveURL(/#programs$/);
  await expect(page.locator('#moreMenu')).toBeHidden();
  // The programmes page lights the 국내 tab on a phone (its own item is in the menu).
  await expect(page.locator('#navigation a[href="#korea"].phone-active')).toBeVisible();
 });
});

test.describe('home',()=>{
 test('Korean hero photos that fill the screen, eight Korean regions with counts, Korea featured, the world after',async({page})=>{
  const seen=await serveDataset(page);await serveImages(page);
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/#home');
  const slides=page.locator('.hero .hero-slide');
  const krHero=HOME.hero.filter(h=>rec(h.project).country_iso2==='KR');
  expect(krHero.length).toBeGreaterThan(1);
  expect(HOME.hero.length).toBeGreaterThan(krHero.length,'the fixture also has foreign hero photos');
  await expect(slides).toHaveCount(krHero.length);
  for(let i=0;i<krHero.length;i++){
   const s=slides.nth(i),h=krHero[i];
   await expect(s).toHaveAttribute('data-country','KR');
   await expect(s.locator('.plate-title')).toHaveAttribute('href','#place/AR-'+h.project);
   await expect(s.locator('.plate-credit')).toContainText(`© ${h.image.author} · ${h.image.license}`);
   await expect(s.locator('.plate-credit')).toContainText('Wikimedia Commons');
  }
  // The first slide is the page's largest image: eager with priority, a srcset up to 3840 (below the 4000 px original).
  const first=slides.first().locator('img');
  await expect(first).toHaveAttribute('fetchpriority','high');
  await expect(first).not.toHaveAttribute('loading','lazy');
  await expect(first).toHaveAttribute('decoding','async');
  expect(await first.getAttribute('srcset')).toMatch(/ 3840w$/);
  await expect(slides.nth(1).locator('img')).toHaveAttribute('loading','lazy');
  await expect(page.locator('.hero-intro .hero-stats')).toHaveText(`국내 ${HOME.counts.kr}곳 · 세계 ${HOME.counts.world}곳`);
  // Eight Korean regions in order, with the counts of home.json; a region without a large photo gets its tile design.
  const tilesLoc=page.locator('.home-kr-regions .kr-tile');
  await expect(tilesLoc).toHaveCount(8);
  await expect(tilesLoc.locator('.region-name')).toHaveText(['서울','경기·인천','강원','대전·세종·충청','광주·전라','대구·경북','부산·울산·경남','제주']);
  await expect(tilesLoc.locator('.region-count')).toHaveText(HOME.kr_regions.map(r=>`${r.count}개 프로젝트`));
  await expect(page.locator('.home-kr-regions a[href="#korea/gyeonggi_incheon"] .ph-region')).toHaveCount(1);
  // Korean featured and programmes, then the world: the editorial mix is about three quarters Korean.
  await expect(page.locator('.home-featured .place-card')).toHaveCount(5);
  await expect(page.locator('.home-programs .place-card')).toHaveCount(Math.min(8,HOME.kr_programs.length));
  await expect(page.locator('.home-world .place-card')).toHaveCount(6);
  for(const sel of ['.home-featured','.home-programs'])expect(await page.locator(sel+' .place-card').evaluateAll(xs=>xs.every(x=>x.dataset.country==='KR'))).toBe(true);
  expect(await page.locator('.home-world .place-card').evaluateAll(xs=>xs.every(x=>x.dataset.country&&x.dataset.country!=='KR'))).toBe(true);
  const mix=await page.locator('#view [data-country]').evaluateAll(xs=>xs.filter(x=>x.dataset.country==='KR').length/xs.length);
  expect(mix).toBeGreaterThanOrEqual(.7);
  // Section order: regions, featured, programmes … world last.
  expect(await page.locator('#view .home-section').evaluateAll(xs=>xs.map(x=>x.className.split(' ')[1]))).toEqual(['home-kr-regions','home-featured','home-programs','home-courses','home-world']);
  await page.waitForLoadState('networkidle');
  expect(seen,'the home page reads home.json only').toEqual(['home.json']);
  // A region tile opens that region.
  await page.locator('.home-kr-regions a[href="#korea/jeju"]').click();
  await expect(page.locator('#view h1')).toHaveText('제주');
 });

 test('every photo on the home page is large enough for its slot; never a context photo',async({page})=>{
  await serveDataset(page);await serveImages(page);
  for(const [w,h] of [[390,844],[1440,900]]){
   await page.setViewportSize({width:w,height:h});
   await page.goto('/#home');await expect(page.locator('.hero-slide').first()).toBeVisible();
   for(const [sel,min] of [['.hero-slide img',1600],['.feature-lead .card-art img',960],['.kr-tile .region-art img',480]]){
    const ws=await widest(page.locator(sel));
    expect(ws.length,sel).toBeGreaterThan(0);
    for(const x of ws)expect(x,sel).toBeGreaterThanOrEqual(min);
   }
   const srcs=await page.locator('#view img[data-place-photo]').evaluateAll(xs=>xs.map(x=>x.getAttribute('src')));
   for(const src of srcs)expect(src,'home image').not.toMatch(/_day_\d/);
  }
  // The project whose only photo is 500 px wide is featured (home.json says so) but never the large lead.
  expect(HOME.kr_featured).toContain('suwon-hwaseong-media-art');
  await expect(page.locator('.feature-lead a[href="#place/AR-suwon-hwaseong-media-art"]')).toHaveCount(0);
 });

 test('a 500 px image in the hero slot is never shown: another hero photo, else the best one elsewhere, else the graphic',async({page})=>{
  const small=rec('suwon-hwaseong-media-art').images[0];
  expect(small.width).toBe(500);
  const smallHero={project:'suwon-hwaseong-media-art',image:{...small,role:'hero',approved:true}};
  const krBig=HOME.hero.find(h=>rec(h.project).country_iso2==='KR'),worldBig=HOME.hero.find(h=>rec(h.project).country_iso2!=='KR');
  const projects={...HOME.projects,'suwon-hwaseong-media-art':{...HOME.projects['suwon-hwaseong-media-art']}};
  const run=async hero=>{const p=await page.context().newPage();await serveDataset(p,{...FIXTURE,'home.json':{...HOME,hero,projects}});const imgs=await serveImages(p);await p.goto('/#home');await p.waitForLoadState('networkidle');return {p,imgs}};
  // Another Korean hero photo is large enough: only that one.
  let {p,imgs}=await run([smallHero,krBig]);
  await expect(p.locator('.hero-slide')).toHaveCount(1);
  await expect(p.locator('.hero-slide .plate-title')).toHaveAttribute('href','#place/AR-'+krBig.project);
  expect(await p.locator('.hero-slide img').evaluateAll(xs=>xs.map(x=>x.getAttribute('src')+' '+x.getAttribute('srcset')).join()),'the small file is not the hero').not.toMatch(/_small_/);
  expect(imgs.some(u=>/_hero_/.test(u))).toBe(true);
  await p.close();
  // No Korean one large enough: the best reviewed photo elsewhere.
  ({p}=await run([smallHero,worldBig]));
  await expect(p.locator('.hero-slide')).toHaveCount(1);
  await expect(p.locator('.hero-slide')).not.toHaveAttribute('data-country','KR');
  await p.close();
  // Nothing large enough: the generative graphic, which says it is a graphic.
  ({p}=await run([smallHero]));
  await expect(p.locator('.hero-slide')).toHaveCount(0);
  await expect(p.locator('.hero-generative .hero-graphic-note')).toHaveText('빛의 건축 그래픽 · 실제 프로젝트 사진이 아니에요');
  await p.close();
 });

 test('a home.json of the v0.17 shape (the live dataset today) is regrouped Korea first, from home.json only',async({page})=>{
  const files=filesOf(siteData(RECORDS,{home:'v17'}));
  expect(files['home.json'].kr_regions).toBeUndefined();
  const seen=await serveDataset(page,files);await serveImages(page);
  await page.goto('/#home');
  await expect(page.locator('.hero-slide').first()).toBeVisible();
  expect(await page.locator('.hero-slide').evaluateAll(xs=>xs.map(x=>x.dataset.country))).toEqual(files['home.json'].hero.filter(h=>rec(h.project).country_iso2==='KR').map(()=>'KR'));
  await expect(page.locator('.home-kr-regions .kr-tile')).toHaveCount(8);
  await expect(page.locator('.home-kr-regions .region-count')).toHaveCount(0);
  expect(await page.locator('.home-featured .place-card, .home-programs .place-card').evaluateAll(xs=>xs.length>0&&xs.every(x=>x.dataset.country==='KR'))).toBe(true);
  await page.waitForLoadState('networkidle');
  expect(seen).toEqual(['home.json']);
 });
});

test.describe('Korean and world sections',()=>{
 test.beforeEach(async({page})=>{await serveDataset(page);await serveImages(page);await tiles(page)});
 test('국내 미디어파사드: region tiles, their counts and each region\'s list agree',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/#korea');
  const tilesLoc=page.locator('.kr-regions .kr-tile');
  await expect(tilesLoc).toHaveCount(8);
  const counts=(await tilesLoc.locator('.region-count').allTextContents()).map(t=>Number(t.replace(/\D/g,'')));
  // Every region of the fixture has its projects; Seoul adds the curated Seoul places.
  for(const [i,key] of ['seoul','gyeonggi_incheon','gangwon','daejeon_sejong_chungcheong','gwangju_jeolla','daegu_gyeongbuk','busan_ulsan_gyeongnam','jeju'].entries())expect(counts[i],key).toBeGreaterThanOrEqual(RECORDS.filter(r=>r.kr_region===key).length);
  // The facades of Korea: only Korean projects of the facade types.
  const list=page.locator('#krList .place-card');
  expect(await list.evaluateAll(xs=>xs.every(x=>x.dataset.country==='KR'))).toBe(true);
  for(const key of ['busan_ulsan_gyeongnam','gangwon','seoul']){
   await page.locator(`.kr-regions a[href="#korea/${key}"]`).click();
   await expect(page).toHaveURL(new RegExp(`#korea/${key}$`));
   const n=counts[['seoul','gyeonggi_incheon','gangwon','daejeon_sejong_chungcheong','gwangju_jeolla','daegu_gyeongbuk','busan_ulsan_gyeongnam','jeju'].indexOf(key)];
   await expect(page.locator('#krList .result-meta')).toHaveAttribute('data-count',String(n));
   await expect(page.locator('#krList .place-card')).toHaveCount(n);
   await expect(page.locator(`.kr-regions a[href="#korea/${key}"]`)).toHaveAttribute('aria-current','page');
  }
  // To the archive search, filtered to the region.
  await page.locator('[data-explore-kr="seoul"]').click();
  await expect(page).toHaveURL(/#explore$/);
  await expect(page.locator('#placeResults .result-meta')).toHaveAttribute('data-count',String(counts[0]));
 });
 test('국내 미디어아트·전시: Korean programmes by type and region; the count is the list',async({page})=>{
  await page.goto('/#programs');
  await expect(page.locator('.section-switch a[aria-current=page]')).toHaveText('국내 미디어아트·전시');
  const all=Number(await page.locator('#krList .result-meta').getAttribute('data-count'));
  expect(all).toBeGreaterThanOrEqual(RECORDS.filter(r=>r.country_iso2==='KR'&&!['media_facade','projection_mapping','urban_screen','media_wall'].includes(r.project_type)).length);
  await page.locator('[data-prog-type="festival_program"]').click();
  const n=Number(await page.locator('#krList .result-meta').getAttribute('data-count'));
  expect(n).toBe(RECORDS.filter(r=>r.country_iso2==='KR'&&r.project_type==='festival_program').length);
  await expect(page.locator('#krList .place-card')).toHaveCount(n);
  await page.locator('[data-prog-region="busan_ulsan_gyeongnam"]').click();
  await expect(page.locator('#krList .result-meta')).toHaveAttribute('data-count',String(RECORDS.filter(r=>r.kr_region==='busan_ulsan_gyeongnam'&&r.project_type==='festival_program').length));
 });
 test('세계 미디어파사드: projects outside Korea by region and country, with the world map',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/#world');
  const world=RECORDS.filter(r=>r.country_iso2!=='KR');
  await expect(page.locator('#worldList .result-meta')).toHaveAttribute('data-count',String(world.length));
  expect(await page.locator('#worldList .place-card').evaluateAll(xs=>xs.every(x=>x.dataset.country&&x.dataset.country!=='KR'))).toBe(true);
  expect(await page.locator('.world-map .wm-dot').count()).toBeGreaterThan(5);
  await expect(page.locator('.world-map figcaption')).toHaveText('© OpenStreetMap contributors');
  await page.locator('[data-world-region="europe"]').click();
  const eu=['AT','DE','FR','NL','GB','ES','IS','CZ','RU'];
  await expect(page.locator('#worldList .result-meta')).toHaveAttribute('data-count',String(world.filter(r=>eu.includes(r.country_iso2)).length));
  await page.locator('[data-world-country="AT"]').click();
  await expect(page.locator('#worldList .result-meta')).toHaveAttribute('data-count',String(world.filter(r=>r.country_iso2==='AT').length));
  await page.locator('.world-map .wm-stage').click();
  await expect(page).toHaveURL(/#map\/world$/);
  await expect(page.locator('#view h1')).toHaveText('세계 지도');
 });
});

test('archive search: Korean results first under their heading, then the rest; a country choice lists only it',async({page})=>{
 await serveDataset(page);await serveImages(page);
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/#explore');
 const meta=page.locator('#placeResults .result-meta');
 await expect(meta).toHaveAttribute('data-count',/\d+/);
 const total=Number(await meta.getAttribute('data-count'));
 const groups=page.locator('#placeResults h2.result-group');
 await expect(groups).toHaveCount(1);
 await expect(groups.first()).toHaveAttribute('data-group','kr');
 const kr=Number((await groups.first().textContent()).replace(/\D/g,''));
 expect(kr).toBeGreaterThan(20);
 // Every card of the first page is Korean (more Korean results than one page); the rest follow with "more".
 expect(await page.locator('#placeResults .place-card').evaluateAll(xs=>xs.every(x=>x.dataset.country==='KR'))).toBe(true);
 while(await page.locator('[data-more]').count())await page.locator('[data-more]').click();
 await expect(groups).toHaveCount(2);
 await expect(groups.nth(1)).toHaveAttribute('data-group','world');
 expect(Number((await groups.nth(1).textContent()).replace(/^[^\d]*|곳.*$/g,''))).toBe(total-kr);
 const order=await page.locator('#placeResults .place-card').evaluateAll(xs=>xs.map(x=>x.dataset.country==='KR'));
 expect(order.length).toBe(total);
 expect(order.indexOf(false)).toBe(kr);
 expect(order.slice(kr).every(x=>!x)).toBe(true);
 // A keyword search: the best match leads (an exact foreign name too); Korean results lead among equally good matches.
 await page.locator('#placeSearch').fill('Ars Electronica');
 await expect(page.locator('#placeResults h3').first()).toHaveText('아르스 일렉트로니카 센터');
 await page.locator('#placeSearch').fill('media facade');
 await expect(page.locator('#placeResults .place-card').first()).toHaveAttribute('data-country','KR');
 await expect(page.locator('#placeResults h2.result-group')).toHaveCount(0);
 // A country chosen: only its places, no Korean heading.
 await page.locator('#placeSearch').fill('');
 await page.evaluate(()=>{filters.country='AT';applyFilters()});
 await expect(meta).toHaveAttribute('data-count',String(RECORDS.filter(r=>r.country_iso2==='AT').length));
 await expect(groups).toHaveCount(0);
});

test('the map opens on Korea; the world is one switch away; pins, list and count agree in both',async({page})=>{
 await serveDataset(page);await serveImages(page);await tiles(page);
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/#map');
 await expect(page.locator('#view h1')).toHaveText('국내 지도');
 await expect(page.locator('.map-scope [aria-checked=true]')).toHaveText('국내');
 const krMapped=await page.evaluate(()=>results().filter(p=>AOLCatalog.isKR(p)&&AOLCatalog.mappable(p)).length);
 expect(krMapped).toBeGreaterThan(10);
 await expect(page.locator('#mapResults .result-meta')).toHaveAttribute('data-count',String(krMapped));
 await page.locator('.map-consent [data-load-map]').click();
 await expect(page.locator('#mapCanvas.map-loaded')).toBeVisible();
 await expect.poll(()=>page.locator('#mapCanvas').getAttribute('data-total')).toBe(String(krMapped));
 // Framed on Korea.
 const c=await page.evaluate(()=>currentMap.getCenter());
 expect(c.lat).toBeGreaterThan(33);expect(c.lat).toBeLessThan(39);expect(c.lng).toBeGreaterThan(124);expect(c.lng).toBeLessThan(132);
 await page.locator('[data-map-scope="world"]').click();
 await expect(page).toHaveURL(/#map\/world$/);
 const allMapped=await page.evaluate(()=>results().filter(AOLCatalog.mappable).length);
 expect(allMapped).toBeGreaterThan(krMapped);
 await expect(page.locator('#mapResults .result-meta')).toHaveAttribute('data-count',String(allMapped));
 // The map stays loaded across the switch.
 await expect(page.locator('#mapCanvas.map-loaded')).toBeVisible();
 await expect.poll(()=>page.locator('#mapCanvas').getAttribute('data-total')).toBe(String(allMapped));
});

test.describe('place pages',()=>{
 test('a small photo leads at its own size on a dark mat, never stretched',async({page})=>{
  await serveDataset(page);await serveImages(page);
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/#place/AR-suwon-hwaseong-media-art');
  const img=page.locator('.detail-hero .detail-art.matted img');
  await expect(img).toBeVisible();
  for(const x of await widest(img))expect(x).toBeLessThanOrEqual(500);
  expect((await img.boundingBox()).width).toBeLessThanOrEqual(500);
  // A project with a large photo fills the frame.
  await page.goto('/#place/AR-coex-kpop-square-wave');
  const lead=page.locator('.detail-hero .dp-slide').first();
  await expect(lead.locator('.detail-art:not(.matted) img')).toBeVisible();
  for(const x of await widest(lead.locator('img')))expect(x).toBeGreaterThanOrEqual(960);
 });
 test('a photo that cannot load becomes the designed placeholder of the project\'s type, never a broken box',async({page})=>{
  await serveDataset(page);
  const seen=await serveImages(page,{fail:u=>/coex-kpop/.test(u)});
  await page.goto('/#place/AR-coex-kpop-square-wave');
  await expect(page.locator('.detail-hero .ph.ph-failed.ph-urban_screen').first()).toBeVisible();
  await expect(page.locator('.detail-hero .ph-failed .ph-type').first()).toHaveText('도시 대형 스크린');
  // Each photo is tried once more at a smaller size at most, then becomes the placeholder: no retry loop. (The next
  // slide and the closed 추가 자료 load lazily.)
  await expect(page.locator('#detailPhotos .dp-slide').first().locator('.ph-failed')).toHaveCount(1);
  const n=seen.length;await page.waitForTimeout(1000);expect(seen.length).toBe(n);
  expect(await page.evaluate(()=>[...document.querySelectorAll('.detail-hero img')].filter(i=>i.complete&&i.naturalWidth===0).length)).toBe(0);
  // Its gallery figures too.
  await expect(page.locator('#detailPhotos .ph-failed').first()).toBeVisible();
 });
 test('a link with the dataset id alone opens the project',async({page})=>{
  await serveDataset(page);await serveImages(page);
  await page.goto('/#place/acc-media-wall');
  await expect(page.locator('#view h1')).toHaveText('국립아시아문화전당 미디어월');
 });
 test('gallery credits name the author, licence and provider, with source links; context photos are labelled',async({page})=>{
  await serveDataset(page);await serveImages(page);
  await page.goto('/#place/AR-coex-kpop-square-wave');
  // The gallery: the project's two photos, each with author, licence, provider and the original; the context photo
  // under 추가 자료, labelled.
  await expect(page.locator('#detailPhotos .dp-slide')).toHaveCount(2);
  for(let i=0;i<2;i++){const cap=page.locator(`#detailPhotos .dp-cap[data-i="${i}"] .dp-credit`);await expect(cap).toHaveText(/^© Fixture Photographer \d · C.+ · Wikimedia Commons · 이미지 원본/);await expect(cap.locator('a.dp-orig')).toHaveAttribute('href',/commons\.wikimedia\.org\/wiki\/File:/);await expect(cap.locator('a.dp-lic')).toHaveAttribute('href',/creativecommons\.org/)}
  const extra=page.locator('#detailPhotos .dp-extra figure');
  await expect(extra).toHaveCount(1);
  await expect(extra.locator('.role-tag')).toHaveText('건축 맥락 사진');
  await expect(extra.locator('.credit-line')).toHaveText(/^© Fixture Photographer \d · C/);
  await expect(page.locator('.detail-hero .context-tag')).toHaveCount(0);
 });
});

test('a curated place with an archive record renders once its data is in, and does not re-render forever',async({page})=>{
 await serveDataset(page);await serveImages(page);
 await page.goto('/#place/SEOUL006');
 await expect(page.locator('#view h1')).toBeVisible();
 await page.waitForLoadState('networkidle');
 const v=await page.evaluate(()=>window.AOL_DATASET.version);
 await page.waitForTimeout(1000);
 expect(await page.evaluate(()=>window.AOL_DATASET.version)).toBe(v);
 expect(await page.evaluate(()=>window.AOL_DATASET.index)).toBe('ok');
});

test('내 컬렉션: saved places, courses and field notes in one place',async({page})=>{
 await serveDataset(page);await serveImages(page);
 await page.goto('/#saved');
 await expect(page.locator('#view h1')).toHaveText('내 컬렉션');
 await expect(page.locator('.saved-tabs [role=radio]')).toHaveCount(3);
 await page.locator('[data-saved-tab="records"]').click();
 await expect(page.locator('[data-saved-tab="records"]')).toHaveAttribute('aria-checked','true');
 await expect(page.locator('#view .empty h3')).toHaveText('아직 남긴 기록이 없어요');
 await expect(page.locator('#view a[href="#journal"]')).toBeVisible();
});

// The archive search's scope (한국 · 세계 · 전체): automatic until chosen, from where the visitor came or the query; the
// counts of each scope; a widened scope and a guessed word are said in words; the map keeps its own switch.
test.describe('search scope and forgiving search',()=>{
 const meta=page=>page.locator('#placeResults .result-meta');
 const radio=(page,k)=>page.locator(`.search-scope [data-scope-set="${k}"]`);
 const countOf=async(page,k)=>Number((await radio(page,k).locator('.chip-count').innerText()).replace(/\D/g,''));
 test('from a Korea page the scope is 한국; from the world page 세계; a chosen scope stays while typing',async({page})=>{
  await serveDataset(page);await serveImages(page);await page.setViewportSize({width:1440,height:900});
  await page.goto('/#korea');await expect(page.locator('#view h1')).toHaveText('국내 미디어파사드');
  await page.locator('#navigation a[href="#explore"]').click();
  await expect(radio(page,'korea')).toHaveAttribute('aria-checked','true');
  await expect.poll(()=>page.evaluate(()=>window.AOL_DATASET.index)).toBe('ok');
  const kr=await countOf(page,'korea'),world=await countOf(page,'world');
  expect(kr).toBeGreaterThan(0);expect(world).toBeGreaterThan(0);
  expect(await countOf(page,'all')).toBe(kr+world);
  await expect(meta(page)).toHaveAttribute('data-count',String(kr));
  await expect(page.locator('#placeResults .place-card[data-country]:not([data-country="KR"])')).toHaveCount(0);
  // The world page.
  await page.locator('#navigation a[href="#world"]').click();await page.locator('#navigation a[href="#explore"]').click();
  await expect(radio(page,'world')).toHaveAttribute('aria-checked','true');
  await expect(meta(page)).toHaveAttribute('data-count',String(world));
  // Chosen: 전체, and it stays while typing a Korean query.
  await radio(page,'all').click();
  await expect(meta(page)).toHaveAttribute('data-count',String(kr+world));
  await page.locator('#placeSearch').fill('빛');
  await expect(radio(page,'all')).toHaveAttribute('aria-checked','true');
  // The keyboard moves between scopes.
  await radio(page,'all').focus();await page.keyboard.press('ArrowLeft');
  await expect(radio(page,'world')).toHaveAttribute('aria-checked','true');
  await expect(radio(page,'world')).toBeFocused();
 });
 test('without a page to go by, a Hangul query searches 한국 and a Latin one 전체; nothing in 한국 widens to 전체 and says so',async({page})=>{
  await serveDataset(page);await serveImages(page);
  await page.goto('/#explore');await expect.poll(()=>page.evaluate(()=>window.AOL_DATASET.index)).toBe('ok');
  await expect(radio(page,'all')).toHaveAttribute('aria-checked','true');
  await page.locator('#placeSearch').fill('서울');
  await expect(radio(page,'korea')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#placeResults .place-card').first()).toHaveAttribute('data-country','KR');
  await page.locator('#placeSearch').fill('Seoul');
  await expect(radio(page,'all')).toHaveAttribute('aria-checked','true');
  // A Korean name of a foreign project: nothing in 한국, so 전체, with a note.
  await page.locator('#placeSearch').fill('아르스 일렉트로니카');
  await expect(radio(page,'all')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#placeResults .search-note')).toContainText('한국에는 결과가 없어 전체에서 찾았어요');
  await expect(page.locator('#placeResults h3').first()).toHaveText('아르스 일렉트로니카 센터');
 });
 test('a slip of one letter still finds the project and the page says which word it used',async({page})=>{
  await serveDataset(page);await serveImages(page);
  await page.goto('/#explore');await expect.poll(()=>page.evaluate(()=>window.AOL_DATASET.index)).toBe('ok');
  await page.locator('#placeSearch').fill('Electornica');
  await expect(page.locator('#placeResults h3').first()).toHaveText('아르스 일렉트로니카 센터');
  await expect(page.locator('#placeResults .search-note')).toContainText('비슷한 ‘electronica’');
  // Spaces and a syllable being typed.
  await page.locator('#placeSearch').fill('서울스퀘어미디어');
  await expect(page.locator('#placeResults h3').first()).toHaveText('서울스퀘어 미디어 캔버스');
  await page.locator('#placeSearch').fill('갤러리아 센터시');
  await expect(page.locator('#placeResults h3').first()).toHaveText('갤러리아 센터시티');
  await expect(page.locator('#placeResults .search-note')).toHaveCount(0);
 });
 test('the map keeps its own Korea/world switch whatever the search scope',async({page})=>{
  await serveDataset(page);await serveImages(page);await tiles(page);
  const allMapped=RECORDS.filter(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lng)).length;
  await page.goto('/#korea');await page.goto('/#explore');
  await expect(radio(page,'korea')).toHaveAttribute('aria-checked','true');
  await page.goto('/#map/world');
  await expect(page.locator('#mapResults .result-meta')).toHaveAttribute('data-count',String(allMapped));
 });
});

// 시·군·구 inside a Korean region: chips from the places' own city and district with counts that add up to the region
// (places without one count under 위치 미상); an empty region says so and links to the search.
test.describe('Korean region drill-down',()=>{
 const meta=page=>page.locator('#krList .result-meta');
 const chipCounts=loc=>loc.evaluateAll(xs=>xs.map(x=>[x.firstChild.textContent.trim(),Number(x.querySelector('.chip-count').textContent.replace(/\D/g,''))]));
 test('cities, then the districts of a city; the counts add up and the list follows',async({page})=>{
  await serveDataset(page);await serveImages(page);
  await page.goto('/#korea/busan_ulsan_gyeongnam');
  await expect(meta(page)).toHaveAttribute('data-count','3');
  const rows=page.locator('#krList .area-chips');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('aria-label','시·군');
  expect(await chipCounts(rows.first().locator('button'))).toEqual([['전체',3],['부산',2],['진주시',1]]);
  await rows.first().getByRole('button',{name:/^부산/}).click();
  await expect(meta(page)).toHaveAttribute('data-count','2');
  await expect(page.locator('#krList h2')).toHaveText('부산·울산·경남 부산');
  await expect(rows).toHaveCount(2);
  expect(await chipCounts(rows.nth(1).locator('button'))).toEqual([['전체',2],['수영구',1],['해운대구',1]]);
  await rows.nth(1).getByRole('button',{name:/^해운대구/}).click();
  await expect(meta(page)).toHaveAttribute('data-count','1');
  await expect(page.locator('#krList .place-card h3')).toHaveText(['해운대 빛축제']);
  await expect(rows.nth(1).getByRole('button',{name:/^해운대구/})).toHaveAttribute('aria-pressed','true');
  // Another region starts over.
  await page.goto('/#korea/seoul');
  await expect(page.locator('#krList .area-chips button[aria-pressed="true"]')).toHaveText(/^전체/);
 });
 test('a region in one city goes straight to its districts; places without one are 위치 미상, never guessed',async({page})=>{
  await serveDataset(page);await serveImages(page);
  await page.goto('/#korea/seoul');
  const row=page.locator('#krList .area-chips');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('aria-label','구·군');
  const total=Number(await meta(page).getAttribute('data-count')),chips=await chipCounts(row.locator('button'));
  expect(chips[0]).toEqual(['전체',total]);
  expect(chips.slice(1).reduce((a,c)=>a+c[1],0)).toBe(total);
  expect(chips.map(c=>c[0])).toEqual(expect.arrayContaining(['중구','송파구','강남구','위치 미상']));
  expect(chips[chips.length-1][0]).toBe('위치 미상');
  await row.getByRole('button',{name:/^위치 미상/}).click();
  await expect(meta(page)).toHaveAttribute('data-count',String(chips.find(c=>c[0]==='위치 미상')[1]));
 });
 test('a region without projects says so, shows no counts to choose from, and links to the search',async({page})=>{
  await serveDataset(page,filesOf(siteData(RECORDS.filter(r=>r.kr_region!=='gangwon'))));await serveImages(page);
  await page.goto('/#korea/gangwon');
  await expect(meta(page)).toHaveAttribute('data-count','0');
  await expect(page.locator('#krList .area-chips')).toHaveCount(0);
  await expect(page.locator('#krList .empty')).toContainText('강원에는 아직 수록된 프로젝트가 없어요');
  await expect(page.locator('#krList .empty a[href="#explore"]')).toHaveText('아카이브 검색에서 찾기');
  await expect(page.locator('a.region-link[href="#korea/gangwon"] .region-count')).toHaveText('0개 프로젝트');
 });
});

// AVIF/WebP only where the provider serves them (Unsplash's fm parameter); Commons keeps its JPEG srcset.
test.describe('image formats',()=>{
 const U='https://images.unsplash.com/photo-1500000000000-fixture?ixid=fixture',PNG1=readFileSync(new URL('./fixtures/images/art-1.jpg',import.meta.url));
 const unsplash=RECORDS.map(r=>r.id!=='acc-media-wall'?r:{...r,images:r.images.map((m,i)=>({...m,provider:'unsplash',src:U+i,page:'https://unsplash.com/photos/fixture'+i,thumb:U+i+'&w=640',display:[[640,U+i+'&w=640'],[1280,U+i+'&w=1280'],[1920,U+i+'&w=1920']],width:4000,height:2667,license:'Unsplash License',license_url:'https://unsplash.com/license'}))});
 const FILES=filesOf(siteData(unsplash));
 test('an Unsplash photo comes as AVIF or WebP through <picture>; a Commons photo stays a plain srcset',async({page})=>{
  await serveDataset(page,FILES);await serveImages(page);
  const asked=[];await page.route(/^https:\/\/images\.unsplash\.com\//,r=>{asked.push(r.request().url());return r.fulfill({contentType:'image/jpeg',body:PNG1})});
  await page.goto('/#place/acc-media-wall');
  const pic=page.locator('.detail-hero .dp-slide').first().locator('picture');
  await expect(pic).toHaveCount(1);
  await expect(pic.locator('source')).toHaveCount(2);
  expect(await pic.locator('source').evaluateAll(xs=>xs.map(x=>x.type))).toEqual(['image/avif','image/webp']);
  expect(await pic.locator('source[type="image/avif"]').getAttribute('srcset')).toMatch(/fm=avif.* 640w, .*fm=avif.* 1280w/);
  await expect.poll(()=>pic.locator('img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every(u=>/[?&]fm=(avif|webp)/.test(u)),'only the format the browser takes').toBe(true);
  // The card on the region page uses the same rule; the Commons project next to it does not.
  await page.goto('/#place/coex-kpop-square-wave');
  await expect(page.locator('#view h1')).toBeVisible();
  await expect(page.locator('#view picture')).toHaveCount(0);
 });
 test('an Unsplash photo that fails becomes the placeholder, <picture> and all',async({page})=>{
  await serveDataset(page,FILES);await serveImages(page);
  await page.route(/^https:\/\/images\.unsplash\.com\//,r=>r.fulfill({status:404,body:''}));
  await page.goto('/#place/acc-media-wall');
  const first=page.locator('.detail-hero .dp-slide').first();
  await expect(first.locator('.ph-failed')).toBeVisible();
  await expect(first.locator('picture')).toHaveCount(0);
 });
});

// The place page of the fifth brief, on its regression case SEOUL006 (DDP / 서울라이트): the gallery shows only the
// project's own photos; architecture waits behind 추가 자료; the creator's portrait only with the credits; an unverified
// photo never. The slider, the enlarged view, the tabs (scroll and project kept, deep links) and reports.
test.describe('place page (SEOUL006 regression)',()=>{
 test.beforeEach(async({page})=>{await serveDataset(page);await serveImages(page);await tiles(page)});
 const slides=page=>page.locator('#detailPhotos .dp-slide');
 test('only the project\'s own photos in the gallery; context behind 추가 자료; the portrait with the credits; never the unverified one',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/#place/SEOUL006');
  await expect(page.locator('#view h1')).toContainText('동대문디자인플라자');
  await expect(slides(page)).toHaveCount(3);
  expect(await slides(page).locator('img').evaluateAll(xs=>xs.map(x=>(/_(hero|night|art|day|scene)_\d/.exec(x.getAttribute('src'))||[])[1]))).toEqual(['hero','night','art']);
  await expect(page.locator('#detailPhotos .dp-extra > summary')).toHaveText('추가 자료 보기 (1)');
  await expect(page.locator('#detailPhotos .dp-extra img')).toHaveAttribute('src',/_day_4/);
  // The portrait: in 작품·전시, marked as a creator's portrait; nowhere else.
  await expect(page.locator('#dp-panel-art [data-creator-portrait] img')).toHaveAttribute('src',/_scene_5/);
  expect(await page.locator('#view img[src*="_scene_5"]').count()).toBe(1);
  await expect(page.locator('#dp-panel-art .dp-people')).toContainText('Fixture Artist');
  // The unverified photo is never on the page.
  await expect(page.locator('#view img[src*="_night_6"]')).toHaveCount(0);
  await expect(page.locator('#view')).not.toContainText('An unrelated person');
 });
 test('the slider: buttons, thumbnails, swipe and keys move one photo; the counter, caption and credit follow',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/#place/SEOUL006');
  const count=page.locator('#detailPhotos .dp-count'),cap=i=>page.locator(`#detailPhotos .dp-cap[data-i="${i}"]`);
  await expect(count).toHaveText('1 / 3');
  await expect(page.locator('#detailPhotos [data-dp-step="-1"]')).toBeDisabled();
  await expect(cap(0)).toBeVisible();await expect(cap(1)).toBeHidden();
  await expect(cap(0).locator('.dp-credit')).toContainText(/© Fixture Photographer 1 · CC BY-SA 4\.0 · Wikimedia Commons · 이미지 원본/);
  await page.locator('#detailPhotos [data-dp-step="1"]').click();
  await expect(count).toHaveText('2 / 3');await expect(cap(1)).toBeVisible();await expect(cap(0)).toBeHidden();
  await expect(page.locator('#detailPhotos .dp-thumb[aria-current="true"]')).toHaveAttribute('data-dp-go','1');
  await page.locator('#detailPhotos .dp-thumb[data-dp-go="2"]').click();
  await expect(count).toHaveText('3 / 3');await expect(page.locator('#detailPhotos [data-dp-step="1"]')).toBeDisabled();
  // Keys when the gallery has the focus.
  await page.locator('#dpTrack').focus();await page.keyboard.press('ArrowLeft');
  await expect(count).toHaveText('2 / 3');
  await expect(page.locator('#detailPhotos .dp-live')).toHaveText('2 / 3');
  // A swipe is a scroll of the track: the counter follows.
  await page.locator('#dpTrack').evaluate(t=>t.scrollTo({left:0}));
  await expect(count).toHaveText('1 / 3');
  // Off-screen photos are out of the reading and tab order.
  expect(await slides(page).evaluateAll(xs=>xs.map(x=>x.getAttribute('aria-hidden')))).toEqual(['false','true','true']);
  // The page reserves the frame: the stage keeps its height while photos load.
  const h=(await page.locator('#detailPhotos .dp-stage').boundingBox()).height;expect(h).toBeGreaterThan(300);
 });
 test('the enlarged view: arrows, Esc, and the focus back on the button',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/#place/SEOUL006');
  const zoom=page.locator('#detailPhotos [data-dp-zoom]');
  await zoom.click();
  const box=page.locator('#dpLightbox');
  await expect(box).toBeVisible();await expect(box.locator('.dp-lb-bar')).toContainText('1 / 3');
  await expect(box.locator('.dp-credit')).toContainText('Fixture Photographer 1');
  await page.keyboard.press('ArrowRight');
  await expect(box.locator('.dp-lb-bar')).toContainText('2 / 3');
  await expect(page.locator('#detailPhotos .dp-count')).toHaveText('2 / 3');
  await page.keyboard.press('Escape');
  await expect(box).toBeHidden();
  await expect(zoom).toBeFocused();
 });
 test('wide screens: gallery left, title right; phones: one column with the counter and a folding caption',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/#place/SEOUL006');
  // (Measured as a block: the page renders again when the project's record arrives.)
  await expect(slides(page)).toHaveCount(3);
  await expect(async()=>{const g=await page.locator('#detailPhotos .dp-stage').boundingBox(),title=await page.locator('.dp-title').boundingBox();
   expect(title.x).toBeGreaterThan(g.x+g.width-1);expect(Math.abs(title.y-g.y)).toBeLessThan(40)}).toPass({timeout:5000});
  await expect(page.locator('#detailPhotos .dp-thumbs')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#place/SEOUL001');await page.goto('/#place/SEOUL006');
  await expect(slides(page)).toHaveCount(3);
  await expect(async()=>{const g2=await page.locator('#detailPhotos .dp-stage').boundingBox(),t2=await page.locator('.dp-title').boundingBox();
   expect(t2.y).toBeGreaterThan(g2.y+g2.height-1);expect(Math.round(g2.width)).toBe(390)}).toPass({timeout:5000});
  await expect(page.locator('#detailPhotos .dp-thumbs')).toBeHidden();
  await expect(page.locator('#detailPhotos .dp-count')).toBeVisible();
  await expect(page.locator('#detailPhotos .dp-back')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0);
 });
 test('tabs change the panel, keep the project and the reading position, and are deep links; old links still open',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/#place/SEOUL006');
  await expect(slides(page)).toHaveCount(3);await page.waitForLoadState('networkidle');
  const tabs=page.locator('.dp-tabs [role=tab]');
  await expect(tabs).toHaveText(['개요','건축·미디어 기술','작품·전시','위치·관람','자료·출처']);
  await page.locator('.dp-tabs').scrollIntoViewIfNeeded();await page.evaluate(()=>window.scrollBy(0,-120));
  const y=await page.evaluate(()=>scrollY);
  await page.getByRole('tab',{name:'건축·미디어 기술'}).click();
  await expect(page.locator('#dp-panel-architecture')).toBeVisible();await expect(page.locator('#dp-panel-overview')).toBeHidden();
  expect(Math.abs(await page.evaluate(()=>scrollY)-y)).toBeLessThan(3);
  await expect(page).toHaveURL(/#place\/SEOUL006\/architecture$/);
  await expect(page.locator('#view h1')).toContainText('동대문디자인플라자');
  // Every panel stays in the page (hidden), so readers and crawlers have it.
  await expect(page.locator('.dp-panel')).toHaveCount(5);
  await expect(page.locator('#dp-panel-sources #citationText')).toHaveCount(1);
  // Keys: arrows move between tabs.
  await page.getByRole('tab',{name:'건축·미디어 기술'}).focus();await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'작품·전시'})).toHaveAttribute('aria-selected','true');
  await expect(page).toHaveURL(/#place\/SEOUL006\/art$/);
  // A deep link opens its tab; the old link opens 개요; the bare dataset id and the app id open the same project.
  await page.goto('/#place/SEOUL006/visit');await page.reload();
  await expect(page.getByRole('tab',{name:'위치·관람'})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#detailMap')).toBeVisible();
  for(const h of ['#place/SEOUL006','#place/AR-SEOUL006']){await page.goto('/'+h);await expect(page.locator('#view h1')).toContainText('동대문디자인플라자');await expect(page.getByRole('tab',{name:'개요'})).toHaveAttribute('aria-selected','true')}
  // The location button opens 위치·관람 at the map.
  await page.locator('.dp-actions [data-dp-tab="visit"]').click();
  await expect(page.locator('#detailMap')).toBeInViewport();
 });
 test('fields: only sourced facts; missing ones grouped as 자료 없음; the editors\' note is marked with its source',async({page})=>{
  await page.goto('/#place/SEOUL006');
  await expect(page.locator('#dp-panel-overview .kv',{hasText:'공식명'})).toContainText('동대문디자인플라자');
  await expect(page.locator('#dp-panel-overview .dp-editorial')).toContainText('편집 해설');
  await expect(page.locator('#dp-panel-overview .dp-editorial-src a').first()).toHaveAttribute('href',/^https:\/\//);
  const missing=page.locator('#dp-panel-architecture .dp-missing');
  await expect(missing.first()).toContainText('자료 없음');
  await expect(missing.first()).toContainText('미디어 설치 위치');
  // One line per group, not a row per empty field.
  expect(await page.locator('#dp-panel-architecture .kv dd').evaluateAll(xs=>xs.filter(x=>/자료 없음/.test(x.textContent)).length)).toBe(0);
  await expect(page.locator('#dp-panel-architecture .kv',{hasText:'운영기관'})).toContainText('서울디자인재단');
 });
 test('reports: per photo and per page; without a server, a prefilled GitHub issue and e-mail; review first',async({page})=>{
  await page.goto('/#place/SEOUL006');
  await page.locator('#detailPhotos .dp-cap[data-i="0"] [data-report]').click();
  const dlg=page.locator('#modal');
  await expect(dlg).toContainText('사진 신고');
  await expect(dlg.locator('input[name=reason]')).toHaveCount(6);
  await expect(dlg).toContainText('편집팀이 검토한 뒤 반영해요');
  await dlg.getByText('인물 사진이 잘못 연결됨').click();
  await dlg.locator('textarea').fill('사람 사진이에요');
  const issue=new URL(await dlg.locator('#reportIssue').getAttribute('href'));
  expect(issue.origin+issue.pathname).toBe('https://github.com/remona8787/remona8787.github.io/issues/new');
  expect(issue.searchParams.get('labels')).toBe('report,image');
  expect(issue.searchParams.get('title')).toContain('인물 사진이 잘못 연결됨');
  expect(issue.searchParams.get('body')).toContain('사람 사진이에요');
  expect(await dlg.locator('#reportMail').getAttribute('href')).toMatch(/^mailto:remona56@hanmail\.net\?subject=/);
  await dlg.locator('[data-close]').click();
  await page.locator('.dp-report-page').click();
  await expect(dlg).toContainText('정보 오류 신고');
 });
});

// Status (fifth brief): a record's status only with its source; a facility never reads 종료 because one edition of a
// programme ended (SEOUL006: DDP is the facility, Seoul Light the event).
test.describe('status',()=>{
 test('a facility whose programme ended is not 종료; a sourced festival is 진행 중 with its source; an unsourced status is not shown',async({page})=>{
  const recs=RECORDS.map(r=>r.id==='gwangju-media-art-festival'?{...r,kind:'festival',status:'running',status_source:'tourapi',start_date:'2026-10-01',end_date:'2026-11-30',events:[{id:'SEV-0000001A',kind:'event',title:'광주미디어아트페스티벌 2026',status:'running',start:'2026-10-01',end:'2026-11-30',url:'https://example.org/gmaf',source:{license:'공공누리 1유형',url:'https://www.data.go.kr/data/15101578/openapi.do',title:'한국관광공사 TourAPI'}}]}:r.id==='jinju-namgang-yudeung'?{...r,kind:'festival',status:'ended'}:r);
  await serveDataset(page,filesOf(siteData(recs)));await serveImages(page);
  await page.goto('/#place/SEOUL006');
  await expect(page.locator('#view h1')).toContainText('동대문디자인플라자');
  await expect(page.locator('.dp-title .detail-pills')).not.toContainText('종료');
  await page.goto('/#place/gwangju-media-art-festival');
  await expect(page.locator('.dp-title .detail-pills')).toContainText('진행 중');
  await expect(page.locator('#dp-panel-overview .kv',{hasText:'운영 상태'})).toContainText('출처 한국관광공사 TourAPI');
  await expect(page.locator('#dp-panel-art .dp-events li').first()).toContainText('광주미디어아트페스티벌 2026');
  await expect(page.locator('#dp-panel-art .dp-events li').first()).toContainText('2026-10-01 – 2026-11-30');
  await expect(page.locator('#dp-panel-art .dp-events li').first()).toContainText('공공누리 1유형');
  await page.goto('/#place/jinju-namgang-yudeung');
  await expect(page.locator('#view h1')).toBeVisible();
  await expect(page.locator('.dp-title .detail-pills')).not.toContainText('종료');
  // The cards follow the same rule.
  await page.goto('/#korea/seoul');
  await expect(page.locator('#krList .place-card',{hasText:'동대문디자인플라자'}).locator('.card-badge')).toHaveCount(0);
 });
});

// Live review of SEOUL006 (fifth brief): controls inside the frame on phones, a panorama without empty bands, and a
// credit that does not repeat the author as the rights holder.
test.describe('place page polish',()=>{
 for(const w of [390,430])test(`phone ${w}: the gallery bleeds to the edges and every control sits 12 px inside it`,async({page})=>{
  await page.setViewportSize({width:w,height:844});await serveDataset(page);await serveImages(page);
  await page.goto('/#place/SEOUL006');await expect(page.locator('#detailPhotos .dp-slide')).toHaveCount(3);
  const r=await page.evaluate(()=>{const st=document.querySelector('.dp-stage').getBoundingClientRect(),y=st.top+st.height/2;return {edges:[4,innerWidth-4].map(x=>document.elementsFromPoint(x,y).some(e=>e.classList?.contains('dp-stage'))),controls:[...document.querySelectorAll('.dp-stage button')].filter(b=>b.offsetParent&&!b.hidden&&getComputedStyle(b).opacity!=='0').map(b=>{const q=b.getBoundingClientRect();return [Math.round(q.left),Math.round(innerWidth-q.right)]})}});
  expect(r.edges).toEqual([true,true]);
  expect(r.controls.length).toBeGreaterThanOrEqual(3);
  for(const [l,rt] of r.controls){expect(l).toBeGreaterThanOrEqual(12);expect(rt).toBeGreaterThanOrEqual(12)}
 });
 test('a panorama keeps its whole picture and fills the bands with its own blurred image; a 4:3 photo has none',async({page})=>{
  const pano=readFileSync(new URL('./fixtures/images/pano-1.jpg',import.meta.url));
  const recs=RECORDS.map(r=>r.id==='SEOUL006'?{...r,images:r.images.map((m,i)=>i?m:{...m,width:3600,height:1200})}:r);
  await serveDataset(page,filesOf(siteData(recs)));await serveImages(page);
  await page.route(/Fixture_SEOUL006_hero_1\.jpg/,r=>r.fulfill({contentType:'image/jpeg',body:pano}));
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/#place/SEOUL006');
  const first=page.locator('#detailPhotos .dp-slide').first().locator('.dp-frame');
  await expect(first).toHaveClass(/has-backdrop/);
  expect(await first.locator('img').evaluate(i=>[getComputedStyle(i).objectFit,i.naturalWidth/i.naturalHeight])).toEqual(['contain',3]);
  await expect(page.locator('#detailPhotos .dp-slide').nth(1).locator('.dp-frame')).not.toHaveClass(/has-backdrop/);
 });
 test('the credit names the rights holder only when it is not the author',async({page})=>{
  const recs=RECORDS.map(r=>r.id==='SEOUL006'?{...r,images:r.images.map((m,i)=>i===0?{...m,rights_holder:m.author}:i===1?{...m,rights_holder:'Seoul Design Foundation'}:m)}:r);
  await serveDataset(page,filesOf(siteData(recs)));await serveImages(page);
  await page.goto('/#place/SEOUL006');await expect(page.locator('#detailPhotos .dp-slide')).toHaveCount(3);
  await expect(page.locator('#detailPhotos .dp-cap[data-i="0"] .dp-credit')).not.toContainText('권리자');
  await expect(page.locator('#detailPhotos .dp-cap[data-i="1"] .dp-credit')).toContainText('권리자 Seoul Design Foundation');
 });
});
