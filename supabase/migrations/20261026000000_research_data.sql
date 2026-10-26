-- v0.19 research data service and content reports (docs/RESEARCH_DATA.md).
-- Builds on 20261018000000_media_facade_archive.sql (app_admins, archive_role) and Supabase Auth (auth.users).
-- Public project data stays on the static site (GitHub Pages /data/). Only datasets the platform itself curates are
-- member downloads; their files live in the private storage bucket 'research-datasets' and leave it only as signed
-- URLs issued by the research-download Edge Function after it has checked the member.
-- Personal data: only an e-mail address (Supabase Auth) and two consents are required; every other profile field is
-- optional. A deleted account deletes its profile; its download log rows lose the user id (counts stay, no person).

-- ---- member profile (optional fields) --------------------------------------------------------------------------
create table if not exists public.research_profiles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text check(display_name is null or char_length(display_name) between 1 and 80),
 affiliation text check(affiliation is null or char_length(affiliation) between 1 and 160),
 user_type text check(user_type is null or user_type in ('researcher','student','professional','public','other')),
 research_field text check(research_field is null or char_length(research_field) between 1 and 120),
 purpose text check(purpose is null or char_length(purpose) between 1 and 500),
 country_iso2 text check(country_iso2 is null or country_iso2 ~ '^[A-Z]{2}$'),
 terms_version text not null,
 terms_accepted_at timestamptz not null default now(),
 privacy_version text not null,
 privacy_accepted_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.research_profiles enable row level security;
revoke all on public.research_profiles from public,anon,authenticated;
grant select,insert,update,delete on public.research_profiles to authenticated;
grant all on public.research_profiles to service_role;
drop policy if exists research_profiles_own on public.research_profiles;
create policy research_profiles_own on public.research_profiles for all to authenticated
 using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create or replace function public.research_profiles_touch() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at:=now(); new.user_id:=old.user_id; new.created_at:=old.created_at; return new; end $$;
drop trigger if exists research_profiles_touch on public.research_profiles;
create trigger research_profiles_touch before update on public.research_profiles for each row execute function public.research_profiles_touch();

-- ---- datasets and versions -------------------------------------------------------------------------------------
-- tier: 'public' (also listed here; files are on the static site), 'member' (signed download after sign-in),
-- 'institution' (by agreement only; never downloadable through the function).
create table if not exists public.research_datasets(
 id text primary key check(id ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
 title_ko text not null,
 title_en text,
 description_ko text,
 tier text not null check(tier in ('public','member','institution')),
 licence text not null,
 licence_url text,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.research_dataset_versions(
 dataset_id text not null references public.research_datasets(id) on delete cascade,
 version text not null check(version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
 data_as_of date not null,
 created_at timestamptz not null default now(),
 record_count integer not null check(record_count>=0),
 formats text[] not null check(formats <@ array['csv','json','geojson','xlsx']::text[] and cardinality(formats)>0),
 storage_prefix text not null check(storage_prefix ~ '^[a-z0-9][a-z0-9/._-]*$'),
 sha256 jsonb not null default '{}'::jsonb,
 changelog text,
 citation text not null,
 primary key(dataset_id,version)
);
alter table public.research_datasets enable row level security;
alter table public.research_dataset_versions enable row level security;
revoke all on public.research_datasets,public.research_dataset_versions from public,anon,authenticated;
grant select on public.research_datasets,public.research_dataset_versions to anon,authenticated;
grant all on public.research_datasets,public.research_dataset_versions to service_role;
-- The catalogue (titles, versions, licences, citations, checksums) is public; the files are not.
drop policy if exists research_datasets_read on public.research_datasets;
create policy research_datasets_read on public.research_datasets for select to anon,authenticated using (active);
drop policy if exists research_dataset_versions_read on public.research_dataset_versions;
create policy research_dataset_versions_read on public.research_dataset_versions for select to anon,authenticated
 using (exists(select 1 from public.research_datasets d where d.id=dataset_id and d.active));

-- ---- download log (written only by the Edge Function with the service role) ------------------------------------
create table if not exists public.research_downloads(
 id bigint generated always as identity primary key,
 user_id uuid references auth.users(id) on delete set null,
 dataset_id text not null,
 version text not null,
 format text not null,
 ok boolean not null,
 error text check(error is null or char_length(error)<=120),
 requested_at timestamptz not null default now()
);
create index if not exists research_downloads_user on public.research_downloads(user_id,requested_at desc);
create index if not exists research_downloads_dataset on public.research_downloads(dataset_id,requested_at desc);
alter table public.research_downloads enable row level security;
revoke all on public.research_downloads from public,anon,authenticated;
grant select on public.research_downloads to authenticated;
grant all on public.research_downloads to service_role;
drop policy if exists research_downloads_own on public.research_downloads;
create policy research_downloads_own on public.research_downloads for select to authenticated using (user_id=(select auth.uid()));

-- The function's eligibility check, callable only by the service role: member tier, active, version exists,
-- profile with both consents.
create or replace function public.research_download_check(p_user uuid,p_dataset text,p_version text,p_format text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare d public.research_datasets; v public.research_dataset_versions;
begin
 select * into d from public.research_datasets where id=p_dataset;
 if d.id is null or not d.active then return jsonb_build_object('ok',false,'error','dataset_not_found'); end if;
 if d.tier<>'member' then return jsonb_build_object('ok',false,'error',case when d.tier='public' then 'public_dataset_use_site' else 'institution_agreement_required' end); end if;
 select * into v from public.research_dataset_versions where dataset_id=p_dataset and version=p_version;
 if v.dataset_id is null then return jsonb_build_object('ok',false,'error','version_not_found'); end if;
 if not (p_format=any(v.formats)) then return jsonb_build_object('ok',false,'error','format_not_available'); end if;
 if not exists(select 1 from public.research_profiles p where p.user_id=p_user) then return jsonb_build_object('ok',false,'error','profile_and_consent_required'); end if;
 return jsonb_build_object('ok',true,'path',v.storage_prefix||'/'||p_dataset||'-'||p_version||'.'||p_format,
  'licence',d.licence,'licence_url',d.licence_url,'citation',v.citation,'sha256',v.sha256->>p_format,'data_as_of',v.data_as_of,'record_count',v.record_count);
end $$;
revoke all on function public.research_download_check(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.research_download_check(uuid,text,text,text) to service_role;

-- ---- content reports (image or project errors from visitors) ---------------------------------------------------
-- Anyone may file a report; nobody but admins and editors can read them. A report never changes data by itself.
create table if not exists public.content_reports(
 id bigint generated always as identity primary key,
 created_at timestamptz not null default now(),
 project_id text not null check(project_id ~ '^[A-Za-z0-9_-]{2,40}$'),
 image_id text check(image_id is null or char_length(image_id)<=200),
 reason text not null check(reason in ('image_unrelated','person_image','low_quality','rights_or_credit','project_info','other')),
 message text check(message is null or char_length(message)<=2000),
 contact_email text check(contact_email is null or (char_length(contact_email)<=254 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
 reporter uuid references auth.users(id) on delete set null,
 status text not null default 'open' check(status in ('open','accepted','rejected','duplicate')),
 handled_by uuid references auth.users(id) on delete set null,
 handled_at timestamptz,
 note text check(note is null or char_length(note)<=1000)
);
create index if not exists content_reports_open on public.content_reports(status,created_at desc);
-- A reporter's e-mail address serves only the reply: it is erased when the report is handled (privacy policy §2).
create or replace function public.content_reports_handled() returns trigger language plpgsql set search_path='' as $$
begin if new.status<>'open' then new.contact_email:=null; end if; return new; end $$;
drop trigger if exists content_reports_handled on public.content_reports;
create trigger content_reports_handled before update of status on public.content_reports for each row execute function public.content_reports_handled();
alter table public.content_reports enable row level security;
revoke all on public.content_reports from public,anon,authenticated;
grant insert(project_id,image_id,reason,message,contact_email,reporter) on public.content_reports to anon,authenticated;
grant select,update(status,handled_by,handled_at,note) on public.content_reports to authenticated;
grant all on public.content_reports to service_role;
drop policy if exists content_reports_file on public.content_reports;
create policy content_reports_file on public.content_reports for insert to anon,authenticated
 with check (status='open' and handled_by is null and handled_at is null and note is null
  and (reporter is null or reporter=(select auth.uid())));
drop policy if exists content_reports_review on public.content_reports;
create policy content_reports_review on public.content_reports for select to authenticated using (public.archive_role() in ('admin','editor'));
drop policy if exists content_reports_handle on public.content_reports;
create policy content_reports_handle on public.content_reports for update to authenticated
 using (public.archive_role() in ('admin','editor')) with check (public.archive_role() in ('admin','editor'));

-- ---- admin statistics: aggregates only, no person-level rows ---------------------------------------------------
create or replace function public.research_admin_stats(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare since timestamptz:=now()-make_interval(days=>greatest(1,least(coalesce(p_days,30),366)));
begin
 perform public.archive_require(array['admin']);
 return jsonb_build_object(
  'days',greatest(1,least(coalesce(p_days,30),366)),
  'members',(select count(*) from public.research_profiles),
  'new_members',(select count(*) from public.research_profiles where created_at>=since),
  'active_downloaders',(select count(distinct user_id) from public.research_downloads where requested_at>=since and ok and user_id is not null),
  'downloads',(select count(*) from public.research_downloads where requested_at>=since and ok),
  'download_errors',(select count(*) from public.research_downloads where requested_at>=since and not ok),
  'by_dataset',coalesce((select jsonb_object_agg(dataset_id,n) from (select dataset_id,count(*) n from public.research_downloads where requested_at>=since and ok group by dataset_id) x),'{}'::jsonb),
  'user_types',coalesce((select jsonb_object_agg(coalesce(user_type,'not_given'),n) from (select user_type,count(*) n from public.research_profiles group by user_type) x),'{}'::jsonb),
  'open_reports',(select count(*) from public.content_reports where status='open'));
end $$;
revoke all on function public.research_admin_stats(integer) from public,anon,authenticated;
grant execute on function public.research_admin_stats(integer) to authenticated,service_role;

-- ---- private bucket for member datasets ------------------------------------------------------------------------
insert into storage.buckets(id,name,public) values('research-datasets','research-datasets',false) on conflict(id) do update set public=false;
-- No storage.objects policy grants anon or authenticated anything on this bucket: only the service role (the Edge
-- Function) reads it, and members receive short-lived signed URLs.
