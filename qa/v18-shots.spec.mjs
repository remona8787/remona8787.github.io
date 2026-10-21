// Screenshots for the visual review of the v0.18 screens (not an assertion suite): run with
//   AOL_SHOTS=1 AOL_TEST_PORT=4331 npx playwright test qa/v18-shots.spec.mjs --workers=2
// Optional: AOL_SHOTS_ONLY=home,korea (screens), AOL_SHOTS_DIR (output folder), AOL_SHOTS_MODE=fallback (no dataset)
// or v17 (a home.json of the v0.17 shape), AOL_SHOTS_SCHEME=light|dark.
// The dataset is the test fixture (qa/fixtures/site-data) and the images are synthetic test images. Phones at 2×.
import {test} from './fixtures.mjs';
import {serveDataset,serveImages,noDataset,filesOf} from './fixtures/site-data-routes.mjs';
import {siteData,RECORDS} from './fixtures/site-data-projects.mjs';
const OUT=process.env.AOL_SHOTS_DIR||'qa/artifacts/v18-shots',ONLY=(process.env.AOL_SHOTS_ONLY||'').split(',').filter(Boolean),MODE=process.env.AOL_SHOTS_MODE||'',SCHEMES=(process.env.AOL_SHOTS_SCHEME||'light,dark').split(',');
const SCREENS=[['home','home'],['korea','korea'],['korea-seoul','korea/seoul'],['programs','programs'],['world','world'],['map','map'],['map-world','map/world'],['explore','explore'],['place-kr','place/AR-coex-kpop-square-wave'],['place-small','place/AR-suwon-hwaseong-media-art'],['place-noimage','place/AR-convention-centre-atrium-long'],['place-world','place/AR-ars-electronica-center'],['collection','saved'],['menu','home'],['my','my']];
const SIZES=[[390,844,2],[768,1024,1],[1440,900,1]];
const V17=filesOf(siteData(RECORDS,{home:'v17'}));
test.skip(!process.env.AOL_SHOTS,'visual review only (AOL_SHOTS=1)');
for(const [w,h,dpr] of SIZES)test.describe(`${w}x${h}`,()=>{
 test.use({viewport:{width:w,height:h},deviceScaleFactor:dpr});
 for(const scheme of SCHEMES)for(const [name,hash] of SCREENS){
  if(ONLY.length&&!ONLY.includes(name))continue;
  if(name==='menu'&&w>=768)continue;
  test(`${name} ${w} ${scheme}`,async({page})=>{
   test.setTimeout(60000);
   await page.emulateMedia({colorScheme:scheme});
   if(MODE==='fallback')await noDataset(page);else await serveDataset(page,MODE==='v17'?V17:undefined);await serveImages(page);
   await page.route(/^https:\/\/([abc]\.)?tile\.openstreetmap\.org\//,r=>r.fulfill({status:204,body:''}));
   await page.goto('/#'+hash);await page.waitForLoadState('networkidle');
   if(name.startsWith('map')){await page.locator('[data-load-map]').first().click().catch(()=>{});await page.waitForTimeout(1500)}
   if(name==='menu'){await page.locator('.top-more summary').click();await page.waitForTimeout(300)}
   const full=!name.startsWith('map')&&name!=='menu';
   if(full){const sh=await page.evaluate(()=>document.documentElement.scrollHeight);for(let y=0;y<sh;y+=600){await page.evaluate(v=>window.scrollTo(0,v),y);await page.waitForTimeout(60)}await page.evaluate(()=>window.scrollTo(0,0));await page.waitForLoadState('networkidle')}
   await page.waitForFunction(()=>[...document.images].every(i=>i.complete),null,{timeout:8000}).catch(()=>{});
   await page.waitForTimeout(400);
   await page.screenshot({path:`${OUT}/${name}-${w}-${scheme}${MODE?'-'+MODE:''}.png`,fullPage:full});
  });
 }
});
