// Applies the Supabase SQL to real Postgres (PGlite, WASM) with stubbed auth/storage schemas,
// then checks two-user RLS isolation, admin gating and idempotency. Not a substitute for a run on Supabase itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const root=new URL('../',import.meta.url);
const sql=async f=>(await readFile(new URL(f,root),'utf8')).replace(/create extension if not exists "?pgcrypto"?[^;]*;/gi,'');
const DISCOVERED='supabase/migrations/20261013000000_discovered_places.sql';
// The first released version of DISCOVERED (v0.15.0): the current one must upgrade it in place.
const DISCOVERED_V0150='tests/sql/discovered_places_v0.15.0.sql';
const PARTIAL=['supabase/01_schema.sql','supabase/02_seed_seoul50.sql','supabase/03_storage.sql','supabase/05_live_data_schema.sql','supabase/08_hybrid_media_pipeline.sql','supabase/10_global_discovery_engine.sql'];
const FRESH=['supabase/01_schema.sql','supabase/02_seed_seoul50.sql','supabase/03_storage.sql','supabase/04_flutterflow_rpc.sql','supabase/05_live_data_schema.sql','supabase/07_audited_corrections.sql','supabase/08_hybrid_media_pipeline.sql','supabase/10_global_discovery_engine.sql','supabase/12_seed_countries_cities.sql','supabase/13_admin_review_console.sql','supabase/15_discovery_hardening.sql','supabase/17_user_sync_and_operations.sql','supabase/18_discovery_rotation.sql','supabase/migrations/20261010160920_archive_media_and_editorial.sql',DISCOVERED];
async function database(files){const db=new PGlite();await db.exec(await sql('tests/sql/supabase-stubs.sql'));for(const f of files)await db.exec(await sql(f)).catch(e=>{throw Error(`${f}: ${e.message}`)});return db}
// Run fn as a PostgREST-like request: role anon/authenticated with the JWT subject set.
async function as(db,role,sub,fn){return db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`,[sub||'']);return fn(tx)})}
const rows=async(tx,q,p=[])=>(await tx.query(q,p)).rows;

let db,A,B,ADMIN;
test.before(async()=>{
 db=await database([...PARTIAL,'release/launch/complete-backend.sql']);
 [A,B,ADMIN]=(await db.query(`insert into auth.users(email) values('a@test'),('b@test'),('admin@test') returning id`)).rows.map(r=>r.id);
 await db.query('insert into public.app_admins(user_id) values($1)',[ADMIN]);
});

test('complete-backend.sql is idempotent on the reported partial state',async()=>{
 await db.exec(await sql('release/launch/complete-backend.sql'));
});
test('fresh project: numbered SQL + migration apply in order, then complete-backend is a no-op',async()=>{
 const fresh=await database(FRESH);await fresh.exec(await sql('release/launch/complete-backend.sql'));await fresh.close();
});
test('a backend completed with v0.15.0 (first discovered_places version) is upgraded by complete-backend.sql, twice',async()=>{
 const old=await database(FRESH.map(f=>f===DISCOVERED?DISCOVERED_V0150:f));
 for(let i=0;i<2;i++)await old.exec(await sql('release/launch/complete-backend.sql'));
 const [{n}]=await rows(old,`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='discovered_places' and column_name in ('place_block','image_block')`);assert.equal(n,2);
 await old.close();
});
test('every public table has RLS enabled',async()=>{
 const r=await rows(db,`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
 assert.deepEqual(r,[]);
});
test('anon reads only published places, with the city relation the client queries',async()=>{
 const [{published,total}]=await rows(db,`select count(*) filter (where is_published)::int published,count(*)::int total from public.places`);
 const r=await as(db,'anon',null,tx=>rows(tx,`select p.place_code,c.name_en from public.places p left join public.cities c on c.id=p.city_id`));
 assert.equal(r.length,published);assert.ok(published<total,'seed keeps at least one unpublished place');
 assert.ok(r.every(x=>x.name_en),'every published place resolves a city');
});
test('anon cannot write places',async()=>{
 await assert.rejects(as(db,'anon',null,tx=>tx.query(`update public.places set name_kr='x'`)),/permission denied/);
});
test('workspaces: two users are isolated and saves are compare-and-swap',async()=>{
 const doc=n=>JSON.stringify({schema:1,saved:[n],visits:[],routes:[],candidates:[],legacyVisits:{},preferences:{}});
 const a1=await as(db,'authenticated',A,tx=>rows(tx,`select public.save_workspace($1::jsonb,0) r`,[doc('A1')]));assert.equal(a1[0].r.ok,true);
 const b1=await as(db,'authenticated',B,tx=>rows(tx,`select public.save_workspace($1::jsonb,0) r`,[doc('B1')]));assert.equal(b1[0].r.ok,true);
 const seenByB=await as(db,'authenticated',B,tx=>rows(tx,`select user_id,document->'saved' s from public.user_workspaces`));
 assert.deepEqual(seenByB.map(r=>r.s),[['B1']]);
 const stale=await as(db,'authenticated',A,tx=>rows(tx,`select public.save_workspace($1::jsonb,$2) r`,[doc('A2'),a1[0].r.revision+5]));
 assert.equal(stale[0].r.conflict,true);
 const ok=await as(db,'authenticated',A,tx=>rows(tx,`select public.save_workspace($1::jsonb,$2) r`,[doc('A2'),a1[0].r.revision]));
 assert.equal(ok[0].r.ok,true);
 await assert.rejects(as(db,'authenticated',B,tx=>tx.query(`update public.user_workspaces set document=document where user_id=$1`,[A])),/permission denied/);
 await assert.rejects(as(db,'anon',null,tx=>tx.query(`select public.save_workspace($1::jsonb,0)`,[doc('x')])),/permission denied/);
});
test('visit photos: metadata rows and storage objects are owner-only',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 await as(db,'authenticated',A,tx=>tx.query(`insert into public.visit_photos(id,user_id,visit_id,storage_path) values($1,$2::uuid,'v1',$2::text||'/p.jpg')`,[id,A]));
 assert.equal((await as(db,'authenticated',B,tx=>rows(tx,`select id from public.visit_photos`))).length,0);
 await assert.rejects(as(db,'authenticated',B,tx=>tx.query(`insert into public.visit_photos(id,user_id,visit_id,storage_path) values(gen_random_uuid(),$1::uuid,'v1',$1::text||'/q.jpg')`,[A])),/row-level security/);
 await assert.rejects(as(db,'authenticated',B,tx=>tx.query(`insert into storage.objects(bucket_id,name) values('visit-photos',$1::text||'/x.jpg')`,[A])),/row-level security|permission denied/);
 assert.equal((await rows(db,`select public from storage.buckets where id='visit-photos'`))[0].public,false);
});
test('editorial articles: anon sees published only; only admins write',async()=>{
 await as(db,'authenticated',ADMIN,tx=>tx.query(`insert into public.archive_articles(title,body,status,published_at) values('공개','b','published',now()),('초안','b','draft',null)`));
 assert.deepEqual((await as(db,'anon',null,tx=>rows(tx,`select title from public.archive_articles`))).map(r=>r.title),['공개']);
 await assert.rejects(as(db,'authenticated',A,tx=>tx.query(`insert into public.archive_articles(title,body) values('x','y')`)),/row-level security/);
 assert.equal((await as(db,'authenticated',A,tx=>rows(tx,`select public.is_app_admin() a`)))[0].a,false);
});
test('candidate promotion is not callable by signed-in users',async()=>{
 await assert.rejects(as(db,'authenticated',ADMIN,tx=>tx.query(`select public.promote_candidate_to_place(gen_random_uuid(),'x')`)),/permission denied/);
});
test('cleared media view is readable by anon',async()=>{
 await as(db,'anon',null,tx=>tx.query(`select * from public.public_place_media limit 1`));
});

// ---- server-side nationwide/worldwide sync: public.discovered_places and its view ----------------------------
// Supabase grants every new table, view and function in public to anon/authenticated by default; the plain stubs do
// not, so these tests add those default grants first: the migration's own revokes must hold against them.
const SUPABASE_DEFAULT_GRANTS=`alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`;
const H=3600e3,iso=ms=>new Date(ms).toISOString();
// A valid apply_discovered_places row (record = the app's compact form: [qid, name, …, lat, lon, image, …]).
const dpRow=(qid,{branches=['world:seeds'],image=null,scope='world',name='빛 '+qid}={})=>({qid,scope,record:[qid,name,'','','2','Q17','일본','도쿄',35.6,139.7,image||'','',3,'','',''],primary_category:'Festival',latitude:35.6,longitude:139.7,sitelinks:3,branches,image_file:image});
const media=(qid,file)=>[{place_code:'WD-'+qid,wikidata:qid,provider_asset_id:file,display_url:'https://upload.wikimedia.org/x.jpg',creator:'Lee',license_code:'CC BY-SA 4.0',clearance_status:'cleared',review_required:false}];
const svc=(d,fn)=>as(d,'service_role',null,fn);
const apply=(d,list,seen)=>svc(d,tx=>rows(tx,`select public.apply_discovered_places($1::jsonb,$2) n`,[JSON.stringify(list),seen])).then(r=>r[0].n);
const setMedia=(d,list,at,kr=true)=>svc(d,tx=>rows(tx,`select public.set_discovered_media($1::jsonb,$2,$3) n`,[JSON.stringify(list),at,kr])).then(r=>r[0].n);
const view=(d,role='anon')=>as(d,role,null,tx=>rows(tx,`select qid,image_status,image_reasons,media,last_seen_at from public.public_discovered_places order by qid`));
let dp;
test('discovered places: the migration re-runs cleanly on its own, under Supabase default grants',async()=>{
 dp=new PGlite();await dp.exec(await sql('tests/sql/supabase-stubs.sql'));await dp.exec(SUPABASE_DEFAULT_GRANTS);
 await dp.exec(await sql(DISCOVERED));await dp.exec(await sql(DISCOVERED));
});
test('discovered places: complete-backend.sql carries the migration verbatim',async()=>{
 const body=(await sql(DISCOVERED)).split('\n').filter(l=>!['begin;','commit;'].includes(l.trim())).join('\n').trim();
 const bundle=await sql('release/launch/complete-backend.sql');
 assert.ok(bundle.includes('-- SOURCE: migrations/20261013000000_discovered_places.sql\n'+body+'\ncommit;'),'the bundle ends with the migration body');
 for(const d of [db]){const [{n}]=await rows(d,`select count(*)::int n from pg_views where schemaname='public' and viewname='public_discovered_places'`);assert.equal(n,1)}
});
test('discovered places: anon and signed-in users read the view only; they cannot write or run the sync',async()=>{
 const now=iso(Date.now());
 assert.equal(await apply(dp,[dpRow('Q1',{image:'a.jpg'}),dpRow('Q2')],now),2);
 for(const role of ['anon','authenticated']){
  assert.deepEqual((await view(dp,role)).map(r=>r.qid),['Q1','Q2'],role+' reads the view');
  for(const q of [`select * from public.discovered_places`,`insert into public.discovered_places(qid,scope,record,primary_category,latitude,longitude) values('Q9','world','["Q9"]','Festival',0,0)`,
   `update public.discovered_places set sitelinks=99`,`delete from public.discovered_places`,
   `update public.public_discovered_places set sitelinks=99`,`delete from public.public_discovered_places`,
   `select public.apply_discovered_places('[]'::jsonb,now())`,`select public.prune_discovered_places(now(),'{}')`,
   `select public.discovered_images_due(10,now(),true)`,`select public.set_discovered_media('[]'::jsonb,now(),true)`,
   `select public.discovered_branch_counts(now())`,`select public.claim_discovered_sync('sync-global-places','x',60,true)`,`select public.release_discovered_sync('sync-global-places','x')`,
   `select * from public.discovered_sync_locks`,`delete from public.discovered_sync_locks`])
   await assert.rejects(as(dp,role,null,tx=>tx.query(q)),/permission denied/,`${role}: ${q}`);
 }
 const [{rls}]=await rows(dp,`select relrowsecurity rls from pg_class where oid='public.discovered_places'::regclass`);assert.equal(rls,true);
 const [{n}]=await rows(dp,`select count(*)::int n from pg_policies where tablename='discovered_places'`);assert.equal(n,0,'no client policy at all');
 assert.equal((await rows(dp,`select sitelinks from public.discovered_places where qid='Q1'`))[0].sitelinks,3,'nothing changed');
});
test('discovered places: places unseen for 72 hours and photo verdicts older than 24 hours are hidden',async()=>{
 const t=Date.now();
 await apply(dp,[dpRow('Q3',{image:'c.jpg'}),dpRow('Q4',{image:'d.jpg'})],iso(t));
 await apply(dp,[dpRow('Q5')],iso(t-73*H));
 assert.equal(await setMedia(dp,[{qid:'Q3',image_file:'c.jpg',status:'cleared',reasons:[],media:media('Q3','c.jpg')}],iso(t-2*H)),1);
 assert.equal(await setMedia(dp,[{qid:'Q4',image_file:'d.jpg',status:'cleared',reasons:[],media:media('Q4','d.jpg')}],iso(t-25*H)),1);
 const v=Object.fromEntries((await view(dp)).map(r=>[r.qid,r]));
 assert.equal(v.Q5,undefined,'unseen for 73 h: hidden');
 assert.equal(v.Q3.image_status,'cleared');assert.equal(v.Q3.media[0].creator,'Lee');
 assert.equal(v.Q4.image_status,'pending','a verdict older than 24 h is not offered');assert.deepEqual(v.Q4.media,[]);
 assert.equal(v.Q2.image_status,'none');
 // The table still holds them for the next run.
 assert.equal((await rows(dp,`select count(*)::int n from public.discovered_places where qid in ('Q4','Q5')`))[0].n,2);
});
test('discovered places: verdicts follow the file; a blocked photo has reasons and no media; bad verdicts are ignored',async()=>{
 const t=Date.now(),first=(await rows(dp,`select first_seen_at from public.discovered_places where qid='Q1'`))[0].first_seen_at;
 assert.equal(await setMedia(dp,[{qid:'Q1',image_file:'a.jpg',status:'blocked',reasons:['foreign_no_freedom_of_panorama'],media:media('Q1','a.jpg')}],iso(t)),1);
 let [r]=(await view(dp)).filter(x=>x.qid==='Q1');
 assert.deepEqual([r.image_status,r.image_reasons,r.media],['blocked',['foreign_no_freedom_of_panorama'],[]]);
 // A verdict for another file, a cleared verdict without media, or an unknown status changes nothing.
 assert.equal(await setMedia(dp,[{qid:'Q1',image_file:'old.jpg',status:'cleared',reasons:[],media:media('Q1','old.jpg')},{qid:'Q3',image_file:'c.jpg',status:'cleared',reasons:[],media:[]},{qid:'Q3',image_file:'c.jpg',status:'ok',media:media('Q3','c.jpg')}],iso(t)),0);
 // The same file seen again keeps its verdict; a new file resets it to pending; first_seen_at never moves.
 await apply(dp,[dpRow('Q1',{image:'a.jpg',name:'새 이름'})],iso(t+1000));
 [r]=(await view(dp)).filter(x=>x.qid==='Q1');assert.equal(r.image_status,'blocked');
 await apply(dp,[dpRow('Q1',{image:'b.jpg'})],iso(t+2000));
 [r]=(await view(dp)).filter(x=>x.qid==='Q1');assert.deepEqual([r.image_status,r.image_reasons,r.media],['pending',[],[]]);
 const [after]=await rows(dp,`select first_seen_at,last_seen_at,media_checked_at,image_file from public.discovered_places where qid='Q1'`);
 assert.equal(+after.first_seen_at,+first);assert.equal(after.media_checked_at,null);assert.equal(after.image_file,'b.jpg');
 await apply(dp,[dpRow('Q1')],iso(t+3000));
 [r]=(await view(dp)).filter(x=>x.qid==='Q1');assert.equal(r.image_status,'none','photo removed from Wikidata');
 // A record that is not the place's own compact array is refused.
 await assert.rejects(apply(dp,[{...dpRow('Q6'),record:['Q7']}],iso(t)),/check constraint/);
 await assert.rejects(apply(dp,[{...dpRow('Q6'),latitude:91}],iso(t)),/check constraint/);
});
test('discovered places: prune keeps what only failed branches returned, drops the rest, and anything unseen for 30 days',async()=>{
 const d=new PGlite();await d.exec(await sql('tests/sql/supabase-stubs.sql'));await d.exec(await sql(DISCOVERED));
 const t=Date.now(),before=iso(t-6*H),now=iso(t);
 await apply(d,[dpRow('Q10',{branches:['world:seeds']}),dpRow('Q11',{branches:['world:genres']}),dpRow('Q12',{branches:['world:genres','world:seeds']}),dpRow('Q13',{branches:['korea:classes']})],before);
 await apply(d,[dpRow('Q14',{branches:['world:genres']})],iso(t-31*24*H));
 // This run saw Q10 only; world:genres failed.
 await apply(d,[dpRow('Q10',{branches:['world:seeds']})],now);
 const pruned=(await svc(d,tx=>rows(tx,`select public.prune_discovered_places($1,$2) n`,[now,['world:genres']])))[0].n;
 assert.equal(pruned,2,'Q13 (its branch answered without it) and Q14 (unseen for 31 days)');
 assert.deepEqual((await rows(d,`select qid from public.discovered_places order by qid`)).map(r=>r.qid),['Q10','Q11','Q12']);
 assert.equal((await svc(d,tx=>rows(tx,`select public.prune_discovered_places($1,'{}') n`,[now])))[0].n,2,'every branch answered: only what this run saw stays');
 await d.close();
});
test('discovered places: photos due — never checked first, then another FoP policy, then the oldest; fresh ones wait',async()=>{
 const d=new PGlite();await d.exec(await sql('tests/sql/supabase-stubs.sql'));await d.exec(await sql(DISCOVERED));
 const t=Date.now(),now=iso(t);
 await apply(d,['Q20','Q21','Q22','Q23','Q24'].map(q=>dpRow(q,{image:q+'.jpg'})).concat([dpRow('Q25')]),now);
 await apply(d,[dpRow('Q26',{image:'Q26.jpg'})],iso(t-80*H)); // hidden from the view: not worth checking
 const ok=q=>({qid:q,image_file:q+'.jpg',status:'cleared',reasons:[],media:media(q,q+'.jpg')});
 await setMedia(d,[ok('Q21')],iso(t-20*H));await setMedia(d,[ok('Q22')],iso(t-10*H));await setMedia(d,[ok('Q23')],iso(t-H),false);await setMedia(d,[ok('Q24')],iso(t-H));
 const due=async(limit,kr=true)=>(await svc(d,tx=>rows(tx,`select public.discovered_images_due($1,$2,$3) d`,[limit,iso(t-5*H),kr])))[0].d.map(x=>x.qid);
 assert.deepEqual(await due(10),['Q20','Q23','Q21','Q22']);
 assert.deepEqual(await due(2),['Q20','Q23']);
 assert.deepEqual(await due(10,false),['Q20','Q21','Q22','Q24'],'policy off: every photo checked with it on is due (oldest first); Q23 is not');
 assert.deepEqual(await due(0),[]);
 await d.close();
});
test('discovered places: the run lock — one holder at a time, it expires, force takes it, only its owner releases it',async()=>{
 const d=new PGlite();await d.exec(await sql('tests/sql/supabase-stubs.sql'));await d.exec(await sql(DISCOVERED));
 const claim=(owner,secs=190,force=false,job='sync-global-places')=>svc(d,tx=>rows(tx,`select public.claim_discovered_sync($1,$2,$3,$4) r`,[job,owner,secs,force])).then(r=>r[0].r);
 const release=(owner,job='sync-global-places')=>svc(d,tx=>rows(tx,`select public.release_discovered_sync($1,$2) r`,[job,owner])).then(r=>r[0].r);
 assert.deepEqual(await claim('run-a'),{ok:true,owner:'run-a'});
 const busy=await claim('run-b');
 assert.deepEqual([busy.ok,busy.owner],[false,'run-a'],'the cron and a manual run: only the first gets it');
 assert.ok(Date.parse(busy.expires_at)-Date.parse(busy.locked_at)===190e3,'lease = the requested seconds');
 assert.equal((await claim('run-a')).ok,true,'its owner may renew it');
 assert.equal((await claim('other',190,false,'another-job')).ok,true,'locks are per job');
 assert.equal(await release('run-b'),false,'only the owner releases');
 assert.equal((await claim('run-c',190,true)).ok,true,'force takes a lock that is still held');
 assert.equal(await release('run-a'),false,'the run whose lock was taken releases nothing');
 assert.equal((await claim('run-d')).ok,false);
 assert.equal(await release('run-c'),true);
 assert.equal((await claim('run-d')).ok,true,'free again after release');
 // A run the platform stopped never releases: its lock expires by itself.
 await d.exec(`update public.discovered_sync_locks set expires_at=now()-interval '1 second' where owner='run-d'`);
 assert.deepEqual(await claim('run-e'),{ok:true,owner:'run-e'});
 // The lease is bounded (at most an hour) and needs a job and an owner.
 await claim('run-e',999999);
 const [{secs}]=await rows(d,`select extract(epoch from expires_at-locked_at)::int secs from public.discovered_sync_locks where job_name='sync-global-places'`);assert.equal(secs,3600);
 await assert.rejects(claim('',60),/p_job and p_owner are required/);
 await d.close();
});
test('discovered places: an older run that overlaps a newer one never puts back older rows or verdicts',async()=>{
 const d=new PGlite();await d.exec(await sql('tests/sql/supabase-stubs.sql'));await d.exec(await sql(DISCOVERED));
 const t=Date.now(),older=iso(t-H),newer=iso(t);
 assert.equal(await apply(d,[dpRow('Q30',{image:'new.jpg',name:'새',branches:['world:seeds','world:genres']})],newer),1);
 assert.equal(await setMedia(d,[{qid:'Q30',image_file:'new.jpg',status:'cleared',reasons:[],media:media('Q30','new.jpg')}],newer),1);
 // The older run's upsert arrives last: it changes nothing (not the record, branches, photo file or verdict).
 assert.equal(await apply(d,[dpRow('Q30',{image:'old.jpg',name:'옛',branches:['world:seeds']}),dpRow('Q31')],older),1,'only the place the newer run has not written');
 const [r]=await rows(d,`select record->>1 name,branches,image_file,image_status,last_seen_at from public.discovered_places where qid='Q30'`);
 assert.deepEqual([r.name,r.branches,r.image_file,r.image_status,new Date(r.last_seen_at).toISOString()],['새',['world:seeds','world:genres'],'new.jpg','cleared',newer]);
 // An older verdict for the same file is ignored; the same or a newer one is stored.
 assert.equal(await setMedia(d,[{qid:'Q30',image_file:'new.jpg',status:'blocked',reasons:['missing'],media:[]}],older),0);
 assert.equal(await setMedia(d,[{qid:'Q30',image_file:'new.jpg',status:'blocked',reasons:['missing'],media:[]}],iso(t+1000)),1);
 // The older run's prune cannot remove what the newer run saw.
 assert.equal((await svc(d,tx=>rows(tx,`select public.prune_discovered_places($1,'{}') n`,[older])))[0].n,0);
 await d.close();
});
test('discovered places: editorial blocks last — the view, the due list, verdicts and prune all respect them',async()=>{
 const d=new PGlite();await d.exec(await sql('tests/sql/supabase-stubs.sql'));await d.exec(SUPABASE_DEFAULT_GRANTS);await d.exec(await sql(DISCOVERED));
 const t=Date.now(),before=iso(t-6*H),now=iso(t);
 await apply(d,['Q40','Q41','Q42'].map(q=>dpRow(q,{image:q+'.jpg'})),before);
 const ok=q=>({qid:q,image_file:q+'.jpg',status:'cleared',reasons:[],media:media(q,q+'.jpg')});
 assert.equal(await setMedia(d,[ok('Q40'),ok('Q41'),ok('Q42')],iso(t-30*H)),3);
 await d.exec(`update public.discovered_places set image_block='rights complaint 2026-10-17' where qid='Q40'; update public.discovered_places set place_block='not a light place' where qid='Q41'`);
 await assert.rejects(d.exec(`update public.discovered_places set image_block='  ' where qid='Q42'`),/check constraint/,'a block needs a reason');
 const v=Object.fromEntries((await view(d)).map(r=>[r.qid,r]));
 assert.equal(v.Q41,undefined,'a blocked place is not in the view');
 assert.deepEqual([v.Q40.image_status,v.Q40.image_reasons,v.Q40.media],['blocked',['editorial_block'],[]],'the reason text itself is not shown');
 const [{at}]=await as(d,'anon',null,tx=>rows(tx,`select media_checked_at at from public.public_discovered_places where qid='Q40'`));
 assert.ok(Math.abs(new Date(at).getTime()-Date.now())<60e3,'a block is a current verdict at every read');
 // Never due, never overwritten by a verdict, even when the file changes.
 const due=async()=>(await svc(d,tx=>rows(tx,`select public.discovered_images_due(10,$1,true) d`,[iso(t-5*H)])))[0].d.map(x=>x.qid);
 assert.deepEqual(await due(),['Q42']);
 assert.equal(await setMedia(d,[ok('Q40'),ok('Q41')],now),0);
 await apply(d,[dpRow('Q40',{image:'other.jpg'})],now);
 assert.deepEqual((await view(d)).find(r=>r.qid==='Q40').image_reasons,['editorial_block'],'a new P18 file is blocked too');
 // This run did not see them and their branch answered: only the unblocked Q42 is pruned.
 assert.equal((await svc(d,tx=>rows(tx,`select public.prune_discovered_places($1,'{}') n`,[now])))[0].n,1);
 assert.deepEqual((await rows(d,`select qid,place_block is not null p,image_block is not null i from public.discovered_places order by qid`)).map(r=>[r.qid,r.p,r.i]),[['Q40',false,true],['Q41',true,false]]);
 // Nobody but the operator (and service_role) can set or clear a block.
 await assert.rejects(as(d,'authenticated',null,tx=>tx.query(`update public.discovered_places set image_block=null`)),/permission denied/);
 await d.close();
});
test('discovered places: stored places per branch, over the rows seen in the 72 hours before the run',async()=>{
 const d=new PGlite();await d.exec(await sql('tests/sql/supabase-stubs.sql'));await d.exec(await sql(DISCOVERED));
 const t=Date.now();
 await apply(d,[dpRow('Q50',{branches:['korea:classes','korea:seeds']}),dpRow('Q51',{branches:['korea:classes']})],iso(t-H));
 await apply(d,[dpRow('Q52',{branches:['korea:classes']})],iso(t-80*H));
 const counts=at=>svc(d,tx=>rows(tx,`select public.discovered_branch_counts($1) c`,[at])).then(r=>r[0].c);
 assert.deepEqual(await counts(iso(t)),{'korea:classes':2,'korea:seeds':1},'Q52 unseen for 80 hours does not count');
 assert.deepEqual(await counts(iso(t-60*H)),{'korea:classes':3,'korea:seeds':1});
 assert.deepEqual(await counts(iso(t+80*H)),{});
 await d.close();
});
test('discovered places: the current migration upgrades the v0.15.0 one in place, keeping rows and verdicts',async()=>{
 const d=new PGlite();await d.exec(await sql('tests/sql/supabase-stubs.sql'));await d.exec(SUPABASE_DEFAULT_GRANTS);await d.exec(await sql(DISCOVERED_V0150));
 const t=Date.now();
 await apply(d,[dpRow('Q60',{image:'a.jpg'}),dpRow('Q61')],iso(t));
 await setMedia(d,[{qid:'Q60',image_file:'a.jpg',status:'cleared',reasons:[],media:media('Q60','a.jpg')}],iso(t));
 await d.exec(await sql(DISCOVERED));await d.exec(await sql(DISCOVERED));
 assert.deepEqual((await view(d)).map(r=>[r.qid,r.image_status]),[['Q60','cleared'],['Q61','none']]);
 for(const q of [`select * from public.discovered_sync_locks`,`select public.claim_discovered_sync('j','x',60)`,`select public.discovered_branch_counts(now())`])
  await assert.rejects(as(d,'anon',null,tx=>tx.query(q)),/permission denied/,q);
 assert.equal((await svc(d,tx=>rows(tx,`select public.claim_discovered_sync('j','x',60) r`)))[0].r.ok,true);
 await d.close();
});
test.after(()=>Promise.all([db?.close(),dp?.close()]));
