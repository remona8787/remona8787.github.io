// Applies the v0.19 research data migration (supabase/migrations/20261026000000_research_data.sql) on top of the v0.16
// archive migration to real Postgres (PGlite) under Supabase's default grants and the stubbed auth schema, then checks
// docs/RESEARCH_DATA.md: profiles only for their owner, a public catalogue with private files, the download check for
// the service role only, the download log, content reports (anyone files, only editors read), aggregate admin stats
// and account deletion. PGlite-tested only: not a substitute for a run on Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
const root=new URL('../',import.meta.url);
const sql=async f=>(await readFile(new URL(f,root),'utf8')).replace(/create extension if not exists "?pgcrypto"?[^;]*;/gi,'');
const ARCHIVE='supabase/migrations/20261018000000_media_facade_archive.sql';
const RESEARCH='supabase/migrations/20261026000000_research_data.sql';
const SUPABASE_DEFAULT_GRANTS=`alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`;
const as=(d,role,sub,fn)=>d.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`,[sub||'']);return fn(tx)});
const q=(d,role,sub,text,params=[])=>as(d,role,sub,tx=>tx.query(text,params)).then(r=>r.rows);
const svc=(d,text,params)=>q(d,'service_role',null,text,params);
const rows=async(d,text,params=[])=>(await d.query(text,params)).rows;
const code=async p=>{try{await p}catch(e){return e.code||e.message}return 'ok'};
const PROFILE=`insert into public.research_profiles(user_id,terms_version,privacy_version) values($1,'2026-10','2026-10')`;

let db,ADMIN,EDITOR,ALICE,BOB;
test.before(async()=>{
 db=new PGlite({extensions:{pg_trgm}});
 await db.exec(await sql('tests/sql/supabase-stubs.sql'));await db.exec(SUPABASE_DEFAULT_GRANTS);
 await db.exec(await sql(ARCHIVE));await db.exec(await sql(RESEARCH));await db.exec(await sql(RESEARCH));
 [ADMIN,EDITOR,ALICE,BOB]=(await rows(db,`insert into auth.users(email) values('admin@t'),('editor@t'),('alice@t'),('bob@t') returning id`)).map(r=>r.id);
 await db.query(`insert into public.app_admins(user_id,role) values($1,'admin'),($2,'editor')`,[ADMIN,EDITOR]);
 await svc(db,`insert into public.research_datasets(id,title_ko,tier,licence,active) values
  ('kr-media-facades','국내 미디어파사드 검수 데이터셋','member','CC BY 4.0 (편집 부분)',true),
  ('archive-open','공개 아카이브','public','CC0 / 각 출처',true),
  ('institution-pack','기관용 비교 분석','institution','계약',true),
  ('retired','중단된 데이터셋','member','CC BY 4.0',false)`);
 await svc(db,`insert into public.research_dataset_versions(dataset_id,version,data_as_of,record_count,formats,storage_prefix,sha256,citation) values
  ('kr-media-facades','1.0.0','2026-10-25',52,array['csv','json'],'kr-media-facades/1.0.0','{"csv":"abc"}','빛의 건축 (2026). 국내 미디어파사드 검수 데이터셋 v1.0.0.'),
  ('retired','1.0.0','2026-01-01',1,array['csv'],'retired/1.0.0','{}','x')`);
});
test.after(()=>db?.close());

test('schema: applies twice; the dataset bucket is private and has no member policy',async()=>{
 assert.equal((await rows(db,`select public from storage.buckets where id='research-datasets'`))[0].public,false);
 assert.equal((await rows(db,`select count(*)::int n from pg_policies where schemaname='storage' and qual like '%research-datasets%'`))[0].n,0);
});

test('profiles: only e-mail and consents are required; each member sees and changes only their own',async()=>{
 assert.equal(await code(q(db,'anon',null,`select * from public.research_profiles`)),'42501');
 assert.equal(await code(q(db,'authenticated',ALICE,PROFILE,[BOB])),'42501','no profile for someone else');
 await q(db,'authenticated',ALICE,PROFILE,[ALICE]);
 await q(db,'authenticated',BOB,`insert into public.research_profiles(user_id,terms_version,privacy_version,affiliation,user_type,purpose) values($1,'2026-10','2026-10','Example University','researcher','facade typology')`,[BOB]);
 assert.deepEqual((await q(db,'authenticated',ALICE,`select user_id from public.research_profiles`)).map(r=>r.user_id),[ALICE]);
 await q(db,'authenticated',ALICE,`update public.research_profiles set display_name='Alice', user_id=$1`,[BOB]);
 assert.equal((await rows(db,`select display_name from public.research_profiles where user_id=$1`,[ALICE]))[0].display_name,'Alice','user_id cannot be moved');
 assert.equal(await code(q(db,'authenticated',ALICE,`update public.research_profiles set user_type='hacker'`)),'23514');
 assert.equal((await q(db,'authenticated',ALICE,`update public.research_profiles set purpose='x' where user_id=$1 returning 1`,[BOB])).length,0);
});

test('catalogue: titles, versions, licences and citations are public; inactive datasets are not listed',async()=>{
 assert.deepEqual((await q(db,'anon',null,`select id from public.research_datasets order by id`)).map(r=>r.id),['archive-open','institution-pack','kr-media-facades']);
 assert.deepEqual((await q(db,'anon',null,`select dataset_id from public.research_dataset_versions`)).map(r=>r.dataset_id),['kr-media-facades']);
 assert.equal(await code(q(db,'authenticated',ALICE,`insert into public.research_datasets(id,title_ko,tier,licence) values('mine','x','member','x')`)),'42501');
});

test('download check: service role only; member tier, version, format and profile with consent',async()=>{
 const check=(user,ds,v='1.0.0',f='csv')=>svc(db,`select public.research_download_check($1,$2,$3,$4) r`,[user,ds,v,f]).then(r=>r[0].r);
 assert.equal(await code(q(db,'authenticated',ALICE,`select public.research_download_check($1,'kr-media-facades','1.0.0','csv')`,[ALICE])),'42501');
 assert.equal(await code(q(db,'anon',null,`select public.research_download_check($1,'kr-media-facades','1.0.0','csv')`,[ALICE])),'42501');
 const ok=await check(ALICE,'kr-media-facades');
 assert.equal(ok.ok,true);
 assert.equal(ok.path,'kr-media-facades/1.0.0/kr-media-facades-1.0.0.csv');
 assert.equal(ok.sha256,'abc');
 assert.match(ok.citation,/v1\.0\.0/);
 assert.equal((await check(ALICE,'kr-media-facades','1.0.0','xlsx')).error,'format_not_available');
 assert.equal((await check(ALICE,'kr-media-facades','9.9.9')).error,'version_not_found');
 assert.equal((await check(ALICE,'archive-open')).error,'public_dataset_use_site');
 assert.equal((await check(ALICE,'institution-pack')).error,'institution_agreement_required');
 assert.equal((await check(ALICE,'retired')).error,'dataset_not_found');
 const [{id:carol}]=await rows(db,`insert into auth.users(email) values('carol@t') returning id`);
 assert.equal((await check(carol,'kr-media-facades')).error,'profile_and_consent_required');
});

test('download log: written by the service role only; members read their own rows',async()=>{
 assert.equal(await code(q(db,'authenticated',ALICE,`insert into public.research_downloads(user_id,dataset_id,version,format,ok) values($1,'kr-media-facades','1.0.0','csv',true)`,[ALICE])),'42501');
 await svc(db,`insert into public.research_downloads(user_id,dataset_id,version,format,ok,error) values($1,'kr-media-facades','1.0.0','csv',true,null),($2,'kr-media-facades','1.0.0','json',true,null),($2,'institution-pack','1.0.0','csv',false,'institution_agreement_required')`,[ALICE,BOB]);
 assert.equal((await q(db,'authenticated',ALICE,`select * from public.research_downloads`)).length,1);
 assert.equal((await q(db,'anon',null,`select 1 from public.research_downloads`).catch(e=>e.code)),'42501');
});

test('content reports: anyone files one, nobody but editors reads or handles it, and a report cannot pre-set its outcome',async()=>{
 await q(db,'anon',null,`insert into public.content_reports(project_id,image_id,reason,message) values('SEOUL006','img-87fc9bb640b2','person_image','A presidential visit photo, not the facade')`);
 await q(db,'anon',null,`insert into public.content_reports(project_id,reason,contact_email) values('SEOUL018','low_quality','reader@example.org')`);
 await q(db,'authenticated',ALICE,`insert into public.content_reports(project_id,reason,reporter) values('SEOUL043','image_unrelated',$1)`,[ALICE]);
 assert.equal(await code(q(db,'authenticated',ALICE,`insert into public.content_reports(project_id,reason,reporter) values('SEOUL043','image_unrelated',$1)`,[BOB])),'42501','not in someone else\'s name');
 assert.equal(await code(q(db,'anon',null,`insert into public.content_reports(project_id,reason,status) values('SEOUL006','other','accepted')`)),'42501');
 assert.equal(await code(q(db,'anon',null,`insert into public.content_reports(project_id,reason) values('SEOUL006','spam')`)),'23514');
 assert.equal(await code(q(db,'anon',null,`insert into public.content_reports(project_id,reason,contact_email) values('SEOUL006','other','not-an-email')`)),'23514');
 assert.equal(await code(q(db,'anon',null,`select * from public.content_reports`)),'42501');
 assert.equal((await q(db,'authenticated',ALICE,`select * from public.content_reports`)).length,0,'a member does not see reports, not even their own');
 const open=await q(db,'authenticated',EDITOR,`select id,reason from public.content_reports where status='open' order by id`);
 assert.deepEqual(open.map(r=>r.reason),['person_image','low_quality','image_unrelated']);
 await q(db,'authenticated',EDITOR,`update public.content_reports set status='rejected' where reason='low_quality'`);
 assert.equal((await rows(db,`select contact_email from public.content_reports where reason='low_quality'`))[0].contact_email,null,'the e-mail goes once the report is handled');
 await q(db,'authenticated',EDITOR,`update public.content_reports set status='accepted',handled_by=$1,handled_at=now(),note='blocked via editorial decision' where id=$2`,[EDITOR,open[0].id]);
 assert.equal(await code(q(db,'authenticated',EDITOR,`update public.content_reports set message='changed' where id=$1`,[open[0].id])),'42501','the report text is kept as filed');
 assert.equal((await q(db,'authenticated',ALICE,`update public.content_reports set status='rejected' returning id`)).length,0);
});

test('admin stats: aggregates only, for admins only',async()=>{
 assert.equal(await code(q(db,'authenticated',ALICE,`select public.research_admin_stats(30)`)),'42501');
 assert.equal(await code(q(db,'authenticated',EDITOR,`select public.research_admin_stats(30)`)),'42501');
 const [{s}]=await q(db,'authenticated',ADMIN,`select public.research_admin_stats(30) s`);
 assert.deepEqual([s.members,s.downloads,s.download_errors,s.active_downloaders,s.by_dataset['kr-media-facades'],s.user_types.researcher,s.open_reports],[2,2,1,2,2,1,1]);
 assert.ok(!JSON.stringify(s).includes('@t'),'no e-mail addresses');
});

test('account deletion: the profile goes, download rows keep their counts without the person',async()=>{
 await db.query(`delete from auth.users where id=$1`,[ALICE]);
 assert.equal((await rows(db,`select count(*)::int n from public.research_profiles where user_id=$1`,[ALICE]))[0].n,0);
 assert.equal((await rows(db,`select count(*)::int n from public.research_downloads where user_id is null`))[0].n,1);
 assert.equal((await rows(db,`select count(*)::int n from public.content_reports where reporter is null and project_id='SEOUL043'`))[0].n,1);
});
