// Applies the Supabase SQL to real Postgres (PGlite, WASM) with stubbed auth/storage schemas,
// then checks two-user RLS isolation, admin gating and idempotency. Not a substitute for a run on Supabase itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const root=new URL('../',import.meta.url);
const sql=async f=>(await readFile(new URL(f,root),'utf8')).replace(/create extension if not exists "?pgcrypto"?[^;]*;/gi,'');
const PARTIAL=['supabase/01_schema.sql','supabase/02_seed_seoul50.sql','supabase/03_storage.sql','supabase/05_live_data_schema.sql','supabase/08_hybrid_media_pipeline.sql','supabase/10_global_discovery_engine.sql'];
const FRESH=['supabase/01_schema.sql','supabase/02_seed_seoul50.sql','supabase/03_storage.sql','supabase/04_flutterflow_rpc.sql','supabase/05_live_data_schema.sql','supabase/07_audited_corrections.sql','supabase/08_hybrid_media_pipeline.sql','supabase/10_global_discovery_engine.sql','supabase/12_seed_countries_cities.sql','supabase/13_admin_review_console.sql','supabase/15_discovery_hardening.sql','supabase/17_user_sync_and_operations.sql','supabase/18_discovery_rotation.sql','supabase/migrations/20261010160920_archive_media_and_editorial.sql'];
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
test.after(()=>db?.close());
