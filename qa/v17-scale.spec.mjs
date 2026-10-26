// The archive at scale: 3,200 projects from the static dataset (index.json with compact Commons thumbnails, as the
// pipeline writes it above 512 KB). Explore, its count, the map list and the map points always show the same filtered
// set, and the screens stay within time budgets. Budgets are generous for a shared CI runner (they catch an
// accidental O(n²) or a full re-render per keystroke, not small regressions).
import {test,expect} from './fixtures.mjs';
import {serveDataset,serveImages,filesOf} from './fixtures/site-data-routes.mjs';
import {siteData,manyRecords} from './fixtures/site-data-projects.mjs';

const N=3200,RECORDS=manyRecords(N),FILES=filesOf(siteData(RECORDS,{compact:true,shardTarget:200}));
const MAPPABLE=RECORDS.filter(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lng)).length;
const meta=page=>page.locator('#placeResults .result-meta');
// The curated seed places stay listed next to the dataset (the production dataset includes and merges them; this
// synthetic one does not), so totals add them; they have no coordinates in the seed.
const curated=page=>page.evaluate(()=>AOLApp.places().filter(p=>!allPlaces().some(x=>x.archive_place_id&&x.place_id===p.place_id)).length);
const shown=async(page,sel)=>Number((await page.locator(sel).getAttribute('data-count'))||-1);
// Places in the explore results, in the map list (its own count) and drawn on the map (points in cells).
const state=page=>page.evaluate(()=>({results:results().length,mappable:results().filter(AOLCatalog.mappable).length,mapCount:Number(document.querySelector('#mapResults .result-meta')?.dataset.count??-1),mapTotal:Number(document.querySelector('#mapResults .result-meta')?.dataset.total??-1),points:Number(document.querySelector('#mapCanvas')?.dataset.points??-1),clusters:Number(document.querySelector('#mapCanvas')?.dataset.clusters??-1),markers:typeof mapMarkers==='undefined'?-1:mapMarkers.length}));

test.beforeEach(async({page})=>{await serveDataset(page,FILES);await serveImages(page);await page.route(/^https:\/\/([abc]\.)?tile\.openstreetmap\.org\//,r=>r.fulfill({status:204,body:''}))});

test(`explore, its count, the map list and the map points agree on ${N} projects, within time budgets`,async({page})=>{
 test.setTimeout(90000);
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/#explore');
 await expect.poll(()=>page.evaluate(()=>window.AOL_DATASET?.index),{timeout:20000}).toBe('ok');
 const ALL=N+await curated(page);
 await expect(meta(page)).toHaveAttribute('data-count',String(ALL));
 await expect(page.locator('#placeResults .place-card')).toHaveCount(24);
 // One full render of explore with every filter count, and one result update as typing causes.
 const t=await page.evaluate(()=>{const time=f=>{const a=performance.now();f();return performance.now()-a};const render=Math.min(time(()=>AOLApp.render()),time(()=>AOLApp.render()));filters.q='Scale test project 3199';const search=time(()=>showResults());filters.q='';showResults();return {render,search}});
 console.log(`explore with ${N} projects: render ${t.render.toFixed(0)} ms, search update ${t.search.toFixed(0)} ms`);
 expect(t.render,'explore render').toBeLessThan(600);
 expect(t.search,'search update').toBeLessThan(400);
 // Typing: the list and the count follow; the map later shows the same set.
 await page.locator('#placeSearch').fill('Scale test project 3199');
 await expect(meta(page)).toHaveAttribute('data-count','1');
 await expect(page.locator('#placeResults h3')).toHaveText(['규모 시험 프로젝트 3199']);
 await page.locator('#placeSearch').fill('');
 await expect(meta(page)).toHaveAttribute('data-count',String(ALL));
 // A type filter: explore count = the filtered set; the map list and its points show the part with coordinates.
 await page.locator('#typeChips [data-facet="project_type"][data-value="light_art"]').click();
 const lightArt=await page.evaluate(()=>allPlaces().filter(p=>AOLCatalog.typeOf(p)==='light_art').length),lightArtMapped=RECORDS.filter(r=>r.project_type==='light_art'&&Number.isFinite(r.lat)).length;
 expect(lightArt).toBeGreaterThanOrEqual(400);
 await expect(meta(page)).toHaveAttribute('data-count',String(lightArt));
 await page.locator('#navigation a[href="#map"]').click();
 // The map opens on Korea (v0.18): its list is the Korean part; the world view has every one.
 const lightArtKr=RECORDS.filter(r=>r.project_type==='light_art'&&r.country_iso2==='KR'&&Number.isFinite(r.lat)).length;
 await expect(page.locator('#mapResults .result-meta')).toHaveAttribute('data-count',String(lightArtKr));
 await page.locator('[data-map-scope="world"]').click();
 await expect(page.locator('#mapResults .result-meta')).toHaveAttribute('data-count',String(lightArtMapped));
 await page.locator('.map-consent [data-load-map]').click();
 await expect(page.locator('#mapCanvas.map-loaded')).toBeVisible();
 await expect.poll(async()=>(await state(page)).points).toBe(lightArtMapped);
 let s=await state(page);
 expect([s.results,s.mappable,s.mapTotal]).toEqual([lightArt,lightArtMapped,lightArtMapped]);
 // Back to every type: the whole set, clustered so the map draws far fewer markers than points.
 await page.locator('#typeChips [data-type-all]').click();
 await expect.poll(async()=>(await state(page)).points).toBe(MAPPABLE);
 s=await state(page);
 expect([s.results,s.mappable,s.mapTotal,s.mapCount]).toEqual([ALL,MAPPABLE,MAPPABLE,MAPPABLE]);
 expect(s.clusters).toBeGreaterThan(0);
 expect(s.markers,'clusters keep the marker count small').toBeLessThan(400);
 // Redrawing the clusters for a move or zoom stays cheap at this size.
 const draw=await page.evaluate(()=>{const a=performance.now();for(let i=0;i<5;i++){mapProj=null;drawMap()}return (performance.now()-a)/5});
 console.log(`map with ${MAPPABLE} points: ${s.markers} markers (${s.clusters} clusters), redraw ${draw.toFixed(0)} ms`);
 expect(draw,'cluster redraw').toBeLessThan(250);
 // Zooming in: the list and its count are the places in view, the same as the points drawn there.
 await page.evaluate(()=>currentMap.setView([48.2,16.37],7));
 await expect.poll(async()=>{const m=await page.evaluate(()=>{const b=currentMap.getBounds();return {inView:mapShown.filter(p=>b.contains([p.latitude,p.longitude])).length,count:Number(document.querySelector('#mapResults .result-meta').dataset.count)}});return m.count===m.inView&&m.count<MAPPABLE}).toBe(true);
 // Explore again: the same total. (From the world map the search opens on 세계, v0.18; 전체 is every project.)
 await page.locator('#navigation a[href="#explore"]').click();
 await page.locator('.search-scope [data-scope-set="all"]').click();
 await expect(meta(page)).toHaveAttribute('data-count',String(ALL));
});

test(`the index of ${N} projects is read once and paged 24 at a time on a phone`,async({page})=>{
 test.setTimeout(60000);
 const seen=await serveDataset(page,FILES);
 await page.setViewportSize({width:390,height:844});
 await page.goto('/#explore');
 await expect.poll(()=>page.evaluate(()=>window.AOL_DATASET?.index),{timeout:20000}).toBe('ok');
 const ALL=N+await curated(page);
 await expect(meta(page)).toHaveAttribute('data-count',String(ALL));
 await expect(page.locator('#placeResults .place-card')).toHaveCount(24);
 await page.getByRole('button',{name:/더 보기/}).click();
 await expect(page.locator('#placeResults .place-card')).toHaveCount(48);
 await page.locator('#navigation a[href="#map"]').click();
 await page.locator('[data-map-scope="world"]').click();
 await expect(page.locator('#mapResults .result-meta')).toHaveAttribute('data-count',String(MAPPABLE));
 // On a phone the archive search is the top bar's search button (v0.18: five tabs).
 await page.locator('#quickSearch').click();
 await page.locator('.search-scope [data-scope-set="all"]').click();
 await expect(meta(page)).toHaveAttribute('data-count',String(ALL));
 expect(seen.filter(f=>f==='index.json').length,'index.json fetched once').toBe(1);
 expect(seen.filter(f=>f.startsWith('projects/')),'no shard for lists').toEqual([]);
 // Compact thumbnails are expanded to Commons URLs on the cards.
 const src=await page.locator('#placeResults img[data-place-photo]').first().getAttribute('src');
 expect(src).toMatch(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\//);
});
