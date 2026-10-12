import {defineConfig} from '@playwright/test';
// Browser E2E against the built static app (dist/). Set AOL_TEST_URL to test a deployed URL instead.
const port=4173;
// Without a UTF-8 locale headless Chromium replaces non-ASCII download names (e.g. 빛의건축_백업.json) with "download".
if(!/UTF-8/i.test(process.env.LC_ALL||process.env.LANG||''))process.env.LC_ALL=process.env.LANG='C.UTF-8';
export default defineConfig({
 testDir:'qa',testMatch:/.*\.spec\.mjs/,timeout:30000,retries:0,
 use:{baseURL:process.env.AOL_TEST_URL||`http://127.0.0.1:${port}`,serviceWorkers:'block'},
 webServer:process.env.AOL_TEST_URL?undefined:{command:`python3 -m http.server ${port} --bind 127.0.0.1 --directory dist`,port,reuseExistingServer:true}
});
