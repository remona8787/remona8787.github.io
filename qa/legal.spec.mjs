// Legal pages show operator/contact from config.js and visibly flag them when missing.
import {test,expect} from './fixtures.mjs';
for(const p of ['privacy.html','terms.html','support.html','delete-account.html']){
 test(`${p} flags missing operator`,async({page})=>{
  await page.route('**/config.js',r=>r.fulfill({contentType:'text/javascript',body:"window.AOL_CONFIG={OPERATOR_NAME:'',SUPPORT_EMAIL:''}"}));
  await page.goto('/'+p);await expect(page.locator('#legal-unresolved')).toBeVisible();await expect(page.locator('.unresolved').first()).toBeVisible();
 });
 test(`${p} renders configured operator`,async({page})=>{
  await page.route('**/config.js',r=>r.fulfill({contentType:'text/javascript',body:"window.AOL_CONFIG={OPERATOR_NAME:'테스트 운영자',SUPPORT_EMAIL:'help@example.com'}"}));
  await page.goto('/'+p);
  await expect(page.locator('#legal-unresolved')).toBeHidden();await expect(page.locator('.unresolved')).toHaveCount(0);
  await expect(page.locator('main')).toContainText('테스트 운영자');await expect(page.locator('a[href="mailto:help@example.com"]').first()).toBeVisible();
 });
}
test('email with markup is never turned into a link',async({page})=>{
 await page.route('**/config.js',r=>r.fulfill({contentType:'text/javascript',body:"window.AOL_CONFIG={OPERATOR_NAME:'<img src=x onerror=alert(1)>',SUPPORT_EMAIL:'\"><b>x</b>@a.b'}"}));
 await page.goto('/support.html');await expect(page.locator('main img')).toHaveCount(0);await expect(page.locator('main a[href^=mailto]')).toHaveCount(0);
});
test('production config shows the registered operator',async({page})=>{
 await page.goto('/privacy.html');await expect(page.locator('#legal-unresolved')).toBeHidden();
 await expect(page.locator('main')).toContainText('김지현 (JIHYUN KIM)');await expect(page.locator('a[href="mailto:remona56@hanmail.net"]')).toBeVisible();
});
