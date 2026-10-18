// WCAG 2.1 A/AA automated scan (axe-core) of the main screens.
import {test,expect} from './fixtures.mjs';
import AxeBuilder from '@axe-core/playwright';
for(const r of ['home','explore','map','saved','my','journal','routes','calendar','settings','account','place/SEOUL001','curation/CUR001'])
 for(const width of [390,1440])test(`a11y #${r} @${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto('/#'+r);await page.waitForLoadState('networkidle');
  const {violations}=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  expect(violations.map(v=>`${v.id} (${v.impact}): ${v.nodes.slice(0,3).map(n=>n.target.join(' ')).join(' | ')}`)).toEqual([]);
 });
// The same scan with the system set to dark: the dark tokens must pass on the real screens too.
test.describe('dark theme',()=>{
 test.use({colorScheme:'dark'});
 for(const r of ['home','explore','map','saved','my','settings','account','place/SEOUL001','curation/CUR001'])
  for(const width of [390,1440])test(`a11y dark #${r} @${width}`,async({page})=>{
   await page.setViewportSize({width,height:900});await page.goto('/#'+r);await page.waitForLoadState('networkidle');
   expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(13, 15, 38)');
   const {violations}=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
   expect(violations.map(v=>`${v.id} (${v.impact}): ${v.nodes.slice(0,3).map(n=>n.target.join(' ')).join(' | ')}`)).toEqual([]);
  });
});
// Saved places: cards in the saved grid and the saved count in the sidebar.
for(const width of [390,1440])test(`a11y #saved with saved places @${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/#explore');
 for(const i of [0,1])await page.locator('#placeResults .save-button').nth(i).click();
 await page.goto('/#saved');await expect(page.locator('.place-card')).toHaveCount(2);await page.waitForLoadState('networkidle');
 if(width>1000)await expect(page.locator('#navigation .nav-count')).toHaveText('2곳');
 const {violations}=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
 expect(violations.map(v=>`${v.id} (${v.impact}): ${v.nodes.slice(0,3).map(n=>n.target.join(' ')).join(' | ')}`)).toEqual([]);
});
