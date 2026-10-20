// Screenshots for the visual review of the v0.17 consumer screens (not an assertion suite): run with
//   AOL_SHOTS=1 AOL_TEST_PORT=4322 npx playwright test qa/v17-shots.spec.mjs --workers=2
// Optional: AOL_SHOTS_ONLY=home,explore (screens), AOL_SHOTS_DIR (output folder), AOL_SHOTS_MODE=fallback (no dataset).
// The dataset is the test fixture (qa/fixtures/site-data) and the images are synthetic test images.
import {test} from './fixtures.mjs';
import {serveDataset,serveImages,noDataset} from './fixtures/site-data-routes.mjs';
const OUT=process.env.AOL_SHOTS_DIR||'qa/artifacts/v17-shots',ONLY=(process.env.AOL_SHOTS_ONLY||'').split(',').filter(Boolean),FALLBACK=process.env.AOL_SHOTS_MODE==='fallback';
const SCREENS=[['home','home'],['explore','explore'],['map','map'],['place-hero','place/AR-ars-electronica-center'],['place-noimage','place/AR-convention-centre-atrium-long'],['place-curated','place/SEOUL001'],['saved','saved'],['my','my'],['settings','settings'],['data','data'],['explore-filters','explore']];
const SIZES=[[390,844],[768,1024],[1440,900]];
test.skip(!process.env.AOL_SHOTS,'visual review only (AOL_SHOTS=1)');
for(const scheme of ['light','dark'])for(const [w,h] of SIZES)for(const [name,hash] of SCREENS){
 if(ONLY.length&&!ONLY.includes(name))continue;
 test(`${name} ${w} ${scheme}`,async({page})=>{
  await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width:w,height:h});
  if(FALLBACK)await noDataset(page);else await serveDataset(page);await serveImages(page);
  await page.goto('/#'+hash);await page.waitForLoadState('networkidle');
  if(name==='map'){await page.locator('[data-load-map]').first().click().catch(()=>{});await page.waitForTimeout(1500)}
  if(name==='explore-filters'){await page.locator('.advanced-filters summary').click().catch(()=>{});await page.waitForTimeout(500)}
  // Lazy images load as they come near the viewport: walk down the page once, then back to the top.
  if(!['map','explore-filters'].includes(name)){const h=await page.evaluate(()=>document.documentElement.scrollHeight);for(let y=0;y<h;y+=600){await page.evaluate(v=>window.scrollTo(0,v),y);await page.waitForTimeout(60)}await page.evaluate(()=>window.scrollTo(0,0));await page.waitForLoadState('networkidle')}
  await page.waitForTimeout(400);
  await page.screenshot({path:`${OUT}/${name}-${w}-${scheme}${FALLBACK?'-fallback':''}.png`,fullPage:!['map','explore-filters'].includes(name)});
 });
}
