// Community is a top-level section (v2.0 brief PART A §5) wherever the site has its member backend: the sixth phone tab
// and a sidebar entry after 세계, active on its pages. Without a backend the v1.0 menu stays as it was
// (qa/v18.spec.mjs: seven entries). A stand-in Supabase (page.route) answers; nothing reaches a real server.
import {test,expect} from './fixtures.mjs';

const URL_='https://nav-test.supabase.co',KEY='sb_publishable_navtest';
async function wire(page){
 await page.route('**/config.js',r=>r.request().url().includes('/admin/')?r.fallback():r.fulfill({contentType:'text/javascript',body:`window.AOL_CONFIG=Object.assign(window.AOL_CONFIG||{},{SUPABASE_URL:${JSON.stringify(URL_)},SUPABASE_PUBLISHABLE_KEY:${JSON.stringify(KEY)},PUBLIC_URL:location.origin});`}));
 await page.route(URL_+'/**',r=>r.fulfill({contentType:'application/json',body:new URL(r.request().url()).pathname.startsWith('/rest/')?'[]':'{}'}));
}

for(const [name,viewport] of [['phone',{width:390,height:844}],['desktop',{width:1440,height:900}]]){
 test(`${name}: Community is in the main menu and leads to the community page`,async({page})=>{
  await page.setViewportSize(viewport);await wire(page);
  await page.goto('/#home');
  const link=page.locator('#navigation a[href="#community"]');
  await expect(link).toBeVisible();
  await expect(page.locator('#navigation .nav-link')).toHaveCount(8);
  if(name==='phone'){
   // Six tabs, none cut off: home, Korea, map, world, community, collection.
   const tabs=await page.locator('#navigation .nav-link:visible').evaluateAll(as=>as.map(a=>a.getAttribute('href')));
   expect(tabs).toEqual(['#home','#korea','#map','#world','#community','#saved']);
   await expect(link).toBeInViewport();
   expect(await link.evaluate(a=>a.getBoundingClientRect().right)).toBeLessThanOrEqual(390);
   await expect(link.locator('.nav-short')).toHaveText('커뮤니티');
  }
  await link.click();
  await expect(page.locator('#view h1')).toHaveText('커뮤니티');
  await expect(link).toHaveAttribute('aria-current','page');
  // The 더보기 menu lists it once, with the other sections.
  expect(await page.locator('#moreMenu a[href="#community"]').count()).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
 });
}
