// WCAG 2.1 A/AA automated scan (axe-core) of the main screens.
import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for(const r of ['home','explore','map','saved','my','journal','routes','calendar','settings','account','place/SEOUL001','curation/CUR01'])
 for(const width of [390,1440])test(`a11y #${r} @${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto('/#'+r);await page.waitForLoadState('networkidle');
  const {violations}=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  expect(violations.map(v=>`${v.id} (${v.impact}): ${v.nodes.slice(0,3).map(n=>n.target.join(' ')).join(' | ')}`)).toEqual([]);
 });
