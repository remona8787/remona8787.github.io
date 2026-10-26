// Sponsor slot and partner page (docs/BUSINESS.md §7): nothing without data/sponsors.json; with it at most one slot
// per page, labelled, below the main content, never in the gallery, and not on a place page whose photos may not be
// used commercially. The partner page is static: e-mail only, no payment.
import {test,expect} from './fixtures.mjs';
import AxeBuilder from '@axe-core/playwright';
import {serveDataset,serveImages,filesOf} from './fixtures/site-data-routes.mjs';
import {siteData,RECORDS} from './fixtures/site-data-projects.mjs';

const SPONSORS={slots:[{label:'sponsor',title:'빛과 도시 재단',text:'미디어파사드 기록을 후원해요.',url:'https://example.org/sponsor',pages:['place','data']},{label:'ad',title:'두 번째 광고',url:'https://example.org/ad'}]};
// The operator turns the slot on in config.js (SPONSORS) after uploading data/sponsors.json.
async function sponsors(page,body,{on=true}={}){if(on)await page.route('**/config.js',async r=>{const res=await r.fetch();await r.fulfill({contentType:'text/javascript',body:(await res.text())+'\nwindow.AOL_CONFIG.SPONSORS=true;'})});const asked=[];await page.route('**/data/sponsors.json',r=>{asked.push(r.request().url());return body?r.fulfill({contentType:'application/json',body:JSON.stringify(body)}):r.fulfill({status:404,contentType:'text/html',body:'<!doctype html><title>404</title>'})});return asked}

test('switched off (the default) the file is never asked for; switched on without sponsors.json there is no slot',async({page})=>{
 await serveDataset(page);await serveImages(page);
 const off=await sponsors(page,SPONSORS,{on:false});
 await page.goto('/#place/SEOUL006');await expect(page.locator('#view h1')).toBeVisible();await page.waitForLoadState('networkidle');
 await expect(page.locator('.sponsor-slot')).toHaveCount(0);expect(off).toEqual([]);
 await page.unrouteAll({behavior:'ignoreErrors'});await serveDataset(page);await serveImages(page);await sponsors(page,null);
 for(const h of ['#place/SEOUL006','#data','#home']){await page.goto('/'+h);await expect(page.locator('#view h1').first()).toBeVisible();await page.waitForLoadState('networkidle');await expect(page.locator('.sponsor-slot')).toHaveCount(0)}
});
test('with sponsors.json: one labelled slot below the content of a place page with commercially usable photos, and on the research page',async({page})=>{
 await serveDataset(page);await serveImages(page);await sponsors(page,SPONSORS);
 await page.goto('/#place/SEOUL006');
 const slot=page.locator('.sponsor-slot');
 await expect(slot).toHaveCount(1);
 await expect(slot.locator('.sponsor-label')).toHaveText('후원');
 await expect(slot.locator('a[rel~="sponsored"]')).toHaveAttribute('href','https://example.org/sponsor');
 // Below the main content and outside the gallery and the panels.
 await expect(page.locator('#detailPhotos .sponsor-slot, .dp-panel .sponsor-slot')).toHaveCount(0);
 expect(await page.evaluate(()=>{const s=document.querySelector('.sponsor-slot'),panels=document.querySelector('.dp-panels');return !!(panels.compareDocumentPosition(s)&Node.DOCUMENT_POSITION_FOLLOWING)})).toBe(true);
 await page.goto('/#data');await expect(page.locator('.sponsor-slot')).toHaveCount(1);
 // Pages the slot does not name, or that are not supported, get none.
 await page.goto('/#home');await page.waitForLoadState('networkidle');await expect(page.locator('.sponsor-slot')).toHaveCount(0);
});
test('a place page with a non-commercial photo (CC BY-NC, KOGL type 2) never gets a slot',async({page})=>{
 const recs=RECORDS.map(r=>r.id==='acc-media-wall'?{...r,images:r.images.map((m,i)=>i?m:{...m,license:'CC BY-NC 2.0',license_url:'https://creativecommons.org/licenses/by-nc/2.0/',commercial_use:false})}:r.id==='hanbit-tower-facade'?{...r,images:r.images.map((m,i)=>i?m:{...m,license:'KOGL Type 2',license_url:'https://www.kogl.or.kr/info/licenseType2.do',kogl_type:2,commercial_use:false})}:r);
 await serveDataset(page,filesOf(siteData(recs)));await serveImages(page);await sponsors(page,SPONSORS);
 for(const id of ['acc-media-wall','hanbit-tower-facade']){await page.goto('/#place/'+id);await expect(page.locator('#view h1')).toBeVisible();await page.waitForLoadState('networkidle');await expect(page.locator('.sponsor-slot'),id).toHaveCount(0)}
 await page.goto('/#place/SEOUL006');await expect(page.locator('.sponsor-slot')).toHaveCount(1);
});
test('the partner page: the principles, e-mail contact, no payment; accessible',async({page})=>{
 await page.goto('/partner.html');
 await expect(page.locator('h1')).toHaveText('파트너·후원 문의');
 await expect(page.locator('main')).toContainText('결제 기능이 없어요');
 await expect(page.locator('main')).toContainText('“후원” 또는 “광고”');
 await expect(page.locator('[data-config="SUPPORT_EMAIL"]')).not.toBeEmpty();
 await expect(page.locator('main form, main input, main button')).toHaveCount(0);
 const {violations}=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
 expect(violations.map(v=>v.id)).toEqual([]);
});
