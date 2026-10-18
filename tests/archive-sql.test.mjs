// Applies the v0.16 archive migration (supabase/migrations/20261018000000_media_facade_archive.sql) to real Postgres
// (PGlite with pg_trgm) under Supabase's default grants and the stubbed auth schema, then checks the contract of
// docs/ARCHIVE_SPEC.md §4 and §8: privileges, the six dedupe rules, review actions, the public view, search, the
// collection schedule, link checks, WebSub and pruning. PGlite-tested only: not a substitute for a run on Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
const T=createRequire(import.meta.url)('../site-public-cleared/archive-taxonomy.js');
const root=new URL('../',import.meta.url);
const sql=async f=>(await readFile(new URL(f,root),'utf8')).replace(/create extension if not exists "?pgcrypto"?[^;]*;/gi,'');
const ARCHIVE='supabase/migrations/20261018000000_media_facade_archive.sql';
const LEGACY=['supabase/01_schema.sql','supabase/02_seed_seoul50.sql','supabase/03_storage.sql','supabase/04_flutterflow_rpc.sql','supabase/05_live_data_schema.sql',
 'supabase/07_audited_corrections.sql','supabase/08_hybrid_media_pipeline.sql','supabase/10_global_discovery_engine.sql','supabase/12_seed_countries_cities.sql',
 'supabase/13_admin_review_console.sql','supabase/15_discovery_hardening.sql','supabase/17_user_sync_and_operations.sql','supabase/18_discovery_rotation.sql',
 'supabase/migrations/20261010160920_archive_media_and_editorial.sql','supabase/migrations/20261013000000_discovered_places.sql'];
// Supabase grants every new table, view and function in public to anon/authenticated; the migration's revokes must hold.
const SUPABASE_DEFAULT_GRANTS=`alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`;
async function database(files=[ARCHIVE]){
 const d=new PGlite({extensions:{pg_trgm}});
 await d.exec(await sql('tests/sql/supabase-stubs.sql'));await d.exec(SUPABASE_DEFAULT_GRANTS);
 for(const f of files)await d.exec(await sql(f)).catch(e=>{throw Error(`${f}: ${e.message}`)});
 return d;
}
const J=JSON.stringify,H=3600e3,DAY=24*H;
// A PostgREST-like request: role anon/authenticated/service_role with the JWT subject set.
const as=(d,role,sub,fn)=>d.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`,[sub||'']);return fn(tx)});
const q=(d,role,sub,text,params=[])=>as(d,role,sub,tx=>tx.query(text,params)).then(r=>r.rows);
const svc=(d,text,params)=>q(d,'service_role',null,text,params);
const rows=async(d,text,params=[])=>(await d.query(text,params)).rows;
const code=async p=>{try{await p}catch(e){return e.code||e.message}return 'ok'};

// Deterministic, mutually dissimilar titles (so dedupe rule 6 only fires where a test wants it).
let seed=7;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
const word=()=>Array.from({length:7},()=>'bcdfghjklmnpqrstvwxz'[Math.floor(rnd()*20)]).join('');
let n=0;
function item(o={}){
 const i=++n;
 return {provider:'gdelt',rule_id:null,external_id:'ext-'+i,url:`https://n${i}.example.com/story/${i}?utm_source=feed`,canonical_url:`https://n${i}.example.com/story/${i}`,
  title:`${word()} ${word()} ${word()} ${word()}`,excerpt:'A short excerpt from the feed.',publisher:'Example News',language:'en',published_at:'2026-10-15T09:00:00Z',
  source_kind:'news',reliability:55,raw:{seendate:'20261015T090000Z'},...o,
  classification:{score:70,label:'facade_project',reasons:['positive:media facade'],version:'classify-1',...o.classification},
  detected:{name:null,country_iso2:null,city:null,latitude:null,longitude:null,...o.detected},
  keys:{normalized_name:null,story_key:'story-'+i,wikidata_qid:null,alias_project_id:null,...o.keys}};
}

let db,ADMIN,EDITOR,RESEARCHER,USER,RULE,RUN;
const ed=(text,params)=>q(db,'authenticated',EDITOR,text,params);
const upsert=(p,user=EDITOR)=>q(db,'authenticated',user,`select public.archive_admin_upsert_project($1::jsonb) id`,[J(p)]).then(r=>r[0].id);
const review=(id,action,payload={},user=EDITOR)=>q(db,'authenticated',user,`select public.archive_admin_review_candidate($1,$2,$3::jsonb) r`,[id,action,J(payload)]).then(r=>r[0].r);
const ingest=(items,run=RUN)=>svc(db,`select public.archive_ingest($1,$2::jsonb) r`,[run,J(items)]).then(r=>r[0].r);
const project=id=>rows(db,`select * from public.archive_projects where id=$1`,[id]).then(r=>r[0]);
const candidate=id=>rows(db,`select * from public.archive_candidates where id=$1`,[id]).then(r=>r[0]);
const publicView=(where='true',params=[])=>q(db,'anon',null,`select * from public.public_archive_projects where ${where} order by slug`,params);

test.before(async()=>{
 db=await database([ARCHIVE,ARCHIVE]);
 [ADMIN,EDITOR,RESEARCHER,USER]=(await rows(db,`insert into auth.users(email) values('admin@t'),('editor@t'),('researcher@t'),('user@t') returning id`)).map(r=>r.id);
 await db.query(`insert into public.app_admins(user_id,role) values($1,'admin'),($2,'editor'),($3,'researcher')`,[ADMIN,EDITOR,RESEARCHER]);
 RULE=await q(db,'authenticated',ADMIN,`select public.archive_admin_upsert_rule($1::jsonb) id`,[J({kind:'gdelt',name:'media facade (en)',query:'"media facade"',language:'en'})]).then(r=>r[0].id);
 RUN=(await svc(db,`select public.archive_start_run($1,'cron') id`,[RULE]))[0].id;
});
test.after(()=>db?.close());

// ---- schema ----------------------------------------------------------------------------------------------------
test('schema: applies twice over the legacy SQL and complete-backend.sql (which carries it), and without pg_trgm',async()=>{
 const d=await database(LEGACY);
 const [owner,other]=(await rows(d,`insert into auth.users(email) values('o@t'),('r@t') returning id`)).map(r=>r.id);
 await d.query(`insert into public.app_admins(user_id,role) values($1,'owner'),($2,'reviewer')`,[owner,other]);
 await d.exec(await sql(ARCHIVE));await d.exec(await sql(ARCHIVE));
 for(let i=0;i<2;i++)await d.exec(await sql('release/launch/complete-backend.sql'));
 assert.deepEqual((await rows(d,`select role from public.app_admins order by role`)).map(r=>r.role),['admin','editor'],"legacy 'owner' is admin, other values keep editor access");
 await d.query(`insert into auth.users(id,email) values(gen_random_uuid(),'x@t')`);
 await d.query(`insert into public.app_admins(user_id,role) select id,'owner' from auth.users where email='x@t'`);
 assert.equal((await rows(d,`select role from public.app_admins a join auth.users u on u.id=a.user_id where u.email='x@t'`))[0].role,'admin','the LAUNCH.md snippet still works');
 await assert.rejects(d.query(`update public.app_admins set role='superuser'`),/check constraint/);
 const [{n}]=await rows(d,`select count(*)::int n from public.archive_settings`);assert.equal(n,1);
 await d.close();
 const plain=new PGlite();await plain.exec(await sql('tests/sql/supabase-stubs.sql'));await plain.exec(await sql(ARCHIVE));await plain.exec(await sql(ARCHIVE));
 assert.equal((await rows(plain,`select count(*)::int n from pg_indexes where indexname like 'archive%trgm'`))[0].n,0,'trigram indexes are skipped without pg_trgm');
 await plain.close();
 assert.equal((await rows(db,`select count(*)::int n from pg_indexes where indexname in ('archive_projects_names_trgm','archive_candidate_hits_title_trgm')`))[0].n,2);
 assert.equal((await rows(db,`select n.nspname s from pg_extension e join pg_namespace n on n.oid=e.extnamespace where extname='pg_trgm'`))[0].s,'extensions');
});

const vocabColumns=[['archive_projects','project_type'],['archive_projects','installation_method'],['archive_projects','envelope_type'],['archive_projects','technology'],
 ['archive_projects','content_type'],['archive_projects','spatial_context'],['archive_projects','operating_status'],['archive_projects','region'],['archive_projects','record_origin'],
 ['archive_projects','review_status'],['archive_projects','visibility'],['archive_projects','update_status'],['archive_projects','official_url_state','link_state'],
 ['archive_sources','source_kind'],['archive_sources','link_state'],['archive_sources','provider','rule_kind'],['archive_media','link_state'],
 ['archive_candidates','status','candidate_status'],['archive_candidates','label','candidate_label'],['archive_candidate_hits','provider','rule_kind'],
 ['archive_candidate_hits','source_kind'],['archive_candidate_hits','label','candidate_label'],['archive_credits','role','credit_role'],['archive_collection_rules','kind','rule_kind']];
test('schema: every vocabulary check equals the keys in archive-taxonomy.js, and the region map equals regionOf',async()=>{
 for(const [table,column,name=column] of vocabColumns){
  const defs=(await rows(db,`select pg_get_constraintdef(c.oid) d from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
   where c.conrelid=$1::regclass and c.contype='c' and cardinality(c.conkey)=1 and a.attname=$2`,['public.'+table,column])).map(r=>r.d).filter(d=>d.includes('ARRAY['));
  assert.equal(defs.length,1,`${table}.${column}: one vocabulary check`);
  const keys=[...defs[0].matchAll(/'([a-z0-9_]+)'::text/g)].map(m=>m[1]);
  assert.deepEqual(keys,T.keys(name),`${table}.${column} = taxonomy ${name}`);
 }
 const def=(await rows(db,`select pg_get_functiondef('public.archive_valid_field_status(jsonb)'::regprocedure) d`))[0].d;
 assert.deepEqual([...def.match(/not in \(([^)]*)\)/)[1].matchAll(/'([a-z_]+)'/g)].map(m=>m[1]),T.keys('field_state'));
 // The ingest validator's own lists: every key passes, an unknown one does not.
 for(const [field,name,set] of [['provider','rule_kind',(i,v)=>i.provider=v],['source_kind','source_kind',(i,v)=>i.source_kind=v],['label','candidate_label',(i,v)=>i.classification.label=v]]){
  for(const v of [...T.keys(name),'bogus']){const it=item();set(it,v);
   const [{p}]=await rows(db,`select public.archive_item_problem($1::jsonb) p`,[J(it)]);
   assert.equal(p===null,v!=='bogus',`${field}=${v}: ${p}`);
  }
 }
 const codes=Object.keys(T.regionByIso);
 const got=await rows(db,`select k,public.archive_region_of(k) r from unnest($1::text[]) k`,[codes]);
 assert.deepEqual(Object.fromEntries(got.map(x=>[x.k,x.r])),T.regionByIso);
 assert.equal((await rows(db,`select public.archive_region_of('ZZ') r`))[0].r,null);
});

const TABLES=['archive_projects','archive_sources','archive_credits','archive_project_sources','archive_media','archive_collection_rules','archive_keywords','archive_runs',
 'archive_run_errors','archive_candidates','archive_candidate_hits','archive_project_updates','archive_websub_subscriptions','archive_assessments','archive_audit_log','archive_settings'];
const ADMIN_FNS=['archive_admin_dashboard()','archive_admin_list_candidates(text,text,integer,integer,integer)','archive_admin_review_candidate(uuid,text,jsonb)',
 'archive_admin_upsert_project(jsonb)','archive_admin_set_visibility(uuid,text,text)','archive_admin_merge_projects(uuid,uuid)','archive_admin_add_source(uuid,jsonb,text[])',
 'archive_admin_set_media(uuid,jsonb)','archive_admin_remove_media(uuid)','archive_admin_list_projects(text,text,integer,integer)','archive_admin_list_updates(text,integer)',
 'archive_admin_resolve_update(uuid,text)','archive_admin_list_runs(integer,uuid)','archive_admin_list_errors(integer)','archive_admin_list_rules()','archive_admin_upsert_rule(jsonb)',
 'archive_admin_list_keywords()','archive_admin_upsert_keyword(jsonb)','archive_admin_set_settings(jsonb)','archive_research_add_assessment(uuid,text,jsonb,text,text,text)'];
const SERVICE_FNS=['archive_claim_due_rules(integer,text,uuid[])','archive_start_run(uuid,text)','archive_ingest(uuid,jsonb)','archive_finish_run(uuid,text,jsonb,jsonb)',
 'archive_log_error(uuid,uuid,text,integer,text,text)','archive_links_due(integer)','archive_record_link_checks(jsonb)','archive_alias_index()',
 'archive_websub_upsert(text,text,text,text,integer,uuid)','archive_websub_get(text)','archive_websub_due(integer)','archive_record_project_update(uuid,text,jsonb)','archive_prune()'];
test('privileges: RLS on every table, no policy, no anon/authenticated privilege; functions callable only by their audience',async()=>{
 for(const t of TABLES){
  const [r]=await rows(db,`select c.relrowsecurity rls,(select count(*)::int from pg_policies p where p.tablename=c.relname) policies,
   has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') anon,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') auth,
   has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') svc from pg_class c where c.oid=$1::regclass`,['public.'+t]);
  assert.deepEqual(r,{rls:true,policies:0,anon:false,auth:false,svc:true},t);
  for(const role of ['anon','authenticated'])assert.equal(await code(q(db,role,EDITOR,`select * from public.${t} limit 1`)),'42501',`${role} reads ${t}`);
 }
 const can=(role,fn)=>rows(db,`select has_function_privilege($1,$2,'EXECUTE') x`,[role,'public.'+fn]).then(r=>r[0].x);
 for(const fn of SERVICE_FNS)assert.deepEqual([await can('anon',fn),await can('authenticated',fn),await can('service_role',fn)],[false,false,true],fn);
 for(const fn of ADMIN_FNS)assert.deepEqual([await can('anon',fn),await can('authenticated',fn)],[false,true],fn);
 for(const fn of ['archive_search(text,jsonb,text,integer,integer)','archive_public_stats()'])assert.deepEqual([await can('anon',fn),await can('authenticated',fn)],[true,true],fn);
 // Helpers stay internal (no RPC surface for clients).
 const exposed=await rows(db,`select p.oid::regprocedure::text f from pg_proc p join pg_namespace s on s.oid=p.pronamespace
  where s.nspname='public' and p.proname like 'archive%' and has_function_privilege('anon',p.oid,'EXECUTE') order by 1`);
 assert.deepEqual(exposed.map(r=>r.f),['archive_public_stats()','archive_search(text,jsonb,text,integer,integer)']);
 const noPath=await rows(db,`select p.proname from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.prosecdef
  and not exists(select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')`);
 assert.deepEqual(noPath,[],'every security definer function sets search_path');
 for(const role of ['anon','authenticated'])for(const s of [`select public.archive_ingest(null,'[]')`,`select public.archive_prune()`,`select public.archive_websub_get('https://x.example')`,
  `select * from public.archive_claim_due_rules(1,'me')`])assert.equal(await code(q(db,role,ADMIN,s)),'42501',`${role}: ${s}`);
 assert.equal(await code(q(db,'anon',null,`select public.archive_admin_dashboard()`)),'42501');
 assert.equal(await code(q(db,'anon',null,`update public.public_archive_projects set name_en='x'`)),'42501');
});

test('roles: is_app_admin is admin+editor, archive_role names the role, and the admin RPC matrix holds for every RPC',async()=>{
 const who=async u=>(await q(db,'authenticated',u,`select public.is_app_admin() a,public.archive_role() r`))[0];
 assert.deepEqual(await who(ADMIN),{a:true,r:'admin'});assert.deepEqual(await who(EDITOR),{a:true,r:'editor'});
 assert.deepEqual(await who(RESEARCHER),{a:false,r:'researcher'});assert.deepEqual(await who(USER),{a:false,r:null});
 const Z='00000000-0000-4000-8000-000000000000';
 const calls=[
  ['dashboard',`select public.archive_admin_dashboard()`,[],'editor'],
  ['list_candidates',`select public.archive_admin_list_candidates()`,[],'editor'],
  ['review_candidate',`select public.archive_admin_review_candidate($1,'ignore','{}')`,[Z],'editor'],
  ['upsert_project',`select public.archive_admin_upsert_project('{"name_en":"Matrix check"}')`,[],'editor'],
  ['set_visibility',`select public.archive_admin_set_visibility($1,'hidden',null)`,[Z],'editor'],
  ['merge_projects',`select public.archive_admin_merge_projects($1,$1)`,[Z],'editor'],
  ['add_source',`select public.archive_admin_add_source($1,'{}','{}')`,[Z],'editor'],
  ['set_media',`select public.archive_admin_set_media($1,'{}')`,[Z],'editor'],
  ['remove_media',`select public.archive_admin_remove_media($1)`,[Z],'editor'],
  ['list_projects',`select public.archive_admin_list_projects()`,[],'editor'],
  ['list_updates',`select public.archive_admin_list_updates()`,[],'editor'],
  ['resolve_update',`select public.archive_admin_resolve_update($1,'dismiss')`,[Z],'editor'],
  ['list_runs',`select public.archive_admin_list_runs()`,[],'editor'],
  ['list_errors',`select public.archive_admin_list_errors()`,[],'editor'],
  ['list_rules',`select public.archive_admin_list_rules()`,[],'editor'],
  ['list_keywords',`select public.archive_admin_list_keywords()`,[],'editor'],
  ['upsert_rule',`select public.archive_admin_upsert_rule('{"kind":"rss","name":"Matrix feed","url":"https://feed.example.org/rss"}')`,[],'admin'],
  ['upsert_keyword',`select public.archive_admin_upsert_keyword('{"term":"media facade","language":"en","polarity":"positive"}')`,[],'admin'],
  ['set_settings',`select public.archive_admin_set_settings('{}')`,[],'admin'],
  ['add_assessment',`select public.archive_research_add_assessment($1,'significance','"high"','high',null,null)`,[Z],'researcher']];
 assert.equal(calls.length,ADMIN_FNS.length);
 const allowed={editor:['admin','editor'],admin:['admin'],researcher:['admin','editor','researcher']};
 for(const [name,s,p,min] of calls)for(const [u,role] of [[ADMIN,'admin'],[EDITOR,'editor'],[RESEARCHER,'researcher'],[USER,null]]){
  const c=await code(q(db,'authenticated',u,s,p));
  if(allowed[min].includes(role))assert.notEqual(c,'42501',`${name} as ${role}`);else assert.equal(c,'42501',`${name} as ${role||'plain user'}`);
 }
});

// ---- ingest ----------------------------------------------------------------------------------------------------
let LWT,ZUR;
test('ingest: the six dedupe rules in order, first hit wins; a project match becomes one open new_source update',async()=>{
 LWT=await upsert({name_original:'롯데월드타워 미디어파사드',name_en:'Lotte World Tower Media Facade',aliases:['LWT facade'],country_iso2:'KR',city:'Seoul',
  latitude:37.5126,longitude:127.1025,wikidata_qid:'Q1001',official_url:'https://www.lwt-facade.example.org/facade/',project_type:'media_facade'});
 ZUR=await upsert({name_en:'Zurich Lake Light Wall',country_iso2:'CH',city:'Zurich',wikidata_qid:'Q2002'});
 const r1=item({keys:{wikidata_qid:'Q1001'}});
 const first=item({keys:{wikidata_qid:'Q2002',alias_project_id:LWT}});
 const r2=item({url:'http://lwt-facade.example.org/facade?utm_medium=rss#top',canonical_url:'https://lwt-facade.example.org/facade'});
 const r3=item({keys:{alias_project_id:LWT}});
 const r4=item({keys:{normalized_name:'Lotte-World  Tower media facade'},detected:{country_iso2:'KR',city:'seoul'}});
 const r5=item({detected:{name:'Lotte World Tower facade',latitude:37.5129,longitude:127.1027}});
 const far=item({detected:{name:'Lotte World Tower facade',latitude:37.53,longitude:127.1027}});
 const out=await ingest([r1,first,r2,r3,r4,r5,far]);
 assert.deepEqual(Object.keys(out).sort(),['duplicates','ignored','items','kept','matched_projects','new_candidates']);
 assert.deepEqual(out.items.map(i=>[i.outcome,i.project_id??null]),[['matched_project',LWT],['matched_project',ZUR],['duplicate_hit',LWT],
  ['matched_project',LWT],['matched_project',LWT],['matched_project',LWT],['new_candidate',null]]);
 assert.deepEqual([out.kept,out.new_candidates,out.matched_projects,out.duplicates,out.ignored],[7,1,5,1,0]);
 const ups=await rows(db,`select project_id,kind,status,detail from public.archive_project_updates where status='open' order by project_id=$1 desc`,[LWT]);
 assert.equal(ups.length,2,'one open row per project');
 assert.deepEqual([ups[0].kind,ups[0].detail.count,ups[0].detail.hits.map(h=>h.canonical_url)],['new_source',4,[r1,r3,r4,r5].map(i=>i.canonical_url)]);
 assert.equal((await project(LWT)).update_status,'new_info');
 assert.ok((await project(LWT)).last_collected_at,'a match marks the project as collected');
 // The official-URL hit is recorded (idempotency) but is not new information.
 assert.equal((await rows(db,`select count(*)::int n from public.archive_candidate_hits where project_id=$1`,[LWT]))[0].n,5);
});

test('ingest: identity rules against candidates, normalized-name rule 4, and idempotency (same provider and URL only counts)',async()=>{
 const a=item({keys:{wikidata_qid:'Q3003'}});
 const sameQid=item({keys:{wikidata_qid:'Q3003'}});
 const otherProvider={...a,provider:'rss',external_id:null,keys:{...a.keys,wikidata_qid:null}};
 const n1=item({keys:{normalized_name:'Shibuya Vision Wall'},detected:{country_iso2:'JP',city:'Tokyo'}});
 const n2=item({keys:{normalized_name:'shibuya-vision wall'},detected:{country_iso2:'JP',city:'tokyo'}});
 const out=await ingest([a,sameQid,otherProvider,n1,n2]);
 assert.deepEqual(out.items.map(i=>i.outcome),['new_candidate','attached_candidate','duplicate_hit','new_candidate','attached_candidate']);
 const [ca,cn]=[out.items[0].candidate_id,out.items[3].candidate_id];
 assert.deepEqual(out.items.map(i=>i.candidate_id),[ca,ca,ca,cn,cn]);
 assert.equal((await candidate(ca)).seen_count,3);
 assert.equal((await rows(db,`select count(*)::int n from public.archive_candidate_hits where candidate_id=$1`,[ca]))[0].n,3);
 const again=await ingest([a,n2]);
 assert.deepEqual(again.items.map(i=>[i.outcome,i.candidate_id]),[['duplicate_hit',ca],['duplicate_hit',cn]]);
 assert.deepEqual([again.kept,again.new_candidates,again.duplicates],[2,0,2]);
 assert.equal((await candidate(ca)).seen_count,4,'a repeat only bumps the sighting');
 assert.equal((await rows(db,`select count(*)::int n from public.archive_candidate_hits where canonical_url=$1`,[a.canonical_url]))[0].n,2,'one hit per provider');
});

test('ingest: story clustering (rule 6) by story key and by title similarity within 14 days, with the independent-domain bonus',async()=>{
 const title='Giant anamorphic media facade unveiled at Shibuya Crossing tower';
 const s1=item({title,classification:{score:70}});
 const s2=item({title:title+' - Example Daily',url:'https://daily.example.net/a',canonical_url:'https://daily.example.net/a'});
 const s3=item({title:'Shibuya crossing gets a giant anamorphic media facade unveiled at tower',url:'https://www.third.example.org/b',canonical_url:'https://third.example.org/b'});
 const sameStory=item({keys:{story_key:s1.keys.story_key}});
 const out=await ingest([s1,s2,s3,sameStory]);
 const c=out.items[0].candidate_id;
 assert.deepEqual(out.items.map(i=>[i.outcome,i.candidate_id]),[['new_candidate',c],['attached_candidate',c],['attached_candidate',c],['attached_candidate',c]]);
 const cand=await candidate(c);
 assert.equal(cand.seen_count,4);
 // round(0.6 × 70 + 0.4 × min(100, 55 + min(20, 10 × (4 domains − 1)))) = 72
 assert.equal(cand.confidence,72);
 // Older than 14 days, or no longer open, the story is not extended.
 await db.query(`update public.archive_candidate_hits set fetched_at=now()-interval '15 days' where candidate_id=$1`,[c]);
 await db.query(`update public.archive_candidates set last_seen_at=now()-interval '15 days' where id=$1`,[c]);
 const late=await ingest([item({title:title+' (update)'}),item({keys:{story_key:s1.keys.story_key}})]);
 assert.deepEqual(late.items.map(i=>i.outcome),['new_candidate','new_candidate']);
});

test('ingest: below auto_ignore_below an item becomes an auto_ignored candidate, skips rules 3–6 and stays out of the queue',async()=>{
 const before=(await rows(db,`select detail from public.archive_project_updates where project_id=$1 and status='open'`,[LWT]))[0].detail.count;
 const low=item({classification:{score:20,label:'irrelevant'},keys:{alias_project_id:LWT}});
 const mid=item({classification:{score:45,label:'uncertain'}});
 const out=await ingest([low,mid]);
 assert.deepEqual(out.items.map(i=>i.outcome),['ignored','new_candidate']);
 assert.deepEqual([out.ignored,out.new_candidates,out.kept],[1,1,2]);
 assert.equal((await candidate(out.items[0].candidate_id)).status,'auto_ignored');
 assert.equal((await candidate(out.items[1].candidate_id)).status,'uncertain');
 assert.equal((await rows(db,`select detail from public.archive_project_updates where project_id=$1 and status='open'`,[LWT]))[0].detail.count,before,'no project update from noise');
 const queue=(await ed(`select x from public.archive_admin_list_candidates() x`)).map(r=>r.x.id);
 assert.ok(!queue.includes(out.items[0].candidate_id)&&queue.includes(out.items[1].candidate_id));
 const ignored=(await ed(`select x from public.archive_admin_list_candidates('auto_ignored') x`)).map(r=>r.x.id);
 assert.ok(ignored.includes(out.items[0].candidate_id));
});

test('ingest: invalid items are skipped, counted as ignored and logged with stage validate',async()=>{
 const run=(await svc(db,`select public.archive_start_run($1,'admin') id`,[RULE]))[0].id;
 const bad=[item({excerpt:'x'.repeat(301)}),item({url:'ftp://example.com/x'}),item({keys:{story_key:''}}),item({classification:{label:'facade'}}),
  item({raw:{blob:'y'.repeat(7000)}}),item({detected:{latitude:91,longitude:0}}),item({language:'English'}),item({rule_id:'00000000-0000-4000-8000-000000000000'}),'not an item'];
 const good=item();
 const out=await ingest([...bad,good],run);
 assert.deepEqual([out.ignored,out.kept,out.new_candidates],[bad.length,1,1]);
 assert.deepEqual(out.items.map(i=>i.outcome),[...bad.map(()=>'ignored'),'new_candidate']);
 const errs=await rows(db,`select stage,message,url,rule_id from public.archive_run_errors where run_id=$1 order by at,message`,[run]);
 assert.equal(errs.length,bad.length);assert.ok(errs.every(e=>e.stage==='validate'&&e.rule_id===RULE&&e.message.startsWith('invalid item: ')));
 assert.ok(errs.some(e=>/excerpt/.test(e.message))&&errs.some(e=>/canonical_url|url/.test(e.message))&&errs.some(e=>/story_key/.test(e.message)));
 const [r]=await rows(db,`select kept,new_candidates,ignored,errors from public.archive_runs where id=$1`,[run]);
 assert.deepEqual(r,{kept:1,new_candidates:1,ignored:bad.length,errors:bad.length},'ingest accumulates into its run');
 await assert.rejects(ingest({not:'an array'}),/must be a JSON array/);
});

// ---- review ----------------------------------------------------------------------------------------------------
test('review: approve_new needs a name, a country and a source; it creates an editor-reviewed project with honest field states',async()=>{
 const it=item({title:'Tokyo Wave Facade opens',detected:{country_iso2:'JP',city:'Tokyo',latitude:35.66,longitude:139.70},publisher:'Spoon & Tamago'});
 const c=(await ingest([it])).items[0].candidate_id;
 assert.match(await code(review(c,'approve_new',{name_en:'Tokyo Wave Facade'})),/22023/,'a country is required');
 assert.match(await code(review(c,'approve_new',{country_iso2:'JP'})),/22023/,'a name is required');
 const r=await review(c,'approve_new',{name_en:'Tokyo Wave Facade',country_iso2:'jp',city:'Tokyo',project_type:'media_facade',technology:['led_rgb'],publish:true,supports:['name_en','city'],note:'checked'});
 assert.deepEqual([r.ok,r.status],[true,'approved']);
 const p=await project(r.project_id);
 assert.deepEqual([p.name_original,p.name_en,p.country_iso2,p.region,p.city,p.visibility,p.review_status,p.record_origin],
  ['Tokyo Wave Facade','Tokyo Wave Facade','JP','east_asia','Tokyo','published','editor_verified','auto_collected']);
 assert.equal(p.latitude,null,"a news item's gazetteer location is not carried over");
 assert.deepEqual(Object.fromEntries(Object.entries(p.field_status).map(([k,v])=>[k,v.state])),
  {name_en:'editor_verified',country_iso2:'editor_verified',city:'editor_verified',project_type:'editor_verified',technology:'editor_verified',region:'derived',name_original:'derived'});
 assert.ok(p.last_verified_at&&p.first_collected_at);
 const src=await rows(db,`select s.url,s.publisher,s.source_kind,s.reliability,ps.supports from public.archive_project_sources ps join public.archive_sources s on s.id=ps.source_id where ps.project_id=$1`,[p.id]);
 assert.deepEqual(src,[{url:it.url,publisher:'Spoon & Tamago',source_kind:'news',reliability:55,supports:['city','name_en']}]);
 const cand=await candidate(c);
 assert.deepEqual([cand.status,cand.matched_project_id,cand.reviewed_by,cand.review_note],['approved',p.id,EDITOR,'checked']);
 const audit=await rows(db,`select action,actor from public.archive_audit_log where entity_id in ($1,$2) order by at,action`,[c,p.id]);
 assert.deepEqual(audit.map(a=>a.action).sort(),['candidate.approve_new','project.create']);assert.ok(audit.every(a=>a.actor===EDITOR));
 assert.match(await code(review(c,'approve_new',{name_en:'Again',country_iso2:'JP'})),/22023/,'a decided candidate must be reopened first');
 // A later hit for the approved candidate's URL goes to its project.
 const later=await ingest([{...it,provider:'rss'}]);
 assert.deepEqual([later.items[0].outcome,later.items[0].project_id],['duplicate_hit',p.id]);
});

test('review: a Wikidata candidate keeps what Wikidata states as source_reported, with the source id',async()=>{
 const it=item({provider:'wikidata',source_kind:'wikidata',reliability:70,url:'https://www.wikidata.org/wiki/Q4004',canonical_url:'https://www.wikidata.org/wiki/Q4004',
  title:'Kunsthaus Graz BIX facade',detected:{name:'Kunsthaus Graz BIX',country_iso2:'AT',city:'Graz',latitude:47.0714,longitude:15.4343},keys:{wikidata_qid:'Q4004'}});
 const c=(await ingest([it])).items[0].candidate_id;
 const r=await review(c,'approve_new',{name_en:'BIX Media Facade',reported:{year_installed:2003}});
 const p=await project(r.project_id);
 const states=Object.fromEntries(Object.entries(p.field_status).map(([k,v])=>[k,v.state]));
 assert.deepEqual(states,{name_en:'editor_verified',name_original:'source_reported',wikidata_qid:'source_reported',country_iso2:'source_reported',city:'source_reported',
  latitude:'source_reported',longitude:'source_reported',year_installed:'source_reported',region:'derived'});
 const [{id:sid}]=await rows(db,`select s.id from public.archive_sources s join public.archive_project_sources ps on ps.source_id=s.id where ps.project_id=$1`,[p.id]);
 assert.equal(p.field_status.wikidata_qid.source_id,sid);assert.equal(p.field_status.year_installed.source_id,sid);
 assert.deepEqual([p.wikidata_qid,p.name_original,p.year_installed,p.visibility],['Q4004','Kunsthaus Graz BIX',2003,'draft']);
 // From now on the QID is a known project (rule 1).
 assert.equal((await ingest([item({keys:{wikidata_qid:'Q4004'}})])).items[0].project_id,p.id);
});

test('review: attach, merge, reject (note required), ignore and reopen',async()=>{
 const [a,b,m,x,y]=(await ingest([item(),item(),item(),item(),item()])).items.map(i=>i.candidate_id);
 const at=await review(a,'attach',{project_id:ZUR,supports:['city']});
 assert.deepEqual([at.status,at.project_id],['merged',ZUR]);
 assert.equal((await rows(db,`select count(*)::int n from public.archive_project_sources where project_id=$1`,[ZUR]))[0].n,1);
 const mg=await review(m,'merge',{into_candidate_id:b});
 assert.deepEqual([mg.status,mg.duplicate_of],['duplicate',b]);
 const [listed]=(await ed(`select x from public.archive_admin_list_candidates('all',null,null,200) x`)).map(r=>r.x).filter(c=>c.id===b);
 assert.equal(listed.hits.length,2,'the target lists the merged candidate’s hits');assert.equal(listed.total_seen,2);
 assert.match(await code(review(b,'merge',{into_candidate_id:b})),/22023/);
 assert.match(await code(review(x,'reject',{})),/22023/,'reject needs a note');
 assert.equal((await review(x,'reject',{note:'vendor advertisement'})).status,'rejected');
 assert.equal((await review(y,'ignore')).status,'auto_ignored');
 assert.equal((await candidate(y)).reviewed_by,EDITOR);
 // An editor's decision is not undone by a new, better hit for the same story.
 const yHit=(await rows(db,`select canonical_url,provider from public.archive_candidate_hits where candidate_id=$1`,[y]))[0];
 await ingest([item({url:yHit.canonical_url,canonical_url:yHit.canonical_url,provider:'rss',classification:{score:95}})]);
 assert.equal((await candidate(y)).status,'auto_ignored');
 for(const id of [a,m,x,y]){const r=await review(id,'reopen');assert.ok(['needs_review','uncertain'].includes(r.status),r.status)}
 assert.deepEqual([(await candidate(m)).duplicate_of,(await candidate(a)).matched_project_id],[null,null]);
 assert.equal((await rows(db,`select count(*)::int n from public.archive_project_sources where project_id=$1`,[ZUR]))[0].n,1,'sources an editor attached stay');
 assert.match(await code(review(a,'reopen')),/22023/,'already open');
 assert.match(await code(review(a,'publish')),/22023/,'unknown action');
 assert.equal((await rows(db,`select count(*)::int n from public.archive_audit_log where entity='archive_candidates' and action like 'candidate.%'`))[0].n>=10,true);
});

test('projects: upsert validates input; only submitted fields become editor_verified; publishing needs an editor review',async()=>{
 for(const bad of [{name_en:'X',official_url:'javascript:alert(1)'},{name_en:'X',year_installed:1850},{name_en:'X',latitude:95,longitude:0},{name_en:'X',project_type:'billboard'},
  {name_en:'X',technology:['led_rgb','plasma']},{name_en:'X',summary_en:'s'.repeat(4001)},{name_en:'X',color:'red'},{name_en:'X',country_iso2:'Korea'},{}])
  assert.notEqual(await code(upsert(bad)),'ok',J(bad));
 const id=await upsert({name_en:'Draft Wall',country_iso2:'DE',city:'Berlin',year_installed:2019,internal_note:'call the operator'});
 let p=await project(id);
 assert.deepEqual(Object.keys(p.field_status).sort(),['city','country_iso2','name_en','name_original','region','year_installed']);
 assert.deepEqual([p.review_status,p.visibility,p.record_origin,p.created_by],['unreviewed','draft','editor_created',EDITOR]);
 assert.match(await code(q(db,'authenticated',EDITOR,`select public.archive_admin_set_visibility($1,'published','go')`,[id])),/22023/,'no review yet');
 assert.match(await code(upsert({id,visibility:'published'})),/22023/);
 await upsert({id,year_installed:null,building_name:'Haus am See',reviewed:true});
 p=await project(id);
 assert.equal(p.year_installed,null);assert.equal(p.field_status.year_installed,undefined,'a cleared field is unverified again');
 assert.equal(p.field_status.building_name.state,'editor_verified');assert.equal(p.field_status.city.state,'editor_verified','untouched fields keep their state');
 assert.deepEqual([p.review_status,!!p.last_verified_at],['editor_verified',true]);
 const v=(await q(db,'authenticated',EDITOR,`select public.archive_admin_set_visibility($1,'published','reviewed by phone') r`,[id]))[0].r;
 assert.deepEqual([v.visibility,v.previous],['published','draft']);
 const [a]=await rows(db,`select after from public.archive_audit_log where entity_id=$1 and action='project.set_visibility'`,[id]);assert.equal(a.after.note,'reviewed by phone');
 // A round trip of the admin listing (with its read-only keys) is accepted.
 const [listed]=(await ed(`select x from public.archive_admin_list_projects($1) x`,[id])).map(r=>r.x);
 assert.equal(listed.id,id);await upsert({...listed,summary_en:'A lakeside wall.'});
 // Sources: a supported field with a value becomes source_reported, a verified one keeps its state.
 const sid=(await ed(`select public.archive_admin_add_source($1,$2::jsonb,$3) id`,[id,J({url:'https://www.berlin.example.de/haus',source_kind:'public_agency',title:'Haus am See'}),['building_name','envelope_type','year_installed']]))[0].id;
 p=await project(id);
 assert.equal(p.field_status.building_name.state,'editor_verified');assert.equal(p.field_status.building_name.source_id,sid);
 assert.equal(p.field_status.envelope_type,undefined,'no value, no state');
 assert.equal((await rows(db,`select reliability from public.archive_sources where id=$1`,[sid]))[0].reliability,85,'base reliability by kind');
});

test('projects: merge moves sources, credits, media, assessments and aliases; the merged project is hidden and redirects matches',async()=>{
 const keep=await upsert({name_en:'Galleria Centercity',country_iso2:'KR',city:'Cheonan',credits:[{role:'architect',name:'UNStudio'}]});
 const drop=await upsert({name_original:'갤러리아 센터시티',name_en:'Galleria Centercity Facade',country_iso2:'KR',city:'Cheonan',wikidata_qid:'Q5005',
  credits:[{role:'architect',name:'UNStudio'},{role:'lighting_designer',name:'Arup Lighting'}]});
 await ed(`select public.archive_admin_add_source($1,$2::jsonb,'{}')`,[drop,J({url:'https://www.unstudio.example.com/galleria',source_kind:'official'})]);
 const mid=(await ed(`select public.archive_admin_set_media($1,$2::jsonb) id`,[drop,J({url:'https://upload.wikimedia.org/g.jpg',license:'CC BY-SA 4.0',author:'Kim',rights_status:'cleared',is_primary:true})]))[0].id;
 await q(db,'authenticated',RESEARCHER,`select public.archive_research_add_assessment($1,'installation_method','"led_linear_pixel"','medium','site visit',null)`,[drop]);
 assert.equal((await ed(`select public.archive_admin_merge_projects($1,$2) id`,[keep,drop]))[0].id,keep);
 const k=await project(keep),d=await project(drop);
 assert.deepEqual([d.visibility,d.merged_into,d.wikidata_qid],['hidden',keep,null]);
 assert.deepEqual([k.wikidata_qid,k.aliases],['Q5005',['Galleria Centercity Facade','갤러리아 센터시티']]);
 assert.deepEqual((await rows(db,`select role,name from public.archive_credits where project_id=$1 order by role`,[keep])).map(c=>c.role+':'+c.name),['architect:UNStudio','lighting_designer:Arup Lighting']);
 assert.equal((await rows(db,`select count(*)::int n from public.archive_project_sources where project_id=$1`,[keep]))[0].n,1);
 assert.equal((await rows(db,`select project_id from public.archive_media where id=$1`,[mid]))[0].project_id,keep);
 assert.equal((await rows(db,`select count(*)::int n from public.archive_assessments where project_id=$1`,[keep]))[0].n,1);
 for(const t of ['archive_credits','archive_project_sources','archive_media','archive_assessments'])
  assert.equal((await rows(db,`select count(*)::int n from public.${t} where project_id=$1`,[drop]))[0].n,0,t);
 assert.equal((await ingest([item({keys:{alias_project_id:drop}})])).items[0].project_id,keep,'a stale alias index entry reaches the kept project');
 assert.match(await code(q(db,'authenticated',EDITOR,`select public.archive_admin_set_visibility($1,'published',null)`,[drop])),/22023/);
 assert.match(await code(ed(`select public.archive_admin_merge_projects($1,$2)`,[keep,drop])),/22023/,'only once');
});

// ---- public view, search, stats --------------------------------------------------------------------------------
let PUB;
test('public view: published rows only, with sources, credits, cleared and unbroken media, and assessments without assessor',async()=>{
 PUB=await upsert({name_original:'Kunsthaus Graz BIX',name_en:'BIX Facade',country_iso2:'AT',city:'Graz',project_type:'media_facade',installation_method:'led_backlit_cladding',
  envelope_type:'membrane_etfe',technology:['led_mono','pixel_points'],year_installed:2003,credits:[{role:'media_artist',name:'realities:united'}],
  internal_note:'operator contact: secret',reviewed:true,visibility:'published'});
 const sid=(await ed(`select public.archive_admin_add_source($1,$2::jsonb,$3) id`,[PUB,J({url:'https://www.realities-united.example.de/bix',source_kind:'official',title:'BIX',license:'© realities:united'}),['technology']]))[0].id;
 const media=async(url,o)=>(await ed(`select public.archive_admin_set_media($1,$2::jsonb) id`,[PUB,J({url,license:'CC BY 4.0',author:'Lee',...o})]))[0].id;
 await media('https://upload.wikimedia.org/a.jpg',{rights_status:'cleared',is_primary:true});await media('https://upload.wikimedia.org/b.jpg',{rights_status:'pending'});
 const broken=await media('https://upload.wikimedia.org/c.jpg',{rights_status:'cleared'});
 await db.query(`update public.archive_media set link_state='broken' where id=$1`,[broken]);
 await db.query(`update public.archive_sources set link_state='broken' where id=$1`,[sid]);
 await q(db,'authenticated',RESEARCHER,`select public.archive_research_add_assessment($1,'technology','["led_mono"]','high','archival photos','checked 2003 press kit')`,[PUB]);
 const [v]=await publicView('id=$1',[PUB]);
 for(const k of ['created_by','updated_by','internal_note','merged_into','official_url_failures'])assert.ok(!(k in v),k);
 assert.deepEqual(v.media.map(m=>m.url),['https://upload.wikimedia.org/a.jpg']);
 assert.deepEqual(Object.keys(v.media[0]).sort(),['attribution','author','is_primary','license','license_url','page_url','url']);
 assert.deepEqual(Object.keys(v.sources[0]).sort(),['id','kind','language','last_checked_at','license','link_state','published_at','publisher','reliability','retrieved_at','supports','title','url']);
 assert.deepEqual([v.sources[0].kind,v.sources[0].reliability,v.sources[0].supports],['official',60,['technology']],'a broken link costs 30 points');
 assert.deepEqual(v.credits,[{role:'media_artist',name:'realities:united',name_en:null,wikidata_qid:null}]);
 assert.deepEqual(Object.keys(v.assessments[0]).sort(),['attribute','confidence','created_at','method','note','value']);
 assert.equal(v.review_status,'researcher_assessed');assert.equal(v.field_status.technology.state,'researcher_assessed');
 assert.ok(!J(v).includes(RESEARCHER)&&!J(v).includes(EDITOR)&&!J(v).includes('secret'),'no identities or internal notes');
 const slugs=(await publicView()).map(r=>r.id);
 assert.ok(!slugs.includes(LWT),'draft');assert.ok(slugs.includes(PUB));
 assert.ok((await publicView()).every(r=>r.visibility==='published'));
 await ed(`select public.archive_admin_set_visibility($1,'hidden','rights complaint')`,[PUB]);
 assert.equal((await publicView('id=$1',[PUB])).length,0);
 await ed(`select public.archive_admin_set_visibility($1,'published',null)`,[PUB]);
});

test('archive_search: every filter and sort; archive_public_stats counts the published set',async()=>{
 const pub=o=>upsert({...o,reviewed:true,visibility:'published'});
 const S={
  seoul:await pub({name_en:'Seoul Square Media Canvas',country_iso2:'KR',city:'Seoul',project_type:'media_facade',installation_method:'led_linear_pixel',envelope_type:'glass_curtain_wall',technology:['led_rgb'],operating_status:'operating',year_installed:2009}),
  tokyo:await pub({name_en:'Tokyo Station Projection',country_iso2:'JP',city:'Tokyo',project_type:'projection_mapping',installation_method:'projection',envelope_type:'historic_facade',technology:['laser_projector'],operating_status:'event_based',year_installed:2012}),
  nyc:await pub({name_en:'Times Square Screen',country_iso2:'US',city:'New York',project_type:'urban_screen',installation_method:'led_cabinet_screen',technology:['led_rgb','realtime_data'],operating_status:'operating',year_completed:2019}),
  lyon:await pub({name_en:'Lyon Light Wall',country_iso2:'FR',city:'Lyon',project_type:'light_art',operating_status:'seasonal',record_origin:'curated'})};
 await q(db,'authenticated',RESEARCHER,`select public.archive_research_add_assessment($1,'significance','"landmark"','high',null,null)`,[S.tokyo]);
 const search=(q_,f={},sort='relevance',limit=200,off=0)=>q(db,'anon',null,`select id from public.archive_search($1,$2::jsonb,$3,$4,$5)`,[q_,J(f),sort,limit,off]).then(r=>r.map(x=>x.id));
 const only=ids=>ids.filter(i=>Object.values(S).includes(i));
 const name=Object.fromEntries(Object.entries(S).map(([k,v])=>[v,k]));
 const is=async(f,expect,q_=null)=>assert.deepEqual(only(await search(q_,f)).map(i=>name[i]).sort(),expect.sort(),J(f)+(q_||''));
 await is({region:'east_asia'},['seoul','tokyo']);await is({region:['europe','north_america']},['nyc','lyon']);
 await is({country_iso2:'jp'},['tokyo']);await is({city:'new york'},['nyc']);await is({project_type:'urban_screen'},['nyc']);
 await is({installation_method:['projection','led_linear_pixel']},['seoul','tokyo']);await is({envelope_type:'historic_facade'},['tokyo']);
 await is({technology:['realtime_data','laser_projector']},['tokyo','nyc']);await is({operating_status:'seasonal'},['lyon']);
 await is({year_from:2010,year_to:2015},['tokyo']);await is({year_from:'2015'},['nyc']);await is({origin:'curated'},['lyon']);
 await is({review_status:'researcher_assessed'},['tokyo']);await is({region:[],unknown_key:1,city:null},['seoul','tokyo','nyc','lyon']);
 await is({},['seoul'],'seoul square');await is({},['lyon'],'light wall');
 assert.equal(only(await search('Times Square Screen'))[0],S.nyc,'relevance: the exact name first');
 // Two statements: changing first_collected_at is an edit, which the trigger stamps with now().
 await db.query(`update public.archive_projects set first_collected_at=now()-(case id when $1::uuid then 1 when $2::uuid then 2 when $3::uuid then 3 else 4 end)*interval '1 day' where id in ($1,$2,$3,$4)`,[S.lyon,S.seoul,S.nyc,S.tokyo]);
 await db.query(`update public.archive_projects set updated_at=now()+(case id when $1::uuid then 4 when $2::uuid then 3 when $3::uuid then 2 else 1 end)*interval '1 minute' where id in ($1,$2,$3,$4)`,[S.lyon,S.seoul,S.nyc,S.tokyo]);
 const order=async s=>only(await search(null,{},s)).map(i=>name[i]);
 assert.deepEqual(await order('updated'),['lyon','seoul','nyc','tokyo']);
 assert.deepEqual(await order('newest'),['lyon','seoul','nyc','tokyo']);
 assert.deepEqual(await order('year_desc'),['nyc','tokyo','seoul','lyon']);
 assert.deepEqual(await order('year_asc'),['seoul','tokyo','nyc','lyon']);
 assert.deepEqual(await order('name'),['lyon','seoul','nyc','tokyo'],'Lyon, Seoul, Times Square, Tokyo');
 assert.equal((await order('relevance'))[0],'tokyo','without a query: researcher-assessed first');
 assert.equal(await code(search(null,{},'popular')),'22023');
 const page=await search(null,{},'name',2,1);assert.equal(page.length,2);
 const stats=(await q(db,'anon',null,`select public.archive_public_stats() s`))[0].s;
 const all=await publicView();
 const count=f=>all.reduce((m,p)=>{for(const k of [].concat(f(p)))m[k]=(m[k]||0)+1;return m},{});
 assert.equal(stats.total,all.length);
 assert.deepEqual(stats.by_region,count(p=>p.region??'unknown'));assert.deepEqual(stats.by_country,count(p=>p.country_iso2??'unknown'));
 assert.deepEqual(stats.by_year,count(p=>String(p.year_installed??p.year_completed??p.year_operating_since??'unknown')));
 assert.deepEqual(stats.by_project_type,count(p=>p.project_type??'unknown'));assert.deepEqual(stats.by_installation_method,count(p=>p.installation_method??'unknown'));
 assert.deepEqual(stats.by_technology,count(p=>p.technology.length?p.technology:'unknown'));assert.deepEqual(stats.by_review_status,count(p=>p.review_status));
 assert.ok(stats.by_country.JP>=1&&stats.by_technology.led_rgb>=2&&stats.by_review_status.researcher_assessed>=1);
 assert.deepEqual(stats.settings,{auto_list_structured:true});assert.ok(stats.generated_at);
});

// ---- rules and runs --------------------------------------------------------------------------------------------
test('rules: claim respects enabled, next_run_at, backoff and running claims, and never double-claims',async()=>{
 const d=await database();
 const [admin]=(await rows(d,`insert into auth.users(email) values('a@t') returning id`)).map(r=>r.id);
 await d.query(`insert into public.app_admins(user_id,role) values($1,'admin')`,[admin]);
 const rule=o=>q(d,'authenticated',admin,`select public.archive_admin_upsert_rule($1::jsonb) id`,[J(o)]).then(r=>r[0].id);
 const due=await rule({kind:'rss',name:'Dezeen',url:'https://www.dezeen.example.com/feed'});
 const later=await rule({kind:'rss',name:'Later',url:'https://later.example.com/feed',next_run_at:new Date(Date.now()+H).toISOString()});
 const off=await rule({kind:'gdelt',name:'Off',query:'media facade',enabled:false});
 const keyed=await rule({kind:'brave',name:'Brave',query:'media facade'});
 const backing=await rule({kind:'rss',name:'Backing off',url:'https://b.example.com/feed'});
 const push=await rule({kind:'websub',name:'Push',url:'https://p.example.com/feed'});
 await d.query(`update public.archive_collection_rules set backoff_until=now()+interval '1 hour' where id=$1`,[backing]);
 assert.equal((await rows(d,`select enabled from public.archive_collection_rules where id=$1`,[keyed]))[0].enabled,false,'a metered source starts off');
 const claim=(owner,limit=6,ids=null)=>svc(d,`select id,last_status,claimed_by from public.archive_claim_due_rules($1,$2,$3)`,[limit,owner,ids]);
 assert.deepEqual((await claim('run-a')).map(r=>[r.id,r.last_status,r.claimed_by]),[[due,'running','run-a']]);
 assert.deepEqual(await claim('run-b'),[],'a running rule is not claimed twice');
 assert.equal(await code(claim('')),'22023');
 await d.query(`update public.archive_collection_rules set claimed_at=now()-interval '31 minutes' where id=$1`,[due]);
 assert.deepEqual((await claim('run-c')).map(r=>r.claimed_by),['run-c'],'an abandoned claim is taken over');
 assert.deepEqual((await claim('manual',6,[later,off,push])).map(r=>r.id),[later],'manual: schedule ignored, enabled and push-only respected');
 await d.query(`update public.archive_collection_rules set backoff_until=now()-interval '1 second',last_status=null where id=$1`,[backing]);
 assert.deepEqual((await claim('run-d')).map(r=>r.id),[backing]);
 // Concurrent claims split the due rules between them.
 await d.exec(`update public.archive_collection_rules set last_status=null,next_run_at=null,backoff_until=null where kind<>'websub'; update public.archive_collection_rules set enabled=true`);
 const [x,y]=await Promise.all([claim('x',2),claim('y',2)]);
 const ids=[...x,...y].map(r=>r.id);assert.equal(new Set(ids).size,ids.length);assert.equal(ids.length,4);
 await d.close();
});

test('runs: finish_run applies the backoff formula, etag/last_modified and next_run_at; a second finish changes nothing',async()=>{
 const d=await database();
 await d.query(`insert into public.archive_collection_rules(kind,name,url,cadence_hours) values('rss','Feed','https://f.example.com/rss',6)`);
 const [{id:rule}]=await rows(d,`select id from public.archive_collection_rules`);
 const start=trigger=>svc(d,`select public.archive_start_run($1,$2) id`,[rule,trigger]).then(r=>r[0].id);
 const finish=(run,status,counts={},state={})=>svc(d,`select public.archive_finish_run($1,$2,$3::jsonb,$4::jsonb) r`,[run,status,J(counts),J(state)]).then(r=>r[0].r);
 const state=()=>rows(d,`select failure_count f,extract(epoch from backoff_until-now())/3600 b,extract(epoch from next_run_at-now())/3600 nx,etag,last_modified,last_status from public.archive_collection_rules`).then(r=>r[0]);
 const hours=[];
 for(let i=1;i<=8;i++){
  const run=await start('cron');
  assert.equal((await rows(d,`select attempt from public.archive_runs where id=$1`,[run]))[0].attempt,i);
  await finish(run,'error',{errors:1});const s=await state();
  assert.equal(s.f,i);hours.push(Math.round(s.b));assert.equal(Math.round(s.nx),Math.round(s.b));
 }
 assert.deepEqual(hours,[1,2,4,8,16,32,48,48],'min(48 h, 1 h × 2^(failures − 1))');
 const ok=await start('admin');
 await svc(d,`select public.archive_ingest($1,'[]')`,[ok]);
 const r=await finish(ok,'success',{fetched:12,kept:3,new_candidates:2,by_label:{facade_project:2}},{etag:'"abc"',last_modified:'Wed, 15 Oct 2026 08:00:00 GMT'});
 assert.deepEqual([r.status,r.rule.failure_count,r.rule.backoff_until],['success',0,null]);
 let s=await state();assert.deepEqual([s.f,s.b,Math.round(s.nx),s.etag,s.last_modified,s.last_status],[0,null,6,'"abc"','Wed, 15 Oct 2026 08:00:00 GMT','success']);
 const [run]=await rows(d,`select status,fetched,kept,new_candidates,detail,finished_at from public.archive_runs where id=$1`,[ok]);
 assert.deepEqual([run.status,run.fetched,run.kept,run.new_candidates,run.detail],['success',12,3,2,{by_label:{facade_project:2}}]);
 assert.equal((await finish(ok,'error')).already_finished,true);
 s=await state();assert.equal(s.f,0,'the second finish did not back off');
 // A 304 keeps the stored validators; a caller-chosen next run is bounded.
 const nm=await start('cron');await finish(nm,'success',{fetched:0},{next_run_at:new Date(Date.now()+90*DAY).toISOString()});
 s=await state();assert.deepEqual([s.etag,Math.round(s.nx/24)],['"abc"',30]);
 assert.equal(await code(finish(nm,'running')),'22023');
 // A WebSub push run never touches the poll schedule and stamps the subscription.
 await svc(d,`select public.archive_websub_upsert('https://f.example.com/rss','https://hub.example.com/','0123456789abcdef0123','active',864000,$1)`,[rule]);
 const push=await start('websub');await finish(push,'error');
 s=await state();assert.equal(s.f,0);
 assert.ok((await rows(d,`select last_push_at from public.archive_websub_subscriptions`))[0].last_push_at);
 // Errors are never lost: unknown ids become null, long text is cut.
 await svc(d,`select public.archive_log_error($1,$2,'fetch',503,$3,$4)`,[push,'00000000-0000-4000-8000-000000000000','m'.repeat(1500),'https://f.example.com/rss']);
 await svc(d,`select public.archive_log_error(null,null,'',0,'','')`);
 const errs=await rows(d,`select run_id,rule_id,stage,http_status,length(message) len from public.archive_run_errors order by at`);
 assert.deepEqual(errs.map(e=>[e.run_id,e.rule_id,e.stage,e.http_status,e.len]),[[push,rule,'fetch',503,1000],[null,null,'unknown',null,12]]);
 assert.equal((await rows(d,`select errors from public.archive_runs where id=$1`,[push]))[0].errors,1);
 await d.close();
});

// ---- link checks -----------------------------------------------------------------------------------------------
test('link checks: due list, three failures → broken; a broken official URL flags the project, a broken image is hidden; recovery clears',async()=>{
 const pid=await upsert({name_en:'Link Check Tower',country_iso2:'SG',city:'Singapore',official_url:'https://www.tower.example.sg/',reviewed:true,visibility:'published'});
 const sid=(await ed(`select public.archive_admin_add_source($1,$2::jsonb,'{}') id`,[pid,J({url:'https://press.example.sg/tower',source_kind:'news'})]))[0].id;
 const mid=(await ed(`select public.archive_admin_set_media($1,$2::jsonb) id`,[pid,J({url:'https://upload.wikimedia.org/t.jpg',license:'CC0',author:'Tan',rights_status:'cleared'})]))[0].id;
 const due=(await svc(db,`select x from public.archive_links_due(5000) x`)).map(r=>r.x);
 const mine=due.filter(x=>[pid,sid,mid].includes(x.id));
 assert.deepEqual(mine.map(x=>[x.target,x.html]).sort(),[['media',false],['project',true],['source',true]]);
 const check=list=>svc(db,`select public.archive_record_link_checks($1::jsonb) r`,[J(list)]).then(r=>r[0].r);
 const fail=[{target:'project',id:pid,url:'https://www.tower.example.sg/',state:'broken',http_status:404},{target:'media',id:mid,url:'https://upload.wikimedia.org/t.jpg',state:'broken',http_status:410},
  {target:'source',id:sid,url:'https://press.example.sg/tower',state:'broken'}];
 assert.deepEqual(await check(fail),{updated:3,broken:0,recovered:0});
 assert.deepEqual(await check([...fail,{target:'source',id:sid,url:'https://old.example.sg/stale',state:'ok'},{target:'media',id:mid,url:'https://upload.wikimedia.org/t.jpg',state:'robots_disallowed'}]),
  {updated:4,broken:0,recovered:0},'a stale URL is ignored');
 let [m]=await rows(db,`select link_state,consecutive_failures from public.archive_media where id=$1`,[mid]);
 assert.deepEqual([m.link_state,m.consecutive_failures],['robots_disallowed',2],'robots is recorded, not a failure');
 assert.equal((await publicView('id=$1',[pid]))[0].media.length,1,'two failures: still shown');
 assert.deepEqual(await check(fail),{updated:3,broken:3,recovered:0});
 const p=await project(pid);
 assert.deepEqual([p.official_url_state,p.update_status],['broken','link_broken']);
 const ups=await rows(db,`select kind,detail from public.archive_project_updates where project_id=$1 and status='open' order by kind`,[pid]);
 assert.deepEqual(ups.map(u=>u.kind),['image_broken','link_broken']);assert.equal(ups[1].detail.http_status,404);
 const [v]=await publicView('id=$1',[pid]);
 assert.deepEqual([v.media.length,v.update_status,v.sources[0].link_state],[0,'link_broken','broken']);
 assert.equal((await svc(db,`select x from public.archive_links_due(5000) x`)).map(r=>r.x.id).filter(i=>[pid,sid,mid].includes(i)).length,0,'checked today: not due again');
 assert.deepEqual(await check(fail.map(f=>({...f,state:'ok',http_status:200}))),{updated:3,broken:0,recovered:3});
 assert.deepEqual([(await project(pid)).update_status,(await publicView('id=$1',[pid]))[0].media.length],['current',1]);
 assert.equal((await rows(db,`select count(*)::int n from public.archive_project_updates where project_id=$1 and status='open'`,[pid]))[0].n,0);
 // The service function reuses one open row per kind.
 const u1=(await svc(db,`select public.archive_record_project_update($1,'wikidata_changed','{"P571":"2009"}') id`,[pid]))[0].id;
 const u2=(await svc(db,`select public.archive_record_project_update($1,'wikidata_changed','{"P17":"Q334"}') id`,[pid]))[0].id;
 assert.equal(u1,u2);
 assert.deepEqual((await rows(db,`select detail from public.archive_project_updates where id=$1`,[u1]))[0].detail,{P571:'2009',P17:'Q334',count:2});
 assert.equal((await project(pid)).update_status,'new_info');
 const res=(await ed(`select public.archive_admin_resolve_update($1,'dismiss') r`,[u1]))[0].r;
 assert.equal(res.status,'dismissed');assert.equal((await project(pid)).update_status,'current');
});

test('updates: applying a new_source update adds its hits as sources',async()=>{
 const [u]=await ed(`select x from public.archive_admin_list_updates('open',100) x`).then(r=>r.map(x=>x.x).filter(x=>x.project_id===LWT&&x.kind==='new_source'));
 assert.equal(u.project_slug,(await project(LWT)).slug);
 const r=(await ed(`select public.archive_admin_resolve_update($1,'apply') r`,[u.id]))[0].r;
 assert.equal(r.status,'applied');
 const urls=(await rows(db,`select s.canonical_url from public.archive_project_sources ps join public.archive_sources s on s.id=ps.source_id where ps.project_id=$1`,[LWT])).map(x=>x.canonical_url);
 assert.deepEqual(urls.sort(),u.detail.hits.map(h=>h.canonical_url).sort());
 assert.equal((await project(LWT)).update_status,'current');
 assert.match(await code(ed(`select public.archive_admin_resolve_update($1,'apply')`,[u.id])),/22023/);
 const dash=(await ed(`select public.archive_admin_dashboard() d`))[0].d;
 for(const k of ['queue','runs_24h','runs_7d','errors_24h','errors_7d','rules','rules_by_status','sources_by_link_state','projects_by_visibility','projects_by_review','open_updates','broken_links','websub','settings','generated_at'])assert.ok(k in dash,k);
 assert.ok(dash.queue.needs_review>0&&dash.runs_24h.total>0);
});

// ---- WebSub and prune ------------------------------------------------------------------------------------------
test('websub: upsert keeps the secret, due lists renewals, and no view or client-callable function ever shows a secret',async()=>{
 const SECRET='websub-secret-0123456789';
 const up=(topic,hub,secret,state,lease,rule=RULE)=>svc(db,`select public.archive_websub_upsert($1,$2,$3,$4,$5,$6) id`,[topic,hub,secret,state,lease,rule]).then(r=>r[0].id);
 const a=await up('https://feed.example.com/atom','https://hub.example.com/',SECRET,'pending',null);
 assert.equal(await up('https://feed.example.com/atom',null,null,'active',3600),a,'same topic, same row');
 const got=(await svc(db,`select public.archive_websub_get('https://feed.example.com/atom') g`))[0].g;
 assert.deepEqual([got.secret,got.hub,got.state,got.rule_id],[SECRET,'https://hub.example.com/','active',RULE]);
 assert.equal((await svc(db,`select public.archive_websub_get('https://nope.example.com/') g`))[0].g,null);
 await up('https://long.example.com/atom','https://hub.example.com/','another-secret-abcdef','active',30*24*3600);
 await up('https://failed.example.com/atom','https://hub.example.com/','failed-secret-abcdef','failed',null);
 assert.equal(await code(up('https://new.example.com/atom','https://hub.example.com/',null,'pending',null)),'23502','a new topic needs a secret');
 assert.equal(await code(up('https://x.example.com/atom','https://hub.example.com/','short','pending',null)),'23514');
 assert.equal(await code(up('https://x.example.com/atom','https://hub.example.com/',SECRET,'subscribed',null)),'22023');
 const due=(await svc(db,`select x from public.archive_websub_due(48) x`)).map(r=>r.x);
 assert.deepEqual(due.map(x=>[x.topic,x.reason]).sort(),[['https://failed.example.com/atom','failed'],['https://feed.example.com/atom','expiring']]);
 assert.ok(!J(due).includes(SECRET));
 // Everything a client can read or call, as an admin.
 const seen=[];
 for(const v of (await rows(db,`select viewname from pg_views where schemaname='public'`)).map(r=>r.viewname))
  for(const role of ['anon','authenticated'])seen.push(J(await q(db,role,ADMIN,`select * from public.${v}`).catch(()=>[])));
 for(const s of ['select public.archive_admin_dashboard() x','select x from public.archive_admin_list_rules() x','select x from public.archive_admin_list_runs() x',
  'select x from public.archive_admin_list_errors() x','select x from public.archive_admin_list_projects() x','select x from public.archive_admin_list_candidates(\'all\') x',
  'select x from public.archive_admin_list_updates(\'all\') x','select public.archive_public_stats() x','select * from public.archive_search(null,\'{}\')'])
  seen.push(J(await q(db,'authenticated',ADMIN,s)));
 assert.ok(seen.every(s=>!s.includes(SECRET)&&!s.includes('another-secret')),'no secret anywhere');
 assert.ok(/https:\/\/[a-z]+\.example\.com\/atom/.test(seen.join('')),'the rule listing does show the subscription');
});

test('prune: removes old auto_ignored candidates and old runs, never decided candidates or projects',async()=>{
 const d=await database();
 const [ed2]=(await rows(d,`insert into auth.users(email) values('e@t') returning id`)).map(r=>r.id);
 await d.query(`insert into public.app_admins(user_id,role) values($1,'editor')`,[ed2]);
 const ing=items=>svc(d,`select public.archive_ingest(null,$1::jsonb) r`,[J(items)]).then(r=>r[0].r.items.map(i=>i.candidate_id));
 const [oldIgnored,newIgnored]=await ing([item({classification:{score:10}}),item({classification:{score:10}})]);
 const [approved,merged,rejected,dup,target]=await ing([item(),item(),item(),item(),item()]);
 const rv=(id,a,p={})=>q(d,'authenticated',ed2,`select public.archive_admin_review_candidate($1,$2,$3::jsonb)`,[id,a,J(p)]);
 await rv(approved,'approve_new',{name_en:'Kept Project',country_iso2:'IT'});
 const pid=(await rows(d,`select matched_project_id p from public.archive_candidates where id=$1`,[approved]))[0].p;
 await rv(merged,'attach',{project_id:pid});await rv(rejected,'reject',{note:'no'});await rv(dup,'merge',{into_candidate_id:target});
 await d.query(`update public.archive_candidates set last_seen_at=now()-interval '31 days',first_seen_at=now()-interval '40 days' where id<>$1`,[newIgnored]);
 await d.query(`update public.archive_projects set created_at=now()-interval '400 days'`);
 await d.query(`insert into public.archive_runs(trigger,status,started_at) values('cron','success',now()-interval '181 days'),('cron','success',now()-interval '179 days')`);
 const [{id:oldRun}]=await rows(d,`select id from public.archive_runs where started_at<now()-interval '180 days'`);
 await svc(d,`select public.archive_log_error($1,null,'fetch',500,'old','https://x.example.com/')`,[oldRun]);
 const r=(await svc(d,`select public.archive_prune() r`))[0].r;
 assert.deepEqual(r,{candidates:1,runs:1,errors:0});
 const left=(await rows(d,`select id from public.archive_candidates`)).map(x=>x.id).sort();
 assert.deepEqual(left,[newIgnored,approved,merged,rejected,dup,target].sort());
 assert.equal((await rows(d,`select count(*)::int n from public.archive_candidate_hits where candidate_id=$1`,[oldIgnored]))[0].n,0,'its hits went with it');
 assert.equal((await rows(d,`select count(*)::int n from public.archive_run_errors`))[0].n,0,'errors of a pruned run go with it');
 assert.equal((await rows(d,`select count(*)::int n from public.archive_projects`))[0].n,1);
 assert.deepEqual((await svc(d,`select public.archive_prune() r`))[0].r,{candidates:0,runs:0,errors:0});
 await d.close();
});

// ---- release bundle and schedules ------------------------------------------------------------------------------
test('complete-backend.sql carries the archive migration verbatim, in its single transaction',async()=>{
 const body=(await sql(ARCHIVE)).split('\n').filter(l=>!['begin;','commit;'].includes(l.trim())).join('\n').trim();
 const bundle=await sql('release/launch/complete-backend.sql');
 assert.ok(bundle.includes('-- SOURCE: migrations/20261018000000_media_facade_archive.sql\n'+body+'\n'),'the archive section is the migration body');
 assert.equal(bundle.match(/^begin;$/gm).length,1);assert.equal(bundle.match(/^commit;$/gm).length,1);
});
test('install-six-hour-sync.sql schedules archive-collect, archive-check-links and archive-prune like the other jobs',async()=>{
 const s=await readFile(new URL('release/launch/install-six-hour-sync.sql',root),'utf8');
 const job=name=>{const m=s.match(new RegExp(`select cron\\.schedule\\('${name}','([^']+)', \\$job\\$([\\s\\S]*?)\\$job\\$\\);`));assert.ok(m,name);return {cron:m[1],body:m[2]}};
 const collect=job('aol-archive-collect-hourly'),links=job('aol-archive-check-links-daily'),prune=job('aol-archive-prune-daily');
 assert.equal(collect.cron,'17 * * * *');assert.match(collect.body,/\/functions\/v1\/archive-collect'/);assert.match(collect.body,/'\{"max_rules": ?6\}'::jsonb/);
 assert.equal(links.cron,'20 18 * * *','03:20 KST');assert.match(links.body,/\/functions\/v1\/archive-check-links'/);
 for(const j of [collect,links]){assert.match(j.body,/name='media_cron_secret'/);assert.match(j.body,/net\.http_post/);}
 assert.match(prune.cron,/^\d+ \d+ \* \* \*$/);assert.match(prune.body.trim(),/^select public\.archive_prune\(\);$/);
 assert.ok(s.trim().endsWith('A queued HTTP request alone is not successful ingestion.'));assert.equal(s.match(/^commit;$/gm).length,1);
});
