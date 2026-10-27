import {defineConfig} from '@playwright/test';
// Browser E2E against the built static app (dist/). Set AOL_TEST_URL to test a deployed URL instead.
const port=Number(process.env.AOL_TEST_PORT||4173);
// Without a UTF-8 locale headless Chromium replaces non-ASCII download names (e.g. 빛의건축_백업.json) with "download".
if(!/UTF-8/i.test(process.env.LC_ALL||process.env.LANG||''))process.env.LC_ALL=process.env.LANG='C.UTF-8';
// Requests a service worker makes (its script, its cache fills) go through context.route too, so the update test can
// play two deploys (qa/flows.spec.mjs 'updates'). Workers are blocked everywhere else (serviceWorkers:'block').
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS??='1';
export default defineConfig({
 testDir:'qa',testMatch:/.*\.spec\.mjs/,timeout:30000,retries:0,
 use:{baseURL:process.env.AOL_TEST_URL||`http://127.0.0.1:${port}`,serviceWorkers:'block'},
 webServer:process.env.AOL_TEST_URL?undefined:{command:`node scripts/serve.mjs dist ${port}`,port,reuseExistingServer:true}
});
