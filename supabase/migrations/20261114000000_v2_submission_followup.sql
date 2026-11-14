-- v2.0 P0 follow-up (2026-11-14, docs/PLATFORM.md section 4): what the case-submission flow still lacked.
--  - needs_info: staff can send a submission back for more information instead of rejecting it. The submission
--    returns to draft with the request as its decision reason; the member edits it and submits it again, and it goes
--    through the checks and the queue as before. Only from pending or needs_review, and the request must be written.
--  - photos with a submission: a member attaches up to five photos (setting submission_photo_limit) to their own open
--    submission. They are ordinary member photos (private upload, the four statements, staff grade at publication),
--    tied to the submission instead of a project: a correction or event photo takes the existing project's id, a new
--    project's photos take the id staff give when they approve it, and they cannot be published before that. When
--    the submission is rejected or removed, its photos that wait for review are rejected with it.
-- Re-runnable after 20261112000000_v2_platform.sql and the 20261113 migrations.

-- ---- needs_info ------------------------------------------------------------------------------------------------------
alter table public.moderation_events drop constraint if exists moderation_events_decision_check;
alter table public.moderation_events add constraint moderation_events_decision_check
 check(decision in ('approved','needs_review','rejected','removed','restored','needs_info'));

create or replace function public.platform_moderate(p_type text,p_id bigint,p_decision text,p_reason text default null,p_project text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare tbl text:=public.platform_table_of(p_type); cur text; target text;
begin
 perform public.platform_require(array['admin','editor']);
 if tbl is null then raise exception 'invalid_target'; end if;
 if p_decision not in ('approved','needs_review','rejected','removed','needs_info') then raise exception 'invalid_decision'; end if;
 if p_decision='needs_info' and p_type<>'submission' then raise exception 'needs_info_submissions_only'; end if;
 if p_decision in ('rejected','removed','needs_info') and coalesce(btrim(p_reason),'')='' then raise exception 'reason_required'; end if;
 execute format('select status from public.%I where id=$1 for update',tbl) into cur using p_id;
 if cur is null then raise exception 'not_found'; end if;
 if cur='draft' then raise exception 'draft_not_submitted'; end if;
 if p_decision='needs_info' and cur not in ('pending','needs_review') then raise exception 'needs_info_only_while_in_review'; end if;
 if p_type='photo' and p_decision='approved' and not exists(select 1 from public.community_photos where id=p_id and public_path is not null) then
  raise exception 'photo_not_published_use_publish_photo';
 end if;
 if p_type='submission' and p_decision='approved' and p_project is null and exists(select 1 from public.community_submissions where id=p_id and kind in ('new_project','creator_work')) then
  raise exception 'project_id_required';
 end if;
 -- A request for more information hands the submission back to its author as a draft.
 target:=case when p_decision='needs_info' then 'draft' else p_decision end;
 execute format('update public.%I set status=$2,decision_reason=$3,decided_by=$4,decided_at=now(),published_at=case when $2=''approved'' then coalesce(published_at,now()) else published_at end where id=$1',tbl)
  using p_id,target,p_reason,(select auth.uid());
 if p_type='submission' and p_project is not null then update public.community_submissions set approved_project_id=p_project where id=p_id; end if;
 insert into public.moderation_events(target_type,target_id,source,decision,actor,reason) values(p_type,p_id,'staff',p_decision,(select auth.uid()),p_reason);
 perform public.platform_audit('moderate_'||p_decision,p_type,p_id::text,jsonb_build_object('reason',p_reason,'from',cur,'project',p_project));
 return jsonb_build_object('ok',true,'status',target);
end $$;
revoke all on function public.platform_moderate(text,bigint,text,text,text) from public,anon;
grant execute on function public.platform_moderate(text,bigint,text,text,text) to authenticated,service_role;

-- ---- photos with a submission ----------------------------------------------------------------------------------------
alter table public.community_photos add column if not exists submission_id bigint references public.community_submissions(id) on delete cascade;
alter table public.community_photos alter column project_id drop not null;
alter table public.community_photos drop constraint if exists community_photos_target;
alter table public.community_photos add constraint community_photos_target check(project_id is not null or submission_id is not null);
create index if not exists community_photos_submission on public.community_photos(submission_id) where submission_id is not null;
insert into public.platform_settings(key,value) values('submission_photo_limit','5'::jsonb) on conflict(key) do nothing;

-- Members: a submission photo belongs to their own open submission and takes its project id (null for a new project);
-- the submission and the project id never change afterwards. Runs after community_guard (trigger names sort).
create or replace function public.community_photos_submission_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare s record; n integer;
begin
 if current_user not in ('anon','authenticated') then return new; end if;
 if tg_op='UPDATE' then
  new.submission_id:=old.submission_id;
  if old.submission_id is not null then new.project_id:=old.project_id; end if;
  return new;
 end if;
 if new.submission_id is null then return new; end if;
 select user_id,status,project_id into s from public.community_submissions where id=new.submission_id;
 if not found or s.user_id is distinct from (select auth.uid()) then raise exception 'submission_not_found' using errcode='insufficient_privilege'; end if;
 if s.status not in ('draft','pending','needs_review') then raise exception 'submission_closed' using errcode='check_violation'; end if;
 select count(*) into n from public.community_photos where submission_id=new.submission_id;
 if n>=public.platform_setting_int('submission_photo_limit',5) then raise exception 'submission_photo_limit' using errcode='check_violation'; end if;
 new.project_id:=s.project_id;
 return new;
end $$;
drop trigger if exists community_photos_submission_guard on public.community_photos;
create trigger community_photos_submission_guard before insert or update on public.community_photos for each row execute function public.community_photos_submission_guard();

-- When staff decide a submission: approved with a project id gives its photos that id (they then wait in the photo
-- queue for a grade like any member photo); rejected or removed takes its waiting photos with it.
create or replace function public.community_submission_photos_follow() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status='approved' and new.approved_project_id is not null then
  update public.community_photos set project_id=new.approved_project_id where submission_id=new.id and project_id is null;
 elsif new.status in ('rejected','removed') and old.status is distinct from new.status then
  update public.community_photos set status='rejected',decision_reason='제출이 '||case when new.status='removed' then '게시 중단' else '반려' end||'되어 함께 반려됨'
   where submission_id=new.id and status in ('draft','pending','needs_review');
 end if;
 return null;
end $$;
drop trigger if exists community_submission_photos_follow on public.community_submissions;
create trigger community_submission_photos_follow after update of status,approved_project_id on public.community_submissions for each row execute function public.community_submission_photos_follow();
revoke all on function public.community_submission_photos_follow() from public,anon,authenticated;
