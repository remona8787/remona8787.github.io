const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const rows=JSON.parse(fs.readFileSync('data/reviewed-media.json'));
const source=fs.readFileSync('site-public-cleared/app.js','utf8');
const start=source.indexOf('function mediaURL('),end=source.indexOf('\nfunction ',source.indexOf('function mediaFor(')+1);
function evaluate(server){const ctx={window:{AOL_REVIEWED_MEDIA:rows},C:{safeURL:s=>s||''}};if(server!==undefined)ctx.window.AOL_MEDIA=server;vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);return ctx}
test('reviewed photos available before backend connection',()=>assert.equal(evaluate().mediaFor({place_id:'SEOUL031'}).length,1));
test('successful empty server snapshot never resurrects revoked photos',()=>assert.equal(evaluate([]).mediaFor({place_id:'SEOUL031'}).length,0));
test('pending server image is not exposed',()=>assert.equal(evaluate([{place_code:'SEOUL031',cached_public_url:'https://example.org/photo',clearance_status:'pending'}]).mediaFor({place_id:'SEOUL031'}).length,0));
test('bootstrap references have provenance and distinguish direct media from cache',()=>{for(const r of rows){assert.ok(r.creator&&r.license_url&&r.source_url&&r.captured_at);assert.equal(r.cached_public_url,undefined);assert.equal(new URL(r.display_url).hostname,'thumb.wikimedia.org')}});
