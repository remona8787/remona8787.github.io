// Ids merged into another project (index.json moved, pipeline/run.mjs): an old link to the merged id still reaches the
// project it went into, in the app (#place/<old id>) as on the static pages (scripts/prerender.mjs).
import {test,expect} from './fixtures.mjs';
import {serveDataset,serveImages,filesOf} from './fixtures/site-data-routes.mjs';
import {siteData,RECORDS} from './fixtures/site-data-projects.mjs';

test('an old link to a merged project opens the project it was merged into',async({page})=>{
 const into=RECORDS.find(r=>r.id==='SEOUL006')||RECORDS[0];
 const files=filesOf(siteData(RECORDS));
 files['index.json']={...files['index.json'],moved:{'REG-KR-9999':into.id}};
 await serveDataset(page,files);await serveImages(page);
 await page.goto('/#place/REG-KR-9999');
 await expect.poll(()=>page.evaluate(()=>location.hash)).toBe('#place/'+into.id);
 await expect(page.locator('#view h1')).toContainText('서울라이트');
 // An id that was never merged still shows the not-found page.
 await page.goto('/#place/REG-KR-0000');
 await expect(page.locator('#view h1')).toBeVisible();
 expect(await page.evaluate(()=>location.hash)).toBe('#place/REG-KR-0000');
});
