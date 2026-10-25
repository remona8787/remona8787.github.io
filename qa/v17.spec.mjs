// The v0.17 consumer screens on the static archive dataset (qa/fixtures/site-data, served at /data/ with synthetic
// images): the museum home and its hero, the generative LED graphic, lazy loading of the dataset files, the gallery
// order by image role, designed placeholders, the public-copy guard in Korean and English, and layout at every width.
// v0.18: the home tests read a home.json of the v0.17 shape (the live dataset's), which the app regroups Korea first;
// qa/v18.spec.mjs covers the v0.18 sections.
import {test,expect} from './fixtures.mjs';
import AxeBuilder from '@axe-core/playwright';
import {serveDataset,serveImages,noDataset,filesOf,FIXTURE} from './fixtures/site-data-routes.mjs';
import {siteData,RECORDS} from './fixtures/site-data-projects.mjs';

const HOME=FIXTURE['home.json'],V17=filesOf(siteData(RECORDS,{home:'v17'})),HOME17=V17['home.json'];
// Hero slides of a v0.17 home.json: its tier-1 photos of Korean projects (Korea first, v0.18).
const HERO=HOME17.hero.filter(h=>h.image?.tier===1&&HOME17.projects[h.project]?.country_iso2==='KR');
const tiles=page=>page.route(/^https:\/\/([abc]\.)?tile\.openstreetmap\.org\//,r=>r.fulfill({status:204,body:''}));
const pixels=page=>page.locator('canvas[data-led="hero"]').evaluate(c=>c.toDataURL());

test.describe('home',()=>{
 test('hero slides are real projects with their media running, credited, linked to their page',async({page})=>{
  await serveDataset(page,V17);await serveImages(page);
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/#home');
  const slides=page.locator('.hero .hero-slide');
  await expect(slides).toHaveCount(HERO.length);
  expect(HERO.length).toBeGreaterThan(1);
  for(let i=0;i<HERO.length;i++){
   const s=slides.nth(i),h=HERO[i],p=HOME17.projects[h.project];
   await expect(s.locator('.plate-title')).toHaveAttribute('href','#place/AR-'+h.project);
   await expect(s.locator('.plate-title')).toContainText(p.name_ko);
   await expect(s.locator('.plate-credit')).toHaveText(new RegExp(`© ${h.image.author} · ${h.image.license.replace(/[.]/g,'\\.')}`));
   await expect(s.locator('.plate-credit')).toHaveAttribute('href',h.image.page);
   expect(await s.locator('img').getAttribute('src')).toContain('_hero_');
  }
  // The first slide is the page's largest image: loaded eagerly with priority, the rest lazily, all with a srcset.
  await expect(slides.first().locator('img')).toHaveAttribute('fetchpriority','high');
  await expect(slides.nth(1).locator('img')).toHaveAttribute('loading','lazy');
  await expect.poll(()=>slides.first().locator('img').evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
  expect(await slides.first().locator('img').getAttribute('srcset')).toMatch(/ 1920w/);
  // The carousel moves with its buttons and stays on real projects.
  await page.locator('[data-hero-step="1"]').click();
  await expect.poll(()=>page.locator('#heroTrack').evaluate(e=>Math.round(e.scrollLeft/e.clientWidth))).toBe(1);
  // No image without media-active evidence anywhere on the home page (no daytime context photo, no unrelated photo).
  const srcs=await page.locator('#view img[data-place-photo]').evaluateAll(xs=>xs.map(x=>x.getAttribute('src')));
  expect(srcs.length).toBeGreaterThan(8);
  for(const src of srcs)expect(src,'home image').toMatch(/_(hero|night|art|led|scene|small)_\d/);
  // Sections (v0.18, Korea first): Korean regions, featured, programmes, then the world; counts of a v0.17 home.json.
  for(const h of ['지역으로 만나는 한국의 빛','세계의 미디어파사드'])await expect(page.locator('.home-section h2',{hasText:h})).toHaveCount(1);
  expect(await page.locator('.home-featured .place-card, .home-programs .place-card').count(),'Korean projects of home.json in the Korean sections').toBeGreaterThan(0);
  await expect(page.locator('.home-kr-regions .kr-tile')).toHaveCount(8);
  await expect(page.locator('.hero-stats')).toHaveText(`프로젝트 ${HOME17.counts.projects}개 · ${HOME17.counts.countries}개 나라`);
  // A region opens its page.
  await page.locator('.home-kr-regions a[href="#korea/seoul"]').click();
  await expect(page).toHaveURL(/#korea\/seoul$/);
  await expect(page.locator('#view h1')).toHaveText('서울');
 });

 test('without hero data the hero is the generative LED graphic, which says it is a graphic',async({page})=>{
  // A dataset whose home.json has no reviewed hero slide, and a host without any dataset.
  const files={...FIXTURE,'home.json':{...HOME,hero:[]}};
  await serveDataset(page,files);await serveImages(page);
  await page.goto('/#home');
  await expect(page.locator('.hero-generative canvas.led-canvas[data-led="hero"]')).toHaveCount(1);
  await expect(page.locator('.hero-generative .hero-graphic-note')).toHaveText('빛의 건축 그래픽 · 실제 프로젝트 사진이 아니에요');
  await expect(page.locator('.hero-slide')).toHaveCount(0);
  await expect(page.locator('.home-featured .place-card').first()).toBeVisible();
  const p2=await page.context().newPage();await noDataset(p2);
  await p2.goto('/#home');
  await expect(p2.locator('.hero-generative canvas.led-canvas')).toHaveCount(1);
  await expect(p2.locator('.hero-title')).toHaveText('빛으로 읽는 한국의 건축');
  await expect(p2.locator('#view img[data-place-photo]')).toHaveCount(0);
 });

 test('the LED graphic animates on screen, pauses off screen and stays still under reduced motion',async({page})=>{
  await noDataset(page);
  await page.setViewportSize({width:1280,height:800});
  await page.goto('/#home');
  const canvas=page.locator('canvas[data-led="hero"]');
  await expect(canvas).toBeVisible();
  // Painted (never blank), and moving while visible.
  expect(await canvas.evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n})).toBeGreaterThan(1000);
  const a=await pixels(page);await page.waitForTimeout(400);expect(await pixels(page)).not.toBe(a);
  // Off screen: no frames.
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(300);
  const b=await pixels(page);await page.waitForTimeout(500);expect(await pixels(page)).toBe(b);
  // Reduced motion: one still frame.
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(300);
  const c=await pixels(page);await page.waitForTimeout(500);expect(await pixels(page)).toBe(c);
 });
});

test('the home page reads only home.json; explore and map read the index; a project page reads its shard',async({page})=>{
 const seen=await serveDataset(page);await serveImages(page);
 await page.goto('/#home');
 await expect(page.locator('.hero-slide').first()).toBeVisible();
 await page.waitForLoadState('networkidle');
 expect(seen,'first paint of the home page').toEqual(['home.json']);
 // A project from the home page: its shard only (home.json names it), no index.
 const first=HERO[0].project,shard=siteData(RECORDS).index.rows.find(r=>r[0]===first)[12];
 await page.locator('.hero-slide .plate-title').first().click();
 await expect(page.locator('#view h1')).toContainText(HOME.projects[first].name_ko);
 await expect(page.locator('#detailPhotos figure').first()).toBeVisible();
 expect(seen).toContain(`projects/${shard}.json`);
 // Explore: the index, once.
 await page.locator('#navigation a[href="#explore"]').click();
 await expect(page.locator('#placeResults .result-meta')).toHaveAttribute('data-count',/\d+/);
 await page.locator('#navigation a[href="#map"]').click();
 await expect(page.locator('#mapResults .result-meta')).toHaveAttribute('data-count',/\d+/);
 expect(seen.filter(f=>f==='index.json')).toEqual(['index.json']);
});

test('a link straight to a project page reads the manifest and that project\'s shard, not the whole index first',async({page})=>{
 const seen=await serveDataset(page);await serveImages(page);
 const id='harpa-reykjavik',shard=siteData(RECORDS).index.rows.find(r=>r[0]===id)[12];
 await page.goto('/#place/AR-'+id);
 await expect(page.locator('#view h1')).toHaveText('하르파 콘서트홀 파사드');
 await expect(page.locator('#detailPhotos figure').first()).toBeVisible();
 expect(seen.slice(0,2)).toEqual(['manifest.json',`projects/${shard}.json`]);
});

test.describe('place pages',()=>{
 test.beforeEach(async({page})=>{await serveDataset(page);await serveImages(page);await tiles(page)});
 test('the gallery puts media-active images first, then videos, then architectural context, each credited',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/#place/AR-ars-electronica-center');
  const figs=page.locator('#detailPhotos .image-gallery > figure');
  await expect(figs).toHaveCount(4);
  expect(await figs.evaluateAll(fs=>fs.map(f=>f.classList.contains('video-figure')?'video':f.dataset.tier))).toEqual(['1','2','video','4']);
  await expect(figs.nth(3).locator('.role-tag')).toHaveText('건축 맥락 사진');
  for(let i=0;i<4;i++)await expect(figs.nth(i).locator('.credit-line')).toHaveText(/^© .+ · CC/);
  await expect(page.locator('#detailPhotos .section-note').first()).toContainText('건축 맥락 사진은');
  // The hero image is the media-active one, not labelled as context; the video is muted, with controls, not preloaded.
  await expect(page.locator('.detail-hero img')).toHaveAttribute('src',/_hero_1/);
  await expect(page.locator('.detail-hero .context-tag')).toHaveCount(0);
  const video=page.locator('#detailPhotos video');
  if(await video.count()){await expect(video).toHaveAttribute('preload','none');expect(await video.evaluate(v=>v.muted&&v.controls)).toBe(true)}
  else await expect(page.locator('#detailPhotos .video-fallback')).toHaveAttribute('href',/commons\.wikimedia\.org\/wiki\/File:/);
  // Visit facts only when a source states them; the location map only on request.
  await expect(page.locator('#detailVisit')).toContainText('운영 중');
  await expect(page.locator('#detailVisit')).toContainText('해가 진 뒤 매일 밤 점등');
  await expect(page.locator('#miniMap .leaflet-container')).toHaveCount(0);
  await page.locator('[data-mini-map]').click();
  await expect(page.locator('#miniMap.map-loaded')).toBeVisible();
  // A project with only a daytime photo: it leads, labelled as architectural context.
  await page.goto('/#place/AR-piccadilly-lights');
  await expect(page.locator('.detail-hero .context-tag')).toHaveText('건축 맥락 사진');
  await expect(page.locator('#detailVisit')).toHaveCount(0);
 });
 test('without any image a project shows the designed placeholder for its type, never another photo',async({page})=>{
  await page.goto('/#place/AR-medialab-prado');
  await expect(page.locator('#view h1')).toHaveText('메디아랩 프라도 디지털 파사드');
  await expect(page.locator('.detail-hero .ph.ph-media_facade')).toBeVisible();
  await expect(page.locator('.detail-hero .ph-type')).toHaveText('미디어파사드');
  await expect(page.locator('#detailPhotos .gallery-empty .ph')).toBeVisible();
  await expect(page.locator('.detail-hero img, #detailPhotos img')).toHaveCount(0);
  // Its explore card too.
  await page.goto('/#explore');
  await page.locator('#placeSearch').fill('메디아랩');
  const card=page.locator('#placeResults .place-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.ph.ph-media_facade')).toBeVisible();
  await expect(card.locator('img')).toHaveCount(0);
 });
});

// Words of the internal review and data pipeline that must never reach a public screen (docs/STATIC_ARCHIVE.md
// "Consumer UI rules"). Checked on the visible text of every public screen, in both languages, with and without the
// dataset.
const BANNED={
 ko:['재확인 시점 경과','확인 기록 있음','검토 목록','편집 검수','자동 수집·미검수','자동 수집 · 미검수','미검수','검수 전','편집 검토','미확인 항목','항목별 상태','데이터 상태','데이터 검토','동기화 상태','지금 동기화','마지막 동기화','6시간마다','자동 갱신','갱신 실패','분류 추정','검증 전','수집 상태'],
 en:['re-check','recheck','Review list','Editor-verified','Auto-collected','unreviewed','not reviewed','Sync status','Data status','Data review','Update now','Refreshes every','last refreshed','unknown fields','Field states','field state','Origin and review','pipeline'],
 any:['Failed to fetch','refresh_days','field_status','review_status','build_id','HTTP 500','undefined','null ·','[object Object]'],
};
const SCREENS=['home','korea','korea/seoul','programs','world','explore','map','map/world','place/AR-ars-electronica-center','place/AR-medialab-prado','place/AR-piccadilly-lights','place/AR-suwon-hwaseong-media-art','place/SEOUL001','place/SEOUL006','saved','my','settings','data','calendar','routes','journal','magazine','curation/CUR001','nope'];
for(const mode of ['dataset','no dataset'])for(const lang of ['ko','en'])test(`public copy guard: no internal review or pipeline terms (${lang}, ${mode})`,async({page})=>{
 test.setTimeout(90000);
 if(mode==='dataset')await serveDataset(page);else await noDataset(page);
 await serveImages(page);
 await page.goto('/#settings');
 if(lang==='en')await page.getByRole('radio',{name:'English'}).click();
 await expect(page.locator('html')).toHaveAttribute('lang',lang);
 const found=[];
 for(const s of SCREENS){
  await page.goto('/#'+s);await page.waitForLoadState('networkidle');
  if(s==='explore'){await page.locator('.advanced-filters summary').click();await page.locator('[data-more-filters]').click({timeout:3000}).catch(()=>{})}
  const text=await page.evaluate(()=>document.body.innerText+' '+[...document.querySelectorAll('[aria-label],[title],[alt]')].map(e=>[e.getAttribute('aria-label'),e.getAttribute('title'),e.getAttribute('alt')].filter(Boolean).join(' ')).join(' '));
  for(const w of [...BANNED.ko,...BANNED.en,...BANNED.any])if(text.toLowerCase().includes(w.toLowerCase()))found.push(`#${s}: "${w}"`);
  // No public link to the admin pages or to internal data (v0.18: admin data is not published at all).
  for(const h of await page.evaluate(()=>[...document.querySelectorAll('a[href],[data-href]')].map(a=>a.getAttribute('href')||a.dataset.href)))if(/(^|\/)admin(\/|\.html|$)|data\/admin|admin-data|review\/|state\//i.test(h||''))found.push(`#${s}: link to ${h}`);
  if(lang==='en'&&!s.startsWith('place/SEOUL')&&!['journal','curation/CUR001','routes','magazine'].includes(s)){const h1=await page.locator('#view h1').first().textContent().catch(()=>'');if(/[가-힣]/.test(h1||'')&&!s.startsWith('place/'))found.push(`#${s}: Korean heading in English mode "${h1}"`)}
 }
 expect(found).toEqual([]);
});

// No horizontal scroll at phone, tablet and desktop widths; tap targets of 44 px on touch widths.
for(const width of [320,390,768,1024,1440])test(`no horizontal scroll at ${width}px`,async({page})=>{
 test.setTimeout(60000);
 await serveDataset(page);await serveImages(page);await tiles(page);
 await page.setViewportSize({width,height:width<700?800:900});
 const wide=[];
 for(const s of ['home','explore','map','place/AR-ars-electronica-center','place/AR-convention-centre-atrium-long','place/AR-medialab-prado','data','settings','my','saved']){
  await page.goto('/#'+s);await page.waitForLoadState('networkidle');
  const over=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  if(over>0)wide.push(`#${s}: ${over}px`);
 }
 expect(wide).toEqual([]);
});

// The tappable area (the element with its ::after extension) spans 44 px: probed by hit-testing 21 px either side of the
// centre of each target, after scrolling it into view.
test('touch targets on cards, credits and the place page are at least 44 px on a phone',async({page})=>{
 test.setTimeout(60000);
 await serveDataset(page);await serveImages(page);
 await page.setViewportSize({width:390,height:844});
 const small=[];
 for(const s of ['home','explore','place/AR-ars-electronica-center']){
  await page.goto('/#'+s);await page.waitForLoadState('networkidle');
  small.push(...await page.evaluate(async s=>{const out=[];const sel='#view .save-button, #view .image-credit, #view .card-link, #view .quick, #view .region-link, #view .type-row, #view .type-chips .chip, #view .text-link, #view .photo-count';for(const e of [...document.querySelectorAll(sel)].slice(0,40)){e.scrollIntoView({block:'center',inline:'center'});await new Promise(r=>requestAnimationFrame(r));if(e.closest('details:not([open])')&&!e.closest('summary'))continue;const r=e.getBoundingClientRect();if(!r.width||getComputedStyle(e).visibility==='hidden')continue;const cx=r.left+r.width/2,cy=r.top+r.height/2,hit=(x,y)=>{const h=document.elementFromPoint(x,y);return !!h&&(e===h||e.contains(h))};const pts=[[cx,cy-21],[cx,cy+21]];if(r.width<44)pts.push([cx-21,cy],[cx+21,cy]);const miss=pts.filter(([x,y])=>!hit(x,y));if(miss.length)out.push(`#${s} ${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} ${Math.round(r.width)}x${Math.round(r.height)} misses ${miss.map(p=>p.map(Math.round).join(',')).join(' ')}`)}return out},s));
 }
 expect(small).toEqual([]);
});

for(const [name,hash] of [['home','home'],['explore','explore'],['place','place/AR-ars-electronica-center']])for(const scheme of ['light','dark'])test(`a11y on the dataset: ${name} (${scheme})`,async({page})=>{
 await serveDataset(page);await serveImages(page);
 await page.emulateMedia({colorScheme:scheme});
 await page.goto('/#'+hash);await page.waitForLoadState('networkidle');
 const {violations}=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
 expect(violations.map(v=>`${v.id} (${v.impact}): ${v.nodes.slice(0,3).map(n=>n.target.join(' ')).join(' | ')}`)).toEqual([]);
});
