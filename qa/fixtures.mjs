// Shared Playwright test: the live Wikidata/Commons APIs are blocked by default so screen tests are deterministic.
// Image files still load. Opt in to the real APIs per test with test.use({liveApis: true}).
import {test as base,expect} from '@playwright/test';
export const API_HOSTS=/^https:\/\/(query\.wikidata\.org|www\.wikidata\.org\/w\/api\.php|commons\.wikimedia\.org\/w\/api\.php)/;
export const test=base.extend({
 liveApis:[false,{option:true}],
 page:async({page,liveApis},use)=>{if(!liveApis)await page.route(API_HOSTS,r=>r.abort('blockedbyclient'));await use(page)}
});
export {expect};
