// Core guest flows in a real browser: records persist across reloads, backup downloads, theme toggles, offline shell works.
import {test,expect} from '@playwright/test';
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
test('theme toggle persists',async({page})=>{
 await page.goto('/#home');
 const before=await page.evaluate(()=>document.documentElement.dataset.theme);
 await page.locator('.topbar button').first().click();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.theme)).not.toBe(before);
 const after=await page.evaluate(()=>document.documentElement.dataset.theme);
 await page.reload();expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe(after);
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
  await expect(page.getByRole('heading',{name:'빛이 머무는 공간, 나의 다음 발견.'})).toBeVisible();
  await page.goto('/#place/SEOUL001');await expect(page.locator('#view h1')).toBeVisible();
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
