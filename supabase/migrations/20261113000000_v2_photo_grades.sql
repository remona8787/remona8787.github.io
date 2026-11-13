-- v2.0 image brief (docs/IMAGE_GRADES.md, docs/PLATFORM.md "Photos"): member photos get the photographer's credit
-- line, the grade a staff member gives when publishing (A premium, B general, C context), and the published file's
-- SHA-256, so the same file is never published twice. Members may set the credit line only; the grade and the hash are
-- written by platform_photo_published (staff, through the publish-photo function).

alter table public.community_photos add column if not exists credit_name text
 check(credit_name is null or (char_length(credit_name) between 1 and 80 and credit_name !~* '(https?://|www\.|@)'));
alter table public.community_photos add column if not exists grade text check(grade is null or grade in ('A','B','C'));
alter table public.community_photos add column if not exists sha256 text check(sha256 is null or sha256 ~ '^[0-9a-f]{64}$');
create unique index if not exists community_photos_sha256_once on public.community_photos(sha256) where sha256 is not null and status='approved';

-- Members never write the grade or the hash (the same rule as community_guard: privileged = not anon/authenticated).
create or replace function public.community_photos_staff_fields() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if current_user not in ('anon','authenticated') then return new; end if;
 if tg_op='INSERT' then new.grade:=null; new.sha256:=null;
 else new.grade:=old.grade; new.sha256:=old.sha256; end if;
 return new;
end $$;
drop trigger if exists community_photos_staff_fields on public.community_photos;
create trigger community_photos_staff_fields before insert or update on public.community_photos for each row execute function public.community_photos_staff_fields();

-- Publication now records the staff grade and the file hash; a file already published (same SHA-256) is refused.
drop function if exists public.platform_photo_published(bigint,text,uuid);
create or replace function public.platform_photo_published(p_id bigint,p_public_path text,p_actor uuid,p_grade text,p_sha256 text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.app_admins a where a.user_id=p_actor and a.role in ('admin','editor')) then raise exception 'staff role required'; end if;
 if p_grade is null or p_grade not in ('A','B','C') then raise exception 'grade_required'; end if;
 if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'hash_required'; end if;
 if exists(select 1 from public.community_photos where sha256=p_sha256 and status='approved' and id<>p_id) then raise exception 'duplicate_photo'; end if;
 update public.community_photos set public_path=p_public_path,status='approved',grade=p_grade,sha256=p_sha256,published_at=coalesce(published_at,now()),decided_by=p_actor,decided_at=now() where id=p_id and status in ('pending','needs_review');
 if not found then raise exception 'not_reviewable'; end if;
 insert into public.moderation_events(target_type,target_id,source,decision,actor) values('photo',p_id,'staff','approved',p_actor);
 insert into public.platform_audit_log(actor,action,target_type,target_id,detail) values(p_actor,'photo_published','photo',p_id::text,jsonb_build_object('path',p_public_path,'grade',p_grade));
 return jsonb_build_object('ok',true,'grade',p_grade);
end $$;
revoke all on function public.platform_photo_published(bigint,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.platform_photo_published(bigint,text,uuid,text,text) to service_role;

-- The public view adds the credit line (the member's own, else their display name) and the grade; same rows and the
-- same grants as before, still no user id. Grade C photos are shown as the visitor's view of the place, never as the
-- work's photo.
drop view if exists public.community_public_photos;
create view public.community_public_photos with (security_barrier) as
 select f.id,f.project_id,f.author_name,f.caption,f.taken_on,f.public_path,f.width,f.height,f.licence,f.published_at,
  coalesce(f.credit_name,f.author_name) as credit,f.grade
 from public.community_photos f where f.status='approved' and f.public_path is not null;
revoke all on public.community_public_photos from public,anon,authenticated;
grant select on public.community_public_photos to anon,authenticated,service_role;
