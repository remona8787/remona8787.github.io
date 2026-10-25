const {test}=require('node:test'),assert=require('node:assert/strict'),X=require('../site-public-cleared/catalog.js');
const today='2026-10-11',p={place_id:'SEOUL001',name_kr:'빛의 전당',name_en:'Light Hall',primary_category:'Media Art',artist:'홍길동',program_start:'2026-10-01',program_end:'2026-10-20'};
test('archive search includes artists and normalized regional names',()=>{assert.equal(X.search([p],{q:'서울 홍길동'},today).length,1);assert.equal(X.search([p],{country:'대한민국',city:'부산'},today).length,0)});
test('dates alone never imply confirmed visitor availability',()=>{assert.equal(X.status(p,today),'ongoing');assert.equal(X.available(p,today),false)});
test('confirmed operation must have source, check date and future expiry',()=>{const q={...p,operation_verified:true,verified_at:'2026-10-10',operation_verified_until:'2026-10-12',operation_source_url:'https://example.com'};assert.equal(X.available(q,today),true);assert.equal(X.available({...q,operation_verified_until:'2026-10-10'},today),false);assert.equal(X.available({...q,operation_source_url:''},today),false)});
test('permanent projects do not become ended events',()=>{assert.equal(X.status({...p,content_type:'permanent',program_end:'2020-01-01'},today),'permanent')});
test('coordinates need editorial verification and a source',()=>{const q={...p,latitude:37.5,longitude:127};assert.equal(X.mappable(q),false);assert.equal(X.mappable({...q,coordinate_review_status:'verified',coordinate_source_url:'https://example.com'}),true);assert.equal(X.mappable({...q,latitude:200,coordinate_review_status:'verified',coordinate_source_url:'https://example.com'}),false)});
test('hidden places never leak through discovery search',()=>assert.equal(X.search([{...p,is_published:false}],{},today).length,0));
test('missing dates stay unknown, including invalid dates',()=>{assert.equal(X.status({...p,program_start:null,program_end:null},today),'unknown');assert.equal(X.status({...p,program_start:'2026-02-30',program_end:null},today),'unknown')});
test('relevance ranks name matches above artist matches',()=>{const q={...p,place_id:'B',name_kr:'다른 공간',name_en:'',artist:'빛의 전당'};assert.equal(X.search([q,p],{q:'빛의 전당'},today)[0].place_id,p.place_id)});
test('year filtering never infers an absent project year',()=>assert.equal(X.search([{...p,program_start:null}],{year:'2026'},today).length,0));
// v0.18 Korea first: the archive search lists Korean results first unless a country is chosen, drops none, keeps the
// chosen order within each group; Korean regions as a facet; the two Korean sections.
const ko=(id,o={})=>({place_id:id,name_kr:id,country_iso2:'KR',project_type:'media_facade',...o}),fo=(id,o={})=>({place_id:id,name_kr:id,country_iso2:'FR',project_type:'media_facade',...o});
test('Korean results first with ctx.krFirst unless a country is chosen; none dropped; the sort applies within each group',()=>{
 const ps=[fo('F1',{year_installed:2020}),ko('K1',{year_installed:2001,kr_region:'seoul'}),fo('F2',{year_installed:2010}),ko('K2',{year_installed:2015,kr_region:'jeju'})];
 assert.deepEqual(X.search(ps,{},today,{krFirst:true}).map(p=>p.place_id),['K1','K2','F1','F2']);
 assert.deepEqual(X.search(ps,{sort:'year_desc'},today,{krFirst:true}).map(p=>p.place_id),['K2','K1','F1','F2']);
 assert.deepEqual(X.search(ps,{country:'FR'},today,{krFirst:true}).map(p=>p.place_id),['F1','F2']);
 assert.deepEqual(X.search(ps,{sort:'year_desc'},today).map(p=>p.place_id),['F1','K2','F2','K1'],'without the context: one order');
 // Curated Seoul places count as Korean.
 assert.equal(X.isKR({place_id:'SEOUL001',name_kr:'x'}),true);
});
test('Korean region: the dataset value, null stays unknown, derived for places without the field; a facet with counts',()=>{
 assert.equal(X.krRegionOf(ko('a',{kr_region:'jeju'})),'jeju');
 assert.equal(X.krRegionOf(ko('b',{kr_region:null,city:'Busan'})),null);
 assert.equal(X.krRegionOf(ko('c',{city:'Busan'})),'busan_ulsan_gyeongnam');
 assert.equal(X.krRegionOf({place_id:'SEOUL009',name_kr:'x',address:'서울특별시 중구 세종대로 110'}),'seoul');
 assert.equal(X.krRegionOf(fo('d',{kr_region:'seoul'})),null,'only Korean places');
 const ps=[ko('a',{kr_region:'jeju'}),ko('b',{kr_region:'jeju'}),ko('c',{kr_region:'seoul'}),fo('f')];
 assert.deepEqual(X.facetCounts(ps,{},today,null,['kr_region']).kr_region,{jeju:2,seoul:1});
 assert.deepEqual(X.search(ps,{kr_region:['jeju']},today).map(p=>p.place_id),['a','b']);
 // The region's name finds its projects.
 assert.deepEqual(X.search(ps,{q:'제주'},today).map(p=>p.place_id),['a','b']);
});
test('Korean sections: facades, screens, media walls and projection mapping; everything else is media art and exhibitions',()=>{
 assert.deepEqual(['media_facade','projection_mapping','urban_screen','media_wall','light_art','festival_program','interactive_installation','media_architecture','other',null].map(t=>X.sectionOf({project_type:t})),['facade','facade','facade','facade','programs','programs','programs','programs','programs','programs']);
});
test('a keyword search keeps the best match on top; Korean results lead among equally good matches',()=>{
 const ps=[fo('F1',{name_en:'Haechi wall'}),ko('K1',{name_en:'Haechi Madang media wall'}),fo('F2',{name_en:'AEC',aliases:['AEC']}),fo('F3',{name_en:'Uniqa media wall'}),ko('K2',{name_en:'Lotte media wall'})];
 assert.equal(X.search(ps,{q:'aec'},today,{krFirst:true})[0].place_id,'F2','an exact foreign name leads');
 const r=X.search(ps,{q:'media wall'},today,{krFirst:true}).map(p=>p.place_id);
 assert.deepEqual(r.slice(0,2).sort(),['K1','K2']);assert.deepEqual(r.slice(2),['F3','F1'],'then the foreign match, then a passing mention');
});
