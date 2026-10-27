// Core guest flows in a real browser: records persist across reloads, backup downloads, theme toggles, offline shell works.
import {test,expect} from './fixtures.mjs';
test('visit record survives reload',async({page})=>{
 await page.goto('/#place/SEOUL001');
 await page.locator('[data-visit]').click();
 const dialog=page.locator('dialog[open]');await expect(dialog).toBeVisible();
 await dialog.locator('textarea').first().fill('<b>야간 관찰</b> 테스트');
 await dialog.locator('button[type=submit],button:has-text("저장")').first().click();
 await expect(page.locator('dialog[open]')).toHaveCount(0);
 await page.reload();await page.goto('/#journal');
 await expect(page.locator('#view')).toContainText('<b>야간 관찰</b> 테스트');
});
test('JSON backup downloads',async({page})=>{
 await page.goto('/#settings');
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:/JSON/}).first().click()]);
 expect(download.suggestedFilename()).toMatch(/\.json$/);
});
// The theme control lives in 설정 (화면): it follows the system by default, and an explicit choice persists.
test('theme choice persists',async({page})=>{
 await page.goto('/#settings');
 expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('system');
 await expect(page.getByRole('radio',{name:'시스템'})).toHaveAttribute('aria-checked','true');
 await page.getByRole('radio',{name:'다크'}).click();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.theme)).toBe('dark');
 expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(13, 15, 38)');
 await page.reload();expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('dark');
 await expect(page.getByRole('radio',{name:'다크'})).toHaveAttribute('aria-checked','true');
 await page.getByRole('radio',{name:'라이트'}).click();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.theme)).toBe('light');
 expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(246, 245, 251)');
 // A radio group: arrow keys move the choice and the focus.
 await page.getByRole('radio',{name:'라이트'}).focus();await page.keyboard.press('ArrowRight');
 await expect(page.getByRole('radio',{name:'다크'})).toHaveAttribute('aria-checked','true');
 await expect(page.getByRole('radio',{name:'다크'})).toBeFocused();
});
test.describe('system dark',()=>{
 test.use({colorScheme:'dark',viewport:{width:1280,height:800}});
 test('the system dark setting applies until a theme is chosen',async({page})=>{
  await page.goto('/#home');
  expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(13, 15, 38)');
  await expect(page.locator('.sidebar .brand-logo.logo-dark')).toBeVisible();
  await expect(page.locator('.sidebar .brand-logo.logo-light')).toBeHidden();
  await page.goto('/#settings');await page.getByRole('radio',{name:'라이트'}).click();
  expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(246, 245, 251)');
  await expect(page.locator('.sidebar .brand-logo.logo-light')).toBeVisible();
  await expect(page.locator('.sidebar .brand-logo.logo-dark')).toBeHidden();
 });
});
// Editorial courses (seed curation ids CUR001…): the page lists the stops in order and copies into my courses.
test('a curated course lists its stops and copies into my courses',async({page})=>{
 await page.goto('/#curation/CUR001');
 await expect(page.locator('#view h1')).toHaveText('오늘 밤 무료로 보는 빛');
 await expect(page.locator('.timeline .stop-row')).toHaveCount(6);
 await expect(page.locator('.timeline .stop-number').first()).toHaveText('1');
 await page.getByRole('button',{name:'내 코스로 복사'}).click();
 await page.locator('#newRouteForm button[type=submit]').click();
 await expect(page).toHaveURL(/#route\//);
 await expect(page.locator('#view h1')).toHaveText('오늘 밤 무료로 보는 빛');
 await expect(page.locator('.timeline .stop-row')).toHaveCount(6);
});
test('search with no match shows an empty state',async({page})=>{
 await page.goto('/#home');await page.locator('#homeSearch input').fill('zzzz존재하지않음');await page.locator('#homeSearch button').click();
 await expect(page.locator('#view')).toContainText(/없습니다|찾지 못|결과가 없/);
});
test.describe('offline',()=>{
 test.use({serviceWorkers:'allow'});
 test('app shell loads offline after first visit',async({page,context})=>{
  await page.goto('/');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready});
  await page.reload();await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading',{name:'빛으로 읽는 한국의 건축'})).toBeVisible();
  await page.goto('/#place/SEOUL001');await expect(page.locator('#view h1')).toBeVisible();
 });
});
// A new deploy reaches a returning visitor on their next load. The worker of v0.14–v0.18 served its cached scripts
// until every tab of the site was closed, so the live site kept showing an old version (2026-10-26).
test.describe('updates',()=>{
 test.use({serviceWorkers:'allow'});
 test('a visitor of the cache-first versions gets the new deploy without closing the tab; later deploys on the next load',async({page,context})=>{
  const {readFile}=await import('node:fs/promises');
  const legacy=await readFile(new URL('./fixtures/sw-v018.js',import.meta.url),'utf8');
  let deploy='A';
  await context.route('**/sw.js',r=>deploy==='A'?r.fulfill({contentType:'text/javascript; charset=utf-8',body:legacy}):r.continue());
  await context.route(/\/app\.js$/,async r=>{const res=await r.fetch();r.fulfill({response:res,body:(await res.text())+`\nwindow.__aolDeploy='${deploy}';`})});
  await page.goto('/');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready});
  await page.reload();
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  expect(await page.evaluate(()=>window.__aolDeploy)).toBe('A');
  // Deploy B: the old worker answers this load from its cache; the new one takes over and reloads the page once.
  deploy='B';
  await page.reload();
  await expect.poll(()=>page.evaluate(()=>window.__aolDeploy).catch(()=>null),{timeout:20000}).toBe('B');
  expect(await page.evaluate(async()=>(await caches.keys()).filter(k=>k.startsWith('aol-')&&k!=='aol-data').every(k=>k.startsWith('aol-s2-')))).toBe(true);
  // Deploy C: the shell is network-first now, so the next load has it.
  deploy='C';
  await page.reload();
  expect(await page.evaluate(()=>window.__aolDeploy)).toBe('C');
  await expect(page.getByRole('heading',{name:'빛으로 읽는 한국의 건축'})).toBeVisible();
 });
});
test('self-hosted map library loads under the production CSP',async({page})=>{
 const violations=[];page.on('console',m=>{if(/Content Security Policy/i.test(m.text()))violations.push(m.text())});
 const csp=(await page.goto('/#map')).headers()['content-security-policy'];expect(csp,'server must apply _headers').toContain("script-src 'self'");
 await page.locator('[data-load-map]').first().click();
 await expect(page.locator('.leaflet-container')).toBeVisible();
 expect(await page.evaluate(()=>typeof window.L?.map)).toBe('function');
 expect(violations).toEqual([]);
});
// A cleared photo that cannot load (offline, removed upstream) becomes the branded placeholder in place of the image
// only: the page layout, the title and the photo credit stay as they were.
test('a photo that fails to load keeps the layout and its credit',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//,r=>r.fulfill({status:404,body:''}));
 await page.goto('/#place/SEOUL031');
 await expect(page.locator('.detail-hero .photo-failed')).toBeVisible();
 await expect(page.locator('#detailPhotos .dp-cap[data-i="0"] .dp-credit')).toBeVisible();
 await expect(page.locator('#view h1')).toBeInViewport();
 // The gallery's failed photo stays inside its own frame instead of covering the page. (Retried as a block: a
 // background sync result may re-render the page while it is measured.)
 await expect(async()=>{
  const gallery=page.locator('#detailPhotos .dp-slide .dp-frame').first();await gallery.scrollIntoViewIfNeeded({timeout:2000});
  await expect(gallery.locator('.photo-failed')).toBeVisible({timeout:2000});
  const [frame,ph]=await Promise.all([gallery.boundingBox(),gallery.locator('.photo-failed').boundingBox()]);
  expect(Math.abs(ph.height-frame.height)).toBeLessThan(2);expect(Math.abs(ph.y-frame.y)).toBeLessThan(2);
 }).toPass({timeout:15000});
});
// Phones: the map list is a bottom sheet with three detents. At the tallest one it stops below the floating search and
// chips, so its handle can still be reached to bring it back down.
test('map sheet detents stay below the floating search on phones',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/#map');
 const handle=page.locator('#mapHandle'),height=()=>page.locator('.map-list').evaluate(e=>Math.round(e.getBoundingClientRect().height));
 const seen=[];
 for(let i=0;i<3;i++){await handle.click();await page.waitForTimeout(350);seen.push(await height())}
 expect(new Set(seen).size).toBe(3);
 const tallest=Math.max(...seen);while(await height()!==tallest){await handle.click();await page.waitForTimeout(350)}
 const [head,grip]=await Promise.all([page.locator('.map-head').boundingBox(),handle.boundingBox()]);
 expect(grip.y).toBeGreaterThanOrEqual(head.y+head.height);
 // Background data re-rendering the screen keeps the sheet where the user left it.
 await page.evaluate(()=>AOLApp.softRender());expect(await height()).toBe(tallest);
 await handle.click();await page.waitForTimeout(350);expect(await height()).toBeLessThan(tallest);
});
