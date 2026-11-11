// v0.26 scale check at 1,000 and 5,000 projects on a phone (390×844): the home page never reads the index, explore
// reads it once, the index stays small enough for a mobile connection, search and render stay within budgets and the
// JS heap stays bounded. Budgets are generous for a shared CI runner: they catch an O(n²) step or a file that grows
// out of proportion, not small regressions. The measured numbers are printed for the report.
import {test,expect} from './fixtures.mjs';
import {serveDataset,serveImages,filesOf} from './fixtures/site-data-routes.mjs';
import {siteData,manyRecords} from './fixtures/site-data-projects.mjs';

for (const N of [1000,5000]) {
 test(`${N} projects on a phone: index once, home without it, search and render within budget`,async({page})=>{
  test.setTimeout(120000);
  const FILES=filesOf(siteData(manyRecords(N),{compact:true,shardTarget:200}));
  const indexBytes=Buffer.byteLength(JSON.stringify(FILES['index.json']));
  expect(indexBytes,'raw index.json').toBeLessThan(N*230);
  const seen=await serveDataset(page,FILES);await serveImages(page);
  await page.route(/^https:\/\/([abc]\.)?tile\.openstreetmap\.org\//,r=>r.fulfill({status:204,body:''}));
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#home');
  await expect.poll(()=>page.evaluate(()=>window.AOL_DATASET?.status)).toBe('ok');
  await page.waitForTimeout(300);
  expect(seen.filter(f=>f.startsWith('index.json')),'home never reads the index').toHaveLength(0);
  await page.goto('/#explore');
  await expect.poll(()=>page.evaluate(()=>window.AOL_DATASET?.index),{timeout:30000}).toBe('ok');
  const t=await page.evaluate(()=>{const time=f=>{const a=performance.now();f();return performance.now()-a};const render=Math.min(time(()=>AOLApp.render()),time(()=>AOLApp.render()));filters.q='Scale test project 99';const search=time(()=>showResults());filters.q='';showResults();return {render,search,heap:performance.memory?.usedJSHeapSize??null,cards:document.querySelectorAll('#placeResults .place-card').length}});
  console.log(`[scale] ${N} projects: index ${(indexBytes/1024).toFixed(0)} KB raw, explore render ${t.render.toFixed(0)} ms, search ${t.search.toFixed(0)} ms, heap ${t.heap?Math.round(t.heap/1048576)+' MB':'n/a'}, cards ${t.cards}`);
  expect(t.render,'explore render').toBeLessThan(N>2000?800:500);
  expect(t.search,'search update').toBeLessThan(N>2000?500:300);
  expect(t.cards,'explore pages its cards').toBeLessThanOrEqual(24);
  if (t.heap) expect(t.heap,'JS heap').toBeLessThan(N>2000?220e6:150e6);
  expect(seen.filter(f=>f.startsWith('index.json')),'the index is read once').toHaveLength(1);
  await page.locator('#placeSearch').fill('Scale test project '+(N-1));
  await expect(page.locator('#placeResults .result-meta')).toHaveAttribute('data-count','1');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(0);
 });
}
