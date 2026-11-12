// Account and sync (client/cloud.js, with the Supabase client, about 180 KB) load only where a server is configured in
// config.js. A site without one (the static GitHub Pages site) never downloads them; the app treats a missing
// window.AOLCloud as "no account" everywhere. The URL is built at run time so the bundler keeps cloud.js separate.
const cfg = window.AOL_CONFIG || {}
// v2.0: the member platform API (client/platform-api.js) loads after cloud.js, with the same session.
if (cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY) import(new URL('./cloud.js', import.meta.url).href).then(() => import(new URL('./platform-api.js', import.meta.url).href))
