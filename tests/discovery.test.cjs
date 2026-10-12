const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {transformSync}=require('esbuild');
const code=transformSync(fs.readFileSync('edge-functions/_shared/discovery.ts','utf8'),{loader:'ts',format:'cjs'}).code;
function api(response){const ctx=vm.createContext({module:{exports:{}},fetch:async()=>({ok:true,json:async()=>response}),AbortSignal});vm.runInContext(code,ctx);return ctx.module.exports}
const city={bbox_min_lat:37,bbox_min_lng:126,bbox_max_lat:38,bbox_max_lng:127,centroid_lat:37.5,centroid_lng:126.5};
test('invalid Overpass payload is a failure, never an empty successful discovery',async()=>{await assert.rejects(api({remark:'timeout'}).fetchOverpassCityCandidates(city),/Invalid Overpass/)});
test('invalid Wikidata payload is a failure, never an empty successful discovery',async()=>{await assert.rejects(api({}).fetchWikidataCityCandidates(city),/Invalid Wikidata/)});
test('general museum candidate is not eligible for automatic promotion',()=>{assert.equal(api({}).relevanceForCandidate({provider:'wikidata',name:'Museum',category_tags:['museum']}).auto,false)});
test('light and media relevance identifies specialist candidates',()=>{const result=api({}).relevanceForCandidate({provider:'osm_overpass',name:'Interactive Media Facade',website_url:'https://example.org',lat:37,lng:127});assert.ok(result.score>=72);assert.equal(result.inferredType,'Media Facade')});
