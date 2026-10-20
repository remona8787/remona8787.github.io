// Browser QA. Runs against the local dist/ build by default (see playwright.config.mjs) or AOL_TEST_URL.
import {test,expect} from './fixtures.mjs';
const base='';  // relative to baseURL in playwright.config.mjs (AOL_TEST_URL or the local server)
for(const viewport of [{width:360,height:800},{width:390,height:844},{width:412,height:915},{width:430,height:932},{width:768,height:1024},{width:1440,height:900}]){
 test(`discover, save and plan ${viewport.width}`,async({page})=>{
  await page.setViewportSize(viewport);await page.goto(base+'/');await expect(page.getByRole('heading',{name:'빛이 건축이 되는 순간들'})).toBeVisible();
  await page.locator('#homeSearch input').fill('동대문');await page.locator('#homeSearch button').click();await expect(page.locator('#placeResults')).toContainText('동대문');
  await page.locator('.save-button').first().click();await page.locator('#navigation a[href="#saved"]').click();await expect(page.locator('.place-card')).toHaveCount(1);
  await page.getByRole('button',{name:'저장 장소로 코스 만들기'}).click();await expect(page.locator('dialog')).toBeVisible();
  await page.screenshot({path:`qa/artifacts/discovery-${viewport.width}.png`,fullPage:true});
 });
}
// Without the dataset the curated places have no sourced coordinates: none is drawn at a guessed spot, and the list says
// how many stay off the map.
test('the map draws only places with sourced coordinates',async({page})=>{await page.goto(base+'/#map');await expect(page.locator('#mapResults .result-meta')).toContainText('0곳');await expect(page.locator('#mapResults .map-off')).toContainText(/위치 정보가 없는 \d+곳은 목록에서만 보여요/);});
test('published project photos actually decode',async({page,request})=>{const reach=await request.head('https://upload.wikimedia.org/wikipedia/commons/a/ae/Old_Seoul_Station_at_night_01.JPG',{timeout:10000}).then(r=>r.ok(),()=>false);test.skip(!reach,'upload.wikimedia.org unreachable from this runner; photos cannot be verified here');await page.goto(base+'/');const photos=page.locator('[data-place-photo]');expect(await photos.count(),'Requires actual cleared project images').toBeGreaterThan(0);for(const photo of await photos.all())await expect.poll(()=>photo.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true)});
