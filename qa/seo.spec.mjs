// Static project pages (scripts/prerender.mjs, docs/UI_v018.md "Search engines and link previews"): the pages the deploy
// writes from the dataset are readable and accessible at a phone and a desktop width, light and dark; the app points its
// canonical link and shared links at them only when the deployed index.html says they exist.
import {test,expect} from './fixtures.mjs';
import AxeBuilder from '@axe-core/playwright';
import {serveDataset,serveImages,filesOf} from './fixtures/site-data-routes.mjs';
import {siteData,RECORDS} from './fixtures/site-data-projects.mjs';
import {prerender,withMarker} from '../scripts/prerender.mjs';

const {files}=prerender(siteData(RECORDS),{siteURL:'https://remona8787.github.io'});
const KR=RECORDS.find(r=>r.country_iso2==='KR'&&r.images.length),WORLD=RECORDS.find(r=>r.country_iso2!=='KR'&&r.images.length);
// The generated pages, served where the deploy puts them.
const servePages=page=>page.route(u=>/^\/p\//.test(u.pathname),r=>{const rel=new URL(r.request().url()).pathname.slice(1).replace(/\/$/,'/index.html');const html=files.get(rel);return html?r.fulfill({contentType:'text/html; charset=utf-8',body:html}):r.fulfill({status:404,body:''})});
const axe=async page=>(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations.map(v=>`${v.id}: ${v.nodes.slice(0,3).map(n=>n.target.join(' ')).join(' | ')}`);

for(const scheme of ['light','dark'])test.describe(scheme,()=>{
 test.use({colorScheme:scheme});
 for(const width of [390,1440])test(`a project page and the list page are accessible and fit @${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await serveImages(page);await servePages(page);
  for(const path of [`/p/${KR.id}/`,`/p/${WORLD.id}/`,'/p/']){
   await page.goto(path);await page.waitForLoadState('networkidle');
   await expect(page.locator('h1')).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),path+' has no sideways scroll').toBeLessThanOrEqual(0);
   expect(await axe(page),path).toEqual([]);
  }
 });
});

test('a project page shows the credited photo, its facts and sources, and opens the project in the app',async({page})=>{
 await page.setViewportSize({width:390,height:844});await serveImages(page);await servePages(page);await serveDataset(page);
 await page.goto(`/p/${KR.id}/`);
 await expect(page.locator('h1')).toHaveText(KR.name_ko);
 await expect(page.locator('.project-photo figcaption')).toContainText('©');
 await expect.poll(()=>page.locator('.project-photo img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
 // The photo is never drawn wider than its largest rendition.
 const [shown,max]=await page.locator('.project-photo img').evaluate(i=>[i.getBoundingClientRect().width,Number(i.getAttribute('width'))]);
 expect(shown).toBeLessThanOrEqual(max+1);
 await page.locator('.project-actions .button').click();
 await expect(page).toHaveURL(new RegExp(`#place/${KR.id}$`));
 await expect(page.locator('#view h1')).toHaveText(KR.name_ko);
});

test('the app points canonical and shared links at the static page only when the deploy wrote the pages',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await serveDataset(page);await serveImages(page);
 await page.goto(`/#place/${KR.id}`);
 await expect(page.locator('#view h1')).toHaveText(KR.name_ko);
 const home=await page.locator('link[rel="canonical"]').getAttribute('href');
 expect(home).not.toContain('/p/');
 // The deployed index.html with the marker.
 await page.route(u=>u.pathname==='/'||u.pathname==='/index.html',async r=>{const res=await r.fetch();await r.fulfill({response:res,body:withMarker(await res.text())})});
 await page.goto('/');await page.goto(`/#place/${KR.id}`);await page.reload();
 await expect(page.locator('#view h1')).toHaveText(KR.name_ko);
 await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href',new RegExp(`/p/${KR.id}/$`));
 // Sharing gives the page a link preview can read.
 await page.evaluate(()=>{delete Navigator.prototype.share});
 await page.locator('#view [data-share]').first().click();
 await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toMatch(new RegExp(`^http://[^/]+/p/${KR.id}/$`));
 // A curated place with a dataset record uses that record's page.
 await page.unrouteAll({behavior:'ignoreErrors'});
 await serveDataset(page,filesOf(siteData([...RECORDS,{...KR,id:'SEOUL001',curated_place_id:'SEOUL001'}])));await serveImages(page);
 await page.route(u=>u.pathname==='/'||u.pathname==='/index.html',async r=>{const res=await r.fetch();await r.fulfill({response:res,body:withMarker(await res.text())})});
 await page.goto('/#place/SEOUL001');await page.reload();
 await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href',/\/p\/SEOUL001\/$/);
 // Leaving the place restores the site's canonical link.
 await page.goto('/#explore');
 await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href',home);
});
