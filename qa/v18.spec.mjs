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
  await expect(page.locator('.detail-hero .detail-art:not(.matted) img')).toBeVisible();
  for(const x of await widest(page.locator('.detail-hero img')))expect(x).toBeGreaterThanOrEqual(960);
 });
 test('a photo that cannot load becomes the designed placeholder of the project\'s type, never a broken box',async({page})=>{
  await serveDataset(page);
  const seen=await serveImages(page,{fail:u=>/coex-kpop/.test(u)});
  await page.goto('/#place/AR-coex-kpop-square-wave');
  await expect(page.locator('.detail-hero .ph.ph-failed.ph-urban_screen')).toBeVisible();
  await expect(page.locator('.detail-hero .ph-failed .ph-type')).toHaveText('도시 대형 스크린');
  // Each photo is tried once more at a smaller size at most, then becomes the placeholder: no retry loop.
  await expect(page.locator('#detailPhotos .ph-failed')).toHaveCount(3);
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
  const figs=page.locator('#detailPhotos .image-gallery > figure');
  await expect(figs).toHaveCount(3);
  await expect(figs.last().locator('.role-tag')).toHaveText('건축 맥락 사진');
  for(let i=0;i<3;i++){await expect(figs.nth(i).locator('.credit-line')).toHaveText(/^© Fixture Photographer \d · C/);await expect(figs.nth(i).locator('.credit-source')).toHaveText('출처 Wikimedia Commons');await expect(figs.nth(i).locator('.figure-links a').first()).toHaveAttribute('href',/commons\.wikimedia\.org\/wiki\/File:/)}
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
  const pic=page.locator('.detail-hero picture');
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
  await expect(page.locator('.detail-hero .ph-failed')).toBeVisible();
  await expect(page.locator('.detail-hero picture')).toHaveCount(0);
 });
});
