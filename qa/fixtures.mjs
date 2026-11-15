// Shared Playwright test: the live Wikidata/Commons APIs are blocked by default so screen tests are deterministic.
// Image files still load. Opt in to the real APIs per test with test.use({liveApis: true}).
import {test as base,expect} from '@playwright/test';
export const API_HOSTS=/^https:\/\/(query\.wikidata\.org|www\.wikidata\.org\/w\/api\.php|commons\.wikimedia\.org\/w\/api\.php)/;
export const test=base.extend({
 liveApis:[false,{option:true}],
 // The public config.js names the operator's Supabase project (member features on since 2026-11-15). Screen tests run
 // as a site without a backend unless they opt in (test.use({backend:true})) or route config.js themselves (a route
 // registered in the test wins over this one).
 backend:[false,{option:true}],
 page:async({page,liveApis,backend},use)=>{
  if(!liveApis)await page.route(API_HOSTS,r=>r.abort('blockedbyclient'));
  if(!backend)await page.route(/\/config\.js(\?.*)?$/,async r=>{
   if(new URL(r.request().url()).pathname.includes('/admin/'))return r.fallback();
   const res=await r.fetch(),body=(await res.text()).replace(/SUPABASE_URL:\s*'[^']*'/,"SUPABASE_URL: ''").replace(/SUPABASE_PUBLISHABLE_KEY:\s*'[^']*'/,"SUPABASE_PUBLISHABLE_KEY: ''");
   return r.fulfill({response:res,body});
  });
  await use(page)
 }
});
export {expect};
