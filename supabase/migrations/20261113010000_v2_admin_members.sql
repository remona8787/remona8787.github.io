-- v2.0 P0 (docs/PLATFORM.md): what the operator console still lacked, and public member profiles.
--  - platform_member_list: members with their account state, role and activity (admin only, with an MFA session;
--    every call is written to the audit log because it shows e-mail addresses);
--  - platform_research_grants and platform_research_downloads: research access and its log (admin only);
--  - member profiles get a random public id (never the account id) and an opt-out, so a member's public posts can be
--    listed under their profile; profile text is checked like posts (no links, contacts or staff-like names).
-- Re-runnable after 20261112000000_v2_platform.sql and 20261113000000_v2_photo_grades.sql.

-- ---- public profile ---------------------------------------------------------------------------------------------------
alter table public.member_profiles add column if not exists public_id uuid not null default gen_random_uuid();
alter table public.member_profiles add column if not exists show_profile boolean not null default true;
create unique index if not exists member_profiles_public_id on public.member_profiles(public_id);

-- Members choose their name, bio and whether the profile is shown; the public id is the server's. Text rules: no
-- links, e-mail addresses or phone numbers in the name, nothing that reads as staff, and the post rules for the bio.
create or replace function public.member_profiles_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare r jsonb; flags jsonb;
begin
 if current_user not in ('anon','authenticated') then return new; end if;
 if tg_op='INSERT' then new.public_id:=gen_random_uuid(); else new.public_id:=old.public_id; new.created_at:=old.created_at; end if;
 new.updated_at:=now();
 if new.display_name is not null then
  new.display_name:=btrim(regexp_replace(new.display_name,'[[:space:]]+',' ','g'));
  if new.display_name ~* '(https?://|www\.|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|[0-9]{2,4}[-. ]?[0-9]{3,4}[-. ]?[0-9]{4})' then raise exception 'profile_name_contact' using errcode='check_violation'; end if;
  if lower(new.display_name) ~ '(운영자|관리자|운영진|빛의 ?건축|admin|moderator|official|staff)' then raise exception 'profile_name_reserved' using errcode='check_violation'; end if;
 end if;
 if new.bio is not null then
  r:=public.platform_text_rules(new.bio); flags:=coalesce(r->'flags','[]'::jsonb);
  if (r->>'links')::int>1 or flags ?| array['link:shortener','link:ip_host','spam:repetition','privacy:phone','privacy:email','privacy:resident_number'] then raise exception 'profile_bio_rules' using errcode='check_violation'; end if;
 end if;
 return new;
end $$;
drop trigger if exists member_profiles_guard on public.member_profiles;
create trigger member_profiles_guard before insert or update on public.member_profiles for each row execute function public.member_profiles_guard();

-- The public posts view carries the author's public id when the profile is shown (null otherwise); a profile view lists
-- shown profiles of members in good standing with their number of public posts. Neither carries an account id.
drop view if exists public.community_public_posts;
create view public.community_public_posts with (security_barrier) as
 select p.id,p.kind,p.project_id,p.author_name,p.title,p.body,p.visited_on,p.published_at,
  (select count(*) from public.community_likes l where l.post_id=p.id) as like_count,
  (select count(*) from public.community_comments c where c.post_id=p.id and c.status='approved') as comment_count,
  (select m.public_id from public.member_profiles m where m.user_id=p.user_id and m.show_profile) as author_public_id
 from public.community_posts p where p.status='approved';
drop view if exists public.community_public_members;
create view public.community_public_members with (security_barrier) as
 select m.public_id,coalesce(nullif(btrim(m.display_name),''),'이용자') as display_name,m.bio,m.created_at as joined_at,
  (select count(*) from public.community_posts p where p.user_id=m.user_id and p.status='approved') as post_count
 from public.member_profiles m where m.show_profile
  -- the same test as platform_account_restricted, inline: visitors read the view without executing that function
  and not exists(select 1 from public.member_status s where s.user_id=m.user_id and s.state<>'active' and (s.until is null or s.until>now()));
revoke all on public.community_public_posts,public.community_public_members from public,anon,authenticated;
grant select on public.community_public_posts,public.community_public_members to anon,authenticated,service_role;

-- ---- operator lists (admin + MFA) -------------------------------------------------------------------------------------
create or replace function public.platform_member_list(p_query text default null,p_limit integer default 50) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q text:=nullif(btrim(coalesce(p_query,'')),''); out jsonb;
begin
 perform public.platform_require(array['admin']);
 select coalesce(jsonb_agg(x order by x->>'created_at' desc),'[]'::jsonb) into out from (
  select jsonb_build_object('user_id',u.id,'email',u.email,'created_at',u.created_at,'email_confirmed',u.email_confirmed_at is not null,
   'last_sign_in_at',u.last_sign_in_at,'state',coalesce(s.state,'active'),'state_reason',s.reason,'state_until',s.until,'role',a.role,
   'display_name',m.display_name,'posts',(select count(*) from public.community_posts p where p.user_id=u.id),
   'photos',(select count(*) from public.community_photos f where f.user_id=u.id),
   'submissions',(select count(*) from public.community_submissions c where c.user_id=u.id),
   'researcher',(select r.status from public.researcher_applications r where r.user_id=u.id order by r.created_at desc limit 1)) as x
  from auth.users u left join public.member_status s on s.user_id=u.id left join public.app_admins a on a.user_id=u.id
   left join public.member_profiles m on m.user_id=u.id
  where q is null or u.email ilike '%'||q||'%' or m.display_name ilike '%'||q||'%'
  order by u.created_at desc limit least(greatest(coalesce(p_limit,50),1),200)) t;
 perform public.platform_audit('member_list_viewed','member',null,jsonb_build_object('query',q,'rows',jsonb_array_length(out)));
 return out;
end $$;

create or replace function public.platform_research_grants(p_limit integer default 100) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.platform_require(array['admin']);
 return (select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'email',u.email,'dataset_id',g.dataset_id,'application_id',g.application_id,
   'granted_at',g.granted_at,'expires_at',g.expires_at,'revoked_at',g.revoked_at,'revoke_reason',g.revoke_reason,
   'active',g.revoked_at is null and g.expires_at>now()) order by g.granted_at desc),'[]'::jsonb)
  from (select * from public.research_grants order by granted_at desc limit least(greatest(coalesce(p_limit,100),1),500)) g left join auth.users u on u.id=g.user_id);
end $$;

create or replace function public.platform_research_downloads(p_limit integer default 100) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.platform_require(array['admin']);
 return (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'email',u.email,'dataset_id',d.dataset_id,'version',d.version,'format',d.format,
   'ok',d.ok,'error',d.error,'requested_at',d.requested_at) order by d.requested_at desc),'[]'::jsonb)
  from (select * from public.research_downloads order by requested_at desc limit least(greatest(coalesce(p_limit,100),1),500)) d left join auth.users u on u.id=d.user_id);
end $$;

revoke all on function public.platform_member_list(text,integer),public.platform_research_grants(integer),public.platform_research_downloads(integer) from public,anon,authenticated;
grant execute on function public.platform_member_list(text,integer),public.platform_research_grants(integer),public.platform_research_downloads(integer) to authenticated,service_role;
