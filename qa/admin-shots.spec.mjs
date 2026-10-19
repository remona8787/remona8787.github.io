// Screenshots of every console tab (mocked backend) for visual review. Runs only when AOL_ADMIN_SHOTS names a folder:
//   AOL_ADMIN_SHOTS=/tmp/admin-shots npx playwright test qa/admin-shots.spec.mjs
import {test,expect} from './fixtures.mjs';
import {mockSupabase,signIn,TAB_LABELS,TABS_BY_ROLE,READY} from './admin-fixtures.mjs';
const dir=process.env.AOL_ADMIN_SHOTS;
test.skip(!dir,'set AOL_ADMIN_SHOTS to a folder to save console screenshots');
const DETAIL={queue:'#queueList .qitem',projects:'#projectList .pitem',research:'#researchList .pitem',places:'#legacyRows .pitem'};
for(const scheme of ['light','dark'])for(const [w,h] of [[1440,900],[390,844]])test(`console screenshots ${scheme} @${w}`,async({page})=>{
 test.setTimeout(180000);
 await page.emulateMedia({colorScheme:scheme});
 await page.setViewportSize({width:w,height:h});
 await mockSupabase(page);
 const shot=name=>page.screenshot({path:`${dir}/${name}-${w}-${scheme}.png`,fullPage:true});
 await page.goto('/admin/');await page.waitForLoadState('networkidle');await shot('login');
 await signIn(page,'admin');
 for(const id of TABS_BY_ROLE.admin){
  await page.locator('#nav').getByRole('link',{name:TAB_LABELS[id],exact:true}).click();
  await expect(page.locator(READY[id]).first()).toBeVisible();
  if(DETAIL[id]&&w<900)await shot(id+'-list');
  if(DETAIL[id]){await page.locator(DETAIL[id]).first().click();await page.waitForLoadState('networkidle')}
  if(id==='queue')await page.locator('#drawer').getByRole('button',{name:'새 프로젝트로 승인'}).click();
  if(id==='rules')await page.locator('.rule',{hasText:'Dezeen'}).getByRole('button',{name:'고치기'}).click();
  await page.mouse.move(0,0);
  await shot(id);
  if(id==='queue'&&w<900){await page.keyboard.press('Escape');await page.keyboard.press('Escape')}
  if(DETAIL[id]&&id!=='queue'&&w<900)await page.getByRole('button',{name:'← 목록'}).click();
 }
});
