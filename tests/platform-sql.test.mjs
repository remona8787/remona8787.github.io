// v2.0 platform migration (supabase/migrations/20261112000000_v2_platform.sql) on real Postgres (PGlite) with the
// Supabase stubs and default grants, after the archive and research migrations: the access rules of docs/PLATFORM.md
// for anon, members, applicants, approved researchers, editors and admins (with and without an MFA session), the
// content states, rule checks, rate limits, flags, appeals, photos, submissions, image permission requests, storage
// folders and account deletion. PGlite-tested only: not a substitute for a run on a Supabase project.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
const root=new URL('../',import.meta.url);
const sql=async f=>(await readFile(new URL(f,root),'utf8')).replace(/create extension if not exists "?pgcrypto"?[^;]*;/gi,'');
const MIGRATIONS=['supabase/migrations/20261018000000_media_facade_archive.sql','supabase/migrations/20261026000000_research_data.sql','supabase/migrations/20261112000000_v2_platform.sql','supabase/migrations/20261113000000_v2_photo_grades.sql','supabase/migrations/20261113010000_v2_admin_members.sql','supabase/migrations/20261113020000_v2_permission_ledger.sql','supabase/migrations/20261114000000_v2_submission_followup.sql'];
const DEFAULT_GRANTS=`alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`;
// A request as role with user sub and JWT claims (aal2 = an MFA session).
const as=(d,role,sub,fn,aal='aal1')=>d.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query(`select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)`,[sub||'',JSON.stringify({sub:sub||null,role,aal})]);return fn(tx)});
const q=(d,role,sub,text,params=[],aal)=>as(d,role,sub,tx=>tx.query(text,params),aal).then(r=>r.rows);
const user=(d,sub,text,params)=>q(d,'authenticated',sub,text,params);
const mfa=(d,sub,text,params)=>q(d,'authenticated',sub,text,params,'aal2');
const anon=(d,text,params)=>q(d,'anon',null,text,params);
const svc=(d,text,params)=>q(d,'service_role',null,text,params);
const err=async p=>{try{await p}catch(e){return e.message}return 'ok'};
const one=async p=>(await p)[0];

let db,ADMIN,EDITOR,ALICE,BOB,CAROL,UNCONFIRMED;
test.before(async()=>{
 db=new PGlite({extensions:{pg_trgm}});
 await db.exec(await sql('tests/sql/supabase-stubs.sql'));await db.exec(DEFAULT_GRANTS);
 // Supabase grants these on storage.objects (RLS decides); the stub schema does not.
 await db.exec(`grant select,insert,update,delete on storage.objects to anon,authenticated,service_role; grant select on storage.buckets to anon,authenticated,service_role;`);
 for(const f of MIGRATIONS)await db.exec(await sql(f));
 for(const f of MIGRATIONS.slice(2))await db.exec(await sql(f)); // the v2.0 migrations are safe to run again, in order
 [ADMIN,EDITOR,ALICE,BOB,CAROL]=(await db.query(`insert into auth.users(email,email_confirmed_at) values('admin@t',now()),('editor@t',now()),('alice@t',now()),('bob@t',now()),('carol@t',now()) returning id`)).rows.map(r=>r.id);
 UNCONFIRMED=(await db.query(`insert into auth.users(email) values('new@t') returning id`)).rows[0].id;
 await db.query(`insert into public.app_admins(user_id,role) values($1,'admin'),($2,'editor')`,[ADMIN,EDITOR]);
 await svc(db,`insert into public.research_datasets(id,title_ko,tier,licence,active) values
  ('aol-research','빛의 건축 연구용 통합 데이터셋','researcher','CC BY 4.0 (편집 부분) / 원자료별 라이선스',true),
  ('aol-images','이미지 권리 검증 데이터셋','researcher','CC BY 4.0 (편집 부분)',true),
  ('aol-open','공개 아카이브','public','CC0 / 각 출처',true)`);
 await svc(db,`insert into public.research_dataset_versions(dataset_id,version,data_as_of,record_count,formats,storage_prefix,sha256,citation) values
  ('aol-research','2.0.0','2026-11-12',1008,array['csv','json','geojson','xlsx'],'aol-research/2.0.0','{"csv":"abc"}','빛의 건축 (2026). 연구용 통합 데이터셋 v2.0.0.'),
  ('aol-images','2.0.0','2026-11-12',2734,array['csv'],'aol-images/2.0.0','{}','빛의 건축 (2026). 이미지 권리 검증 데이터셋 v2.0.0.')`);
 await user(db,BOB,`insert into public.member_profiles(user_id,display_name) values($1,'밤의 산책자')`,[BOB]);
});
const check=(u,ds='aol-research',fmt='csv')=>one(svc(db,`select public.research_download_check($1,$2,'2.0.0',$3) r`,[u,ds,fmt])).then(r=>r.r);
const apply=(u,extra={})=>user(db,u,`insert into public.researcher_applications(full_name,affiliation,applicant_type,research_field,purpose,requested_datasets,verification_url,terms_version,privacy_version)
 values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id,status`,[extra.name||'앨리스',extra.affiliation||'서울대학교',extra.type||'graduate_student','미디어 건축','국내 미디어파사드의 지역 분포와 운영 기간을 분석하는 석사 논문에 사용합니다.',extra.datasets||['aol-research'],'https://orcid.org/0000-0000-0000-0001',extra.terms||'2026-11','2026-11']);

test('anon: no base tables, no applications, only the public catalogue and views', async()=>{
 for(const t of ['researcher_applications','research_grants','community_posts','community_photos','community_submissions','content_flags','member_status','member_profiles','platform_audit_log','image_permission_requests','moderation_events','platform_settings'])
  assert.match(await err(anon(db,`select * from public.${t}`)),/permission denied/,t);
 assert.equal((await anon(db,`select count(*)::int n from public.research_datasets`))[0].n,3,'the catalogue is public');
 assert.equal((await anon(db,`select count(*)::int n from public.community_public_posts`))[0].n,0);
 assert.match(await err(anon(db,`select public.research_download_check($1,'aol-research','2.0.0','csv')`,[ALICE])),/permission denied/,'the check is the service role\'s');
 assert.deepEqual((await anon(db,`select public.platform_public_settings() s`))[0].s,{research_terms_version:'2026-11'});
});

test('a signed-in member without approval cannot download; an application alone is not enough', async()=>{
 assert.equal((await check(CAROL)).error,'researcher_approval_required');
 const a=await one(apply(ALICE));
 assert.equal(a.status,'submitted');
 assert.equal((await check(ALICE)).error,'researcher_approval_required');
 assert.match(await err(apply(ALICE)),/duplicate key|unique/,'one open application per member');
 assert.match(await err(user(db,UNCONFIRMED,`insert into public.researcher_applications(full_name,applicant_type,research_field,purpose,requested_datasets,terms_version,privacy_version) values('x','other','x field','a purpose long enough to pass the check',array['aol-research'],'2026-11','2026-11')`)),/row-level security|violates/,'an unconfirmed e-mail cannot apply');
 assert.match(await err(apply(BOB,{datasets:['aol-open']})),/unknown_dataset/,'only researcher datasets');
 // The applicant cannot approve themself or write decision fields.
 assert.match(await err(user(db,ALICE,`update public.researcher_applications set status='approved',decision_reason='ok',expires_at=now()+interval '9 years' where user_id=$1`,[ALICE])),/permission denied/,'no column grant on decision fields');
 await user(db,ALICE,`update public.researcher_applications set status='approved' where user_id=$1`,[ALICE]);
 const row=await one(user(db,ALICE,`select status,decision_reason,expires_at from public.researcher_applications where user_id=$1`,[ALICE]));
 assert.deepEqual([row.status,row.decision_reason,row.expires_at],['submitted',null,null]);
 assert.equal((await user(db,BOB,`select * from public.researcher_applications`)).length,0,'others\' applications are invisible');
});

test('staff decisions need the admin role and an MFA session; approval grants only the requested datasets', async()=>{
 const id=(await one(user(db,ALICE,`select id from public.researcher_applications where user_id=$1`,[ALICE]))).id;
 assert.match(await err(user(db,ALICE,`select public.research_application_decide($1,'approved')`,[id])),/staff role required/);
 assert.match(await err(mfa(db,EDITOR,`select public.research_application_decide($1,'approved')`,[id])),/staff role required/,'editors moderate content, admins approve researchers');
 assert.match(await err(user(db,ADMIN,`select public.research_application_decide($1,'approved')`,[id])),/mfa_required/,'an admin without MFA is refused');
 assert.match(await err(mfa(db,ADMIN,`select public.research_application_decide($1,'rejected')`,[id])),/reason_required/);
 await mfa(db,ADMIN,`select public.research_application_decide($1,'needs_info','소속 확인 링크를 추가해 주세요.')`,[id]);
 await user(db,ALICE,`update public.researcher_applications set verification_note='지도교수: 홍길동 교수 (학과 홈페이지 참고)' where id=$1`,[id]);
 assert.equal((await one(user(db,ALICE,`select status from public.researcher_applications where id=$1`,[id]))).status,'submitted','an answer to needs_info goes back to submitted');
 const r=await one(mfa(db,ADMIN,`select public.research_application_decide($1,'approved','확인 완료',now()+interval '1 year') r`,[id]));
 assert.equal(r.r.grants,1);
 const ok=await check(ALICE);
 assert.equal(ok.ok,true);
 assert.equal(ok.path,'aol-research/2.0.0/aol-research-2.0.0.csv');
 assert.equal((await check(ALICE,'aol-images')).error,'dataset_not_granted','only the granted dataset');
 assert.equal((await check(ALICE,'aol-images','json')).error,'format_not_available');
 assert.equal((await check(ALICE,'aol-open')).error,'public_dataset_use_site');
 assert.equal((await user(db,BOB,`select * from public.research_grants`)).length,0);
 assert.equal((await user(db,ALICE,`select * from public.research_grants`)).length,1);
 const audit=await svc(db,`select action,target_id from public.platform_audit_log where target_type='researcher_application' order by id`);
 assert.deepEqual(audit.map(a=>a.action),['research_application_needs_info','research_application_approved']);
});

test('terms updates, suspension, expiry and revocation block new downloads at once', async()=>{
 await svc(db,`update public.platform_settings set value='"2027-01"' where key='research_terms_version'`);
 assert.equal((await check(ALICE)).error,'terms_update_required');
 assert.match(await err(user(db,ALICE,`update public.researcher_applications set purpose='바뀐 목적입니다. 다른 연구에 쓰겠습니다.' where user_id=$1 and status='approved'`,[ALICE])),/approved_application_locked/);
 await user(db,ALICE,`update public.researcher_applications set terms_version='2027-01' where user_id=$1 and status='approved'`,[ALICE]);
 assert.equal((await check(ALICE)).ok,true,'accepting the new terms restores access');
 await mfa(db,ADMIN,`select public.platform_set_member_status($1,'suspended','스팸 게시',now()+interval '7 days')`,[ALICE]);
 assert.equal((await check(ALICE)).error,'account_restricted');
 await mfa(db,ADMIN,`select public.platform_set_member_status($1,'active',null)`,[ALICE]);
 assert.equal((await check(ALICE)).ok,true);
 await svc(db,`update public.research_grants set expires_at=now()-interval '1 minute' where user_id=$1`,[ALICE]);
 assert.equal((await check(ALICE)).error,'access_expired');
 await svc(db,`update public.research_grants set expires_at=now()+interval '30 days' where user_id=$1`,[ALICE]);
 const id=(await one(svc(db,`select id from public.researcher_applications where user_id=$1 and status='approved'`,[ALICE]))).id;
 assert.match(await err(mfa(db,ADMIN,`select public.research_application_decide($1,'revoked')`,[id])),/reason_required/);
 await mfa(db,ADMIN,`select public.research_application_decide($1,'revoked','이용조건 위반 신고 확인')`,[id]);
 assert.equal((await check(ALICE)).error,'researcher_approval_required','revoked: the next request is refused');
 assert.equal((await svc(db,`select count(*)::int n from public.research_grants where user_id=$1 and revoked_at is null`,[ALICE]))[0].n,0);
 // A revoked researcher may apply again.
 assert.equal((await one(apply(ALICE))).status,'submitted');
});

test('posts: pending until staff approve, public without user ids, edits of approved posts go back to pending', async()=>{
 const p=await one(user(db,BOB,`insert into public.community_posts(kind,project_id,title,body,status,user_id,author_name) values('review','SEOUL006','DDP 서울라이트 후기','저녁 8시에 보았는데 외벽 전체가 움직이는 장면이 인상적이었어요.','approved',$1,'관리자') returning id,status,author_name,user_id`,[ALICE]));
 assert.equal(p.status,'pending','a member cannot publish');
 assert.equal(p.author_name,'밤의 산책자','the display name comes from the profile');
 assert.equal(p.user_id,BOB,'the owner is the session user');
 assert.equal((await anon(db,`select count(*)::int n from public.community_public_posts`))[0].n,0,'pending is not public');
 assert.match(await err(user(db,BOB,`update public.community_posts set status='approved' where id=$1`,[p.id])),/status_not_allowed/);
 assert.match(await err(user(db,BOB,`select public.platform_moderate('post',$1,'approved')`,[p.id])),/staff role required/,'a member cannot call staff functions');
 await mfa(db,EDITOR,`select public.platform_moderate('post',$1,'approved')`,[p.id]);
 const pub=await anon(db,`select * from public.community_public_posts`);
 assert.equal(pub.length,1);
 assert.ok(!('user_id' in pub[0]),'no user id in the public view');
 await user(db,BOB,`update public.community_posts set body=body||' 다시 가고 싶어요.' where id=$1`,[p.id]);
 assert.equal((await one(user(db,BOB,`select status from public.community_posts where id=$1`,[p.id]))).status,'pending');
 assert.equal((await anon(db,`select count(*)::int n from public.community_public_posts`))[0].n,0,'an edited post is hidden until approved again');
 await mfa(db,EDITOR,`select public.platform_moderate('post',$1,'approved')`,[p.id]);
 assert.equal((await user(db,CAROL,`select * from public.community_posts`)).length,0,'other members read through the public view only');
 // Comments only under public posts; likes once per member.
 const c=await one(user(db,CAROL,`insert into public.community_comments(post_id,body) values($1,'저도 지난주에 다녀왔어요!') returning id,status`,[p.id]));
 assert.equal(c.status,'pending');
 await user(db,CAROL,`insert into public.community_likes(post_id,user_id) values($1,$2)`,[p.id,CAROL]);
 assert.match(await err(user(db,CAROL,`insert into public.community_likes(post_id,user_id) values($1,$2)`,[p.id,CAROL])),/duplicate|unique/);
 assert.equal((await anon(db,`select like_count::int n from public.community_public_posts where id=$1`,[p.id]))[0].n,1);
 const hidden=await one(user(db,BOB,`insert into public.community_posts(kind,title,body) values('question','미공개 질문','아직 승인되지 않은 질문입니다. 댓글이 달리면 안 돼요.') returning id`));
 assert.match(await err(user(db,CAROL,`insert into public.community_comments(post_id,body) values($1,'댓글')`,[hidden.id])),/post_not_public/);
 assert.match(await err(user(db,CAROL,`insert into public.community_likes(post_id,user_id) values($1,$2)`,[hidden.id,CAROL])),/row-level security/);
});

test('rule checks: unsafe links blocked, personal data sent to a person, rate limits, restricted accounts', async()=>{
 assert.match(await err(user(db,CAROL,`insert into public.community_posts(kind,title,body) values('info','링크','여기를 눌러 보세요 javascript:alert(1) 이벤트 안내입니다')`)),/content_blocked: unsafe_scheme/);
 assert.match(await err(user(db,CAROL,`insert into public.community_posts(kind,title,body) values('info','광고','https://a.example https://b.example https://c.example https://d.example 할인')`)),/too_many_links/);
 const pii=await one(user(db,CAROL,`insert into public.community_posts(kind,title,body) values('question','연락처','궁금한 점은 010-1234-5678로 연락 주세요. 감사합니다.') returning status,moderation`));
 assert.equal(pii.status,'needs_review');
 assert.deepEqual(pii.moderation.flags,['privacy:phone']);
 assert.equal((await one(user(db,CAROL,`insert into public.community_posts(kind,title,body,status) values('question','임시 저장','아직 다 쓰지 않은 글입니다. 나중에 마저 쓸게요.','draft') returning status`))).status,'draft','drafts are kept private');
 await svc(db,`update public.platform_settings set value='4' where key='post_hourly_limit'`);
 for(let i=0;i<2;i++)await user(db,CAROL,`insert into public.community_posts(kind,title,body) values('question','질문 ${i}','반복 게시 확인용 질문 본문입니다 ${i}.')`);
 assert.match(await err(user(db,CAROL,`insert into public.community_posts(kind,title,body) values('question','하나 더','이번에는 시간당 제한에 걸려야 합니다.')`)),/rate_limited/);
 await svc(db,`update public.platform_settings set value='10' where key='post_hourly_limit'`);
 assert.match(await err(user(db,UNCONFIRMED,`insert into public.community_posts(kind,title,body) values('question','미인증','이메일 인증 전에는 글을 쓸 수 없어야 합니다.')`)),/account_restricted/);
 await mfa(db,ADMIN,`select public.platform_set_member_status($1,'banned','반복적인 광고')`,[CAROL]);
 assert.match(await err(user(db,CAROL,`insert into public.community_posts(kind,title,body) values('question','차단','정지된 계정은 글을 쓸 수 없어야 합니다.')`)),/account_restricted/);
 // An appeal about the account restriction; one open appeal at a time.
 await user(db,CAROL,`insert into public.moderation_appeals(target_type,message) values('account','광고가 아니라 행사 안내였습니다. 다시 검토해 주세요.')`);
 assert.match(await err(user(db,CAROL,`insert into public.moderation_appeals(target_type,message) values('account','두 번째 이의신청입니다. 열려 있는 것이 있습니다.')`)),/duplicate|unique/);
 const ap=await one(mfa(db,EDITOR,`select id from public.moderation_appeals where user_id=$1`,[CAROL]));
 await mfa(db,EDITOR,`select public.appeal_decide($1,'reversed','행사 안내로 확인')`,[ap.id]);
 assert.equal((await svc(db,`select state from public.member_status where user_id=$1`,[CAROL]))[0].state,'active');
});

test('flags: three members or one child-safety flag hide an approved item; non-members file copyright notices only', async()=>{
 const p=await one(svc(db,`select id from public.community_posts where status='approved' limit 1`));
 for(const u of [ALICE,CAROL])await user(db,u,`insert into public.content_flags(target_type,target_id,reason,reporter) values('post',$1,'spam',$2)`,[p.id,u]);
 assert.equal((await svc(db,`select status from public.community_posts where id=$1`,[p.id]))[0].status,'approved','two flags: still public');
 await user(db,EDITOR,`insert into public.content_flags(target_type,target_id,reason,reporter) values('post',$1,'spam',$2)`,[p.id,EDITOR]);
 assert.equal((await svc(db,`select status from public.community_posts where id=$1`,[p.id]))[0].status,'needs_review','three distinct flags hide it');
 assert.match(await err(anon(db,`insert into public.content_flags(target_type,target_id,reason) values('post',$1,'spam')`,[p.id])),/sign_in_required_or_copyright_notice/);
 await anon(db,`insert into public.content_flags(target_type,target_id,reason,contact_email,message) values('photo',1,'copyright','owner@example.org','제가 찍은 사진입니다.')`);
 assert.equal((await user(db,ALICE,`select * from public.content_flags`)).length,0,'members do not read flags');
 const f=await one(mfa(db,EDITOR,`select id from public.content_flags where reason='copyright'`));
 await mfa(db,EDITOR,`select public.flag_handle($1,'actioned','사진 내림')`,[f.id]);
 assert.equal((await svc(db,`select contact_email from public.content_flags where id=$1`,[f.id]))[0].contact_email,null,'the reply address is erased once handled');
 await mfa(db,EDITOR,`select public.platform_moderate('post',$1,'approved')`,[p.id]);
 await user(db,ALICE,`insert into public.content_flags(target_type,target_id,reason,reporter) values('post',$1,'child_safety',$2)`,[p.id,ALICE]);
 assert.equal((await svc(db,`select status from public.community_posts where id=$1`,[p.id]))[0].status,'needs_review','child safety: hidden at once');
 await mfa(db,EDITOR,`select public.platform_moderate('post',$1,'removed','운영정책 위반')`,[p.id]);
 assert.match(await err(user(db,BOB,`update public.community_posts set title='고쳤어요' where id=$1`,[p.id])),/content_removed_locked/);
 await user(db,BOB,`insert into public.moderation_appeals(target_type,target_id,message) values('post',$1,'오해입니다. 내용을 다시 확인해 주세요.')`,[p.id]);
 assert.match(await err(user(db,ALICE,`insert into public.moderation_appeals(target_type,target_id,message) values('post',$1,'남의 글에 대한 이의신청은 안 됩니다.')`,[p.id])),/row-level security/);
});

test('photos: own folder, required statements, approval only through publish, official adoption separate', async()=>{
 const row=(u,path,extra='')=>user(db,u,`insert into public.community_photos(project_id,upload_path,mime,bytes,width,height,own_photo,can_license,people_ok,artwork_rights_notice,licence,offer_official${extra?','+extra.split('=')[0]:''})
  values('SEOUL006',$1,'image/jpeg',2000000,3000,2000,true,true,true,true,'cc-by-4.0',true${extra?','+extra.split('=')[1]:''}) returning id,status,official_review,public_path`,[path]);
 assert.match(await err(row(BOB,`${ALICE}/a.jpg`)),/community_photos_own_folder/);
 assert.match(await err(user(db,BOB,`insert into public.community_photos(project_id,upload_path,mime,bytes,width,height,own_photo,can_license,people_ok,artwork_rights_notice) values('SEOUL006',$1,'image/jpeg',1000,3000,2000,false,true,true,true)`,[`${BOB}/b.jpg`])),/check constraint/,'own photo statement required');
 assert.match(await err(user(db,BOB,`insert into public.community_photos(project_id,upload_path,mime,bytes,width,height,own_photo,can_license,people_ok,artwork_rights_notice) values('SEOUL006',$1,'image/gif',1000,3000,2000,true,true,true,true)`,[`${BOB}/b.gif`])),/check constraint/);
 const ph=await one(row(BOB,`${BOB}/ddp-night.jpg`));
 assert.deepEqual([ph.status,ph.official_review,ph.public_path],['pending','pending',null]);
 assert.match(await err(mfa(db,EDITOR,`select public.platform_moderate('photo',$1,'approved')`,[ph.id])),/photo_not_published_use_publish_photo/);
 const H1='a'.repeat(64),H2='b'.repeat(64);
 assert.match(await err(svc(db,`select public.platform_photo_published($1,'community/x.jpg',$2,'B',$3)`,[ph.id,BOB,H1])),/staff role required/);
 assert.match(await err(svc(db,`select public.platform_photo_published($1,'SEOUL006/1.jpg',$2,null,$3)`,[ph.id,EDITOR,H1])),/grade_required/,'publishing needs the staff grade');
 assert.match(await err(svc(db,`select public.platform_photo_published($1,'SEOUL006/1.jpg',$2,'B','x')`,[ph.id,EDITOR])),/hash_required/);
 // v2.0: the member sets the credit line only; a grade or hash they send is dropped.
 await user(db,BOB,`update public.community_photos set credit_name='김사진',grade='A',sha256=$2 where id=$1`,[ph.id,H2]);
 assert.deepEqual(Object.values((await svc(db,`select credit_name,grade,sha256 from public.community_photos where id=$1`,[ph.id]))[0]),['김사진',null,null]);
 assert.match(await err(user(db,BOB,`update public.community_photos set credit_name='https://spam.example' where id=$1`,[ph.id])),/check constraint/,'no links in the credit line');
 await svc(db,`select public.platform_photo_published($1,'SEOUL006/1.jpg',$2,'B',$3)`,[ph.id,EDITOR,H1]);
 const pub=await anon(db,`select * from public.community_public_photos`);
 assert.equal(pub.length,1);
 assert.equal(pub[0].public_path,'SEOUL006/1.jpg');
 assert.deepEqual([pub[0].credit,pub[0].grade],['김사진','B']);
 // The same file (same SHA-256) is never published twice.
 const dup=await one(row(BOB,`${BOB}/ddp-night-copy.jpg`));
 assert.match(await err(svc(db,`select public.platform_photo_published($1,'SEOUL006/2.jpg',$2,'B',$3)`,[dup.id,EDITOR,H1])),/duplicate_photo/);
 assert.ok(!('user_id' in pub[0]) && !('upload_path' in pub[0]));
 await mfa(db,EDITOR,`select public.platform_photo_official($1,'accepted','작품 일치 확인')`,[ph.id]);
 assert.equal((await svc(db,`select official_review from public.community_photos where id=$1`,[ph.id]))[0].official_review,'accepted');
 // A copyright takedown: removed, gone from the public view.
 await mfa(db,EDITOR,`select public.platform_moderate('photo',$1,'removed','저작권 침해 신고 확인')`,[ph.id]);
 assert.equal((await anon(db,`select count(*)::int n from public.community_public_photos`))[0].n,0);
 // Storage: own folder only; staff read for review.
 const put=(u,name)=>user(db,u,`insert into storage.objects(bucket_id,name,owner) values('community-uploads',$1,$2)`,[name,u]);
 await put(BOB,`${BOB}/x.jpg`);
 assert.match(await err(put(BOB,`${ALICE}/x.jpg`)),/row-level security/);
 assert.match(await err(put(BOB,`${BOB}/x.svg`)),/row-level security/);
 assert.equal((await user(db,ALICE,`select * from storage.objects where bucket_id='community-uploads'`)).length,0);
 assert.equal((await mfa(db,EDITOR,`select * from storage.objects where bucket_id='community-uploads'`)).length,1);
 assert.equal((await svc(db,`select public from storage.buckets where id='community-uploads'`))[0].public,false);
});

test('submissions: incomplete drafts, required fields on submit, approval needs a project id', async()=>{
 const d=await one(user(db,ALICE,`insert into public.community_submissions(kind,name) values('new_project','청주 미디어파사드') returning id,status`));
 assert.equal(d.status,'draft');
 assert.match(await err(user(db,ALICE,`update public.community_submissions set status='pending' where id=$1`,[d.id])),/missing_fields: country_iso2,city_or_venue,project_type,description,source/);
 await user(db,ALICE,`update public.community_submissions set country_iso2='KR',city='청주',project_type='media_facade',description='청주시 문화제조창 외벽에서 상영되는 미디어파사드 작품입니다. 2024년 공개.',official_url='https://example.org/cheongju',status='pending' where id=$1`,[d.id]);
 assert.equal((await one(user(db,ALICE,`select status from public.community_submissions where id=$1`,[d.id]))).status,'pending');
 assert.match(await err(mfa(db,EDITOR,`select public.platform_moderate('submission',$1,'approved')`,[d.id])),/project_id_required/);
 await mfa(db,EDITOR,`select public.platform_moderate('submission',$1,'approved',null,'REG-CM-0001')`,[d.id]);
 assert.equal((await svc(db,`select approved_project_id from public.community_submissions where id=$1`,[d.id]))[0].approved_project_id,'REG-CM-0001');
 assert.equal((await one(user(db,ALICE,`insert into public.community_submissions(kind,name,official_url,status) values('tip','부산 빛 축제','https://example.org/busan','pending') returning status`))).status,'pending');
});

test('submission follow-up (v2.0): staff ask for more information; photos ride with the submission and follow its decision', async()=>{
 const fill=`country_iso2='KR',city='수원',project_type='media_facade',description='수원 화성행궁 앞 광장의 미디어파사드 작품입니다. 2025년 가을 공개.',official_url='https://example.org/suwon'`;
 const s=await one(user(db,ALICE,`insert into public.community_submissions(kind,name) values('new_project','수원 미디어파사드') returning id`));
 await user(db,ALICE,`update public.community_submissions set ${fill},status='pending' where id=$1`,[s.id]);
 // A request for more information: submissions only, from review, with the request written; the author gets a draft.
 assert.match(await err(mfa(db,EDITOR,`select public.platform_moderate('submission',$1,'needs_info')`,[s.id])),/reason_required/);
 const post=await one(user(db,ALICE,`insert into public.community_posts(kind,project_id,title,body,status) values('review','SEOUL006','보완 시험','본문입니다. 좋았어요.','pending') returning id`));
 assert.match(await err(mfa(db,EDITOR,`select public.platform_moderate('post',$1,'needs_info','x')`,[post.id])),/needs_info_submissions_only/);
 assert.match(await err(user(db,ALICE,`select public.platform_moderate('submission',$1,'needs_info','x')`,[s.id])),/staff role required|mfa_required|permission denied/);
 await mfa(db,EDITOR,`select public.platform_moderate('submission',$1,'needs_info','공식 출처(보도자료나 운영기관 페이지) 링크를 하나 더 붙여 주세요.')`,[s.id]);
 let r=await one(user(db,ALICE,`select status,decision_reason from public.community_submissions where id=$1`,[s.id]));
 assert.deepEqual([r.status,r.decision_reason],['draft','공식 출처(보도자료나 운영기관 페이지) 링크를 하나 더 붙여 주세요.']);
 assert.match(await err(mfa(db,EDITOR,`select public.platform_moderate('submission',$1,'needs_info','again')`,[s.id])),/draft_not_submitted/,'nothing to decide while the author edits');
 await user(db,ALICE,`update public.community_submissions set source_urls=array['https://example.org/press'],decision_reason=null,status='pending' where id=$1`,[s.id]);
 r=await one(user(db,ALICE,`select status,decision_reason,source_urls from public.community_submissions where id=$1`,[s.id]));
 assert.equal(r.status,'pending');assert.deepEqual(r.source_urls,['https://example.org/press']);assert.ok(r.decision_reason,'the member cannot erase the request');
 assert.equal((await one(svc(db,`select count(*)::int n from public.moderation_events where target_type='submission' and target_id=$1 and decision='needs_info'`,[s.id]))).n,1);
 // Photos with the submission: own open submission only, up to the limit, no project id until approval.
 const photo=(u,sid,file,extra='')=>user(db,u,`insert into public.community_photos(project_id,submission_id,upload_path,mime,bytes,width,height,own_photo,can_license,people_ok,artwork_rights_notice) values('SEOUL006',$1,$2,'image/jpeg',1000,3000,2000,true,true,true,true) returning id,project_id,status`,[sid,`${u}/${file}`]);
 const p1=await one(photo(ALICE,s.id,'sub-a.jpg'));
 assert.equal(p1.project_id,null,'a new project has no id yet: the one the member sent is not kept');
 assert.match(await err(photo(BOB,s.id,'sub-b.jpg')),/submission_not_found/,'not someone else\'s submission');
 await svc(db,`update public.platform_settings set value='2' where key='submission_photo_limit'`);
 await photo(ALICE,s.id,'sub-c.jpg');
 assert.match(await err(photo(ALICE,s.id,'sub-d.jpg')),/submission_photo_limit/);
 await svc(db,`update public.platform_settings set value='5' where key='submission_photo_limit'`);
 await user(db,ALICE,`update public.community_photos set project_id='SEOUL001',submission_id=null where id=$1`,[p1.id]);
 assert.deepEqual(Object.values(await one(svc(db,`select project_id,submission_id from public.community_photos where id=$1`,[p1.id]))),[null,s.id],'the member cannot move it');
 assert.match(await err(user(db,ALICE,`insert into public.community_photos(upload_path,mime,bytes,width,height,own_photo,can_license,people_ok,artwork_rights_notice) values($1,'image/jpeg',1000,3000,2000,true,true,true,true)`,[`${ALICE}/none.jpg`])),/community_photos_target|check constraint/,'a photo needs a project or a submission');
 // Approval with a project id gives the photos that id; they still wait for a staff grade.
 await mfa(db,EDITOR,`select public.platform_moderate('submission',$1,'approved',null,'REG-CM-0002')`,[s.id]);
 const after=await svc(db,`select project_id,status,public_path from public.community_photos where submission_id=$1`,[s.id]);
 assert.ok(after.length===2&&after.every(x=>x.project_id==='REG-CM-0002'&&x.public_path===null&&x.status!=='approved'));
 assert.match(await err(photo(ALICE,s.id,'late.jpg')),/submission_closed/,'a decided submission takes no more photos');
 // A correction's photos take the existing project's id at once; rejecting the submission rejects its waiting photos.
 const c=await one(user(db,ALICE,`insert into public.community_submissions(kind,project_id,field_name,proposed_value,source_urls,status) values('correction','SEOUL006','year_installed','2019',array['https://example.org/ddp'],'pending') returning id`));
 const cp=await one(photo(ALICE,c.id,'corr.jpg'));
 assert.equal(cp.project_id,'SEOUL006');
 await mfa(db,EDITOR,`select public.platform_moderate('submission',$1,'rejected','출처가 정정 내용을 뒷받침하지 않아요.')`,[c.id]);
 r=await one(svc(db,`select status,decision_reason from public.community_photos where id=$1`,[cp.id]));
 assert.equal(r.status,'rejected');assert.match(r.decision_reason,/반려/);
});

test('automatic moderation: service role only; photos and submissions always wait for a person', async()=>{
 const p=await one(user(db,ALICE,`insert into public.community_posts(kind,title,body) values('info','전시 소식','다음 달부터 새로운 미디어아트 전시가 열린다고 합니다.') returning id`));
 assert.match(await err(user(db,ALICE,`select public.platform_moderation_apply('post',$1,'approved','{}','test')`,[p.id])),/permission denied/);
 const pend=await svc(db,`select * from public.platform_moderation_pending(100)`);
 assert.ok(pend.some(x=>x.target_type==='post'&&Number(x.target_id)===Number(p.id)));
 let r=await one(svc(db,`select public.platform_moderation_apply('post',$1,'approved','{"safe":0.99}','claude-test') r`,[p.id]));
 assert.equal(r.r.status,'needs_review','auto approval is off by default');
 await svc(db,`update public.platform_settings set value='true' where key='auto_approve_text'`);
 const p2=await one(user(db,ALICE,`insert into public.community_posts(kind,title,body) values('info','또 다른 소식','주말마다 야간 개장을 한다고 합니다. 확인해 보세요.') returning id`));
 r=await one(svc(db,`select public.platform_moderation_apply('post',$1,'approved','{"safe":0.99}','claude-test') r`,[p2.id]));
 assert.equal(r.r.status,'approved');
 assert.equal((await svc(db,`select count(*)::int n from public.moderation_events where target_type='post' and target_id=$1 and source='auto'`,[p2.id]))[0].n,1);
 await svc(db,`update public.platform_settings set value='false' where key='auto_approve_text'`);
});

test('roles, statistics, audit, image permission requests: staff only; the last admin stays', async()=>{
 assert.match(await err(mfa(db,EDITOR,`select public.platform_set_role($1,'admin')`,[BOB])),/staff role required/);
 assert.match(await err(mfa(db,ADMIN,`select public.platform_set_role($1,null)`,[ADMIN])),/last_admin/);
 const st=(await one(mfa(db,EDITOR,`select public.platform_admin_stats() s`))).s;
 assert.ok(st.queue && st.published);
 assert.match(await err(mfa(db,EDITOR,`select public.platform_audit_recent()`)),/staff role required/);
 assert.ok((await one(mfa(db,ADMIN,`select jsonb_array_length(public.platform_audit_recent()) n`))).n>0);
 const q=(await one(mfa(db,ADMIN,`select public.platform_admin_queue('application','submitted') q`))).q;
 assert.ok(q.every(a=>a.email),'admins see the applicant e-mail to review');
 assert.ok((await one(mfa(db,EDITOR,`select public.platform_admin_queue('post','needs_review') q`))).q.every(x=>!('user_id' in x)),'the queue lists items, not member ids');
 await mfa(db,EDITOR,`insert into public.image_permission_requests(project_id,image_ref,rights_holder,contact_channel,contact_value) values('SEOUL018','https://example.org/photo.jpg','롯데월드타워 홍보팀','web_form','https://example.org/contact')`);
 assert.equal((await user(db,ALICE,`select * from public.image_permission_requests`)).length,0);
 assert.equal((await user(db,EDITOR,`select * from public.image_permission_requests`)).length,0,'staff without an MFA session see nothing');
 await mfa(db,EDITOR,`update public.image_permission_requests set contact_source='https://example.org/about (공식 사이트 문의 페이지)',holder_basis='사진 페이지에 저작권자로 표시',draft_text='초안'`);
 await mfa(db,EDITOR,`update public.image_permission_requests set status='sent'`);
 const ip=await one(mfa(db,EDITOR,`select status,requested_at from public.image_permission_requests`));
 assert.equal(ip.status,'sent');assert.ok(ip.requested_at);
 const me=(await one(user(db,ALICE,`select public.my_account() m`))).m;
 assert.equal(me.email_confirmed,true);
 assert.equal(me.application.status,'submitted');
 assert.equal(me.staff_role,null);
});

test('permission ledger (v2.0 P1): no step rests on a guess; closed requests stay closed; applying needs an approval', async()=>{
 const ins=(extra='')=>one(mfa(db,EDITOR,`insert into public.image_permission_requests(project_id,image_ref,rights_holder,contact_channel,contact_value${extra?','+extra.split('=')[0]:''}) values('SEOUL006','https://example.org/ddp.jpg','DDP 홍보팀','email','press@example.org'${extra?','+extra.split('=')[1]:''}) returning id`));
 assert.match(await err(mfa(db,EDITOR,`insert into public.image_permission_requests(project_id,image_ref,rights_holder,contact_channel,status) values('SEOUL006','x.jpg','누군가','email','approved')`)),/permission_new_must_be_draft/);
 const {id}=await ins();
 const set=(cols)=>mfa(db,EDITOR,`update public.image_permission_requests set ${cols} where id=${id}`);
 assert.match(await err(set(`status='sent'`)),/permission_send_incomplete/,'no source, basis or draft');
 await set(`contact_source='https://example.org/press (보도자료 페이지의 홍보팀 메일)'`);
 await set(`holder_basis='사진 설명에 DDP 제공으로 표시'`);
 assert.match(await err(set(`status='sent'`)),/permission_send_incomplete/,'no saved draft');
 await set(`draft_subject='[빛의 건축] 사진 사용 허락 요청',draft_text='DDP 홍보팀 담당자님께, ...'`);
 await set(`status='sent',sent_by=null,requested_at='2020-01-01'`);
 let r=await one(mfa(db,EDITOR,`select status,sent_by,requested_at from public.image_permission_requests where id=${id}`));
 assert.equal(r.status,'sent');assert.equal(r.sent_by,EDITOR,'who sent it is the server\'s record');
 assert.match(await err(set(`status='draft'`)),/permission_step_not_allowed/,'a sent request does not go back to draft');
 assert.match(await err(set(`status='approved'`)),/permission_reply_note/);
 await set(`reply_note='2026-11-13 메일 회신: 저작자 표시 조건으로 허락'`);
 assert.match(await err(set(`status='approved'`)),/permission_approval_incomplete/,'scope and evidence');
 assert.match(await err(set(`applied_at=now(),applied_ref='x-decision'`)),/permission_apply_needs_approval/,'not before approval');
 await set(`granted_scope='상세 페이지 게시, 저작자 표시 ⓒDDP',evidence_note='회신 메일 보관(운영자 메일함, 2026-11-13)',valid_until='2027-11-13',status='approved'`);
 assert.match(await err(set(`applied_at=now()`)),/permission_apply_needs_approval/,'the decision it went into is required');
 await set(`applied_at=now(),applied_ref='editorial/decisions/2026-11-13-set_image.json'`);
 await set(`applied_at=null`);
 r=await one(mfa(db,EDITOR,`select applied_at,applied_ref,response_at from public.image_permission_requests where id=${id}`));
 assert.ok(r.applied_at&&r.applied_ref&&r.response_at,'an applied record stays');
 await set(`status='revoked'`);
 assert.ok((await one(mfa(db,EDITOR,`select revoked_at from public.image_permission_requests where id=${id}`))).revoked_at);
 assert.match(await err(set(`status='approved'`)),/permission_step_not_allowed/,'a revoked permission is not reopened');
 const acts=(await db.query(`select action from public.platform_audit_log where target_type='image_permission_request' and target_id='${id}' order by id`)).rows.map(x=>x.action);
 assert.deepEqual(acts,['permission_sent','permission_approved','permission_applied','permission_revoked']);
 // No contact found: the note says what was searched; it can go back to draft when one turns up.
 const nc=await ins();
 assert.match(await err(mfa(db,EDITOR,`update public.image_permission_requests set status='no_contact' where id=${nc.id}`)),/permission_no_contact_note/);
 await mfa(db,EDITOR,`update public.image_permission_requests set status='no_contact',evidence_note='공식 사이트·SNS·보도자료에 연락처 없음(2026-11-13)' where id=${nc.id}`);
 await mfa(db,EDITOR,`update public.image_permission_requests set status='draft' where id=${nc.id}`);
 assert.equal((await user(db,ALICE,`select id from public.image_permission_requests`)).length,0,'members see none');
});

test('account deletion removes the member\'s rows; logs keep no person', async()=>{
 const before=(await svc(db,`select count(*)::int n from public.community_posts where user_id=$1`,[BOB]))[0].n;
 assert.ok(before>0);
 await db.query(`delete from auth.users where id=$1`,[BOB]);
 for(const t of ['community_posts','community_photos','community_likes','member_profiles','moderation_appeals'])
  assert.equal((await svc(db,`select count(*)::int n from public.${t} where user_id=$1`,[BOB]))[0].n,0,t);
 await db.query(`delete from auth.users where id=$1`,[ALICE]);
 assert.equal((await svc(db,`select count(*)::int n from public.researcher_applications where user_id=$1`,[ALICE]))[0].n,0);
 assert.equal((await svc(db,`select count(*)::int n from public.research_grants where user_id=$1`,[ALICE]))[0].n,0);
 assert.equal((await svc(db,`select count(*)::int n from public.content_flags where reporter=$1`,[ALICE]))[0].n,0,'flags lose the reporter');
 assert.ok((await svc(db,`select count(*)::int n from public.platform_audit_log`))[0].n>0,'the audit log stays');
});

let DANA;
test('operator lists (v2.0): members, research grants and downloads for admins with MFA only; viewing members is audited', async()=>{
 DANA=(await db.query(`insert into auth.users(email,email_confirmed_at) values('dana@t',now()) returning id`)).rows[0].id;
 await user(db,DANA,`insert into public.member_profiles(user_id,display_name) values($1,'밤의 산책자')`,[DANA]);
 assert.match(await err(user(db,ALICE,`select public.platform_member_list()`)),/admin|staff|role/i,'a member cannot list members');
 assert.match(await err(mfa(db,EDITOR,`select public.platform_member_list()`)),/admin/i,'nor an editor');
 assert.match(await err(user(db,ADMIN,`select public.platform_member_list()`)),/mfa_required/,'an admin needs the second factor');
 const list=(await one(mfa(db,ADMIN,`select public.platform_member_list('dana') r`))).r;
 assert.equal(list.length,1);
 assert.deepEqual([list[0].email,list[0].display_name,list[0].state,list[0].email_confirmed],['dana@t','밤의 산책자','active',true]);
 const audit=await svc(db,`select action,detail from public.platform_audit_log where action='member_list_viewed' order by id desc limit 1`);
 assert.equal(audit[0].detail.query,'dana','who looked for whom is in the audit log');
 assert.ok(Array.isArray((await one(mfa(db,ADMIN,`select public.platform_research_grants() r`))).r));
 assert.ok(Array.isArray((await one(mfa(db,ADMIN,`select public.platform_research_downloads() r`))).r));
 assert.match(await err(mfa(db,EDITOR,`select public.platform_research_downloads()`)),/admin/i);
});

test('public profiles (v2.0): a random public id the member cannot set, an opt-out, and no contacts or staff-like names', async()=>{
 const before=(await svc(db,`select public_id from public.member_profiles where user_id=$1`,[DANA]))[0].public_id;
 await user(db,DANA,`update public.member_profiles set public_id=gen_random_uuid(), bio='밤에 빛 작품을 보러 다녀요.' where user_id=$1`,[DANA]);
 assert.equal((await svc(db,`select public_id from public.member_profiles where user_id=$1`,[DANA]))[0].public_id,before,'the public id is the server\'s');
 for(const [name,re] of [['운영자 김씨',/profile_name_reserved/],['Admin Kim',/profile_name_reserved/],['kim@example.com',/profile_name_contact/],['010-1234-5678',/profile_name_contact/],['www.spam.example',/profile_name_contact/]])
  assert.match(await err(user(db,DANA,`update public.member_profiles set display_name=$2 where user_id=$1`,[DANA,name])),re,name);
 assert.match(await err(user(db,DANA,`update public.member_profiles set bio='연락 주세요 010-2222-3333' where user_id=$1`,[DANA])),/profile_bio_rules/);
 const pub=await anon(db,`select * from public.community_public_members where public_id=$1`,[before]);
 assert.equal(pub.length,1);
 assert.ok(!('user_id' in pub[0]),'no account id in the public profile');
 await user(db,DANA,`update public.member_profiles set show_profile=false where user_id=$1`,[DANA]);
 assert.equal((await anon(db,`select count(*)::int n from public.community_public_members where public_id=$1`,[before]))[0].n,0,'a hidden profile is not listed');
 await user(db,DANA,`update public.member_profiles set show_profile=true where user_id=$1`,[DANA]);
});
