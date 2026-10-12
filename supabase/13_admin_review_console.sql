-- 빛의 건축 v0.10 — Admin Review Console security and RPC
-- Run after 10_global_discovery_engine.sql.

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'editor',
  can_promote boolean not null default true,
  can_run_discovery boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

revoke all on public.app_admins from anon;
revoke all on public.app_admins from authenticated;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_admins a
    where a.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to authenticated;

-- Lock discovery internals away from normal client roles.
alter table public.ingestion_jobs enable row level security;
alter table public.external_candidates enable row level security;
alter table public.provider_links enable row level security;
alter table public.duplicate_clusters enable row level security;
alter table public.candidate_scores enable row level security;

revoke all on public.ingestion_jobs from anon, authenticated;
revoke all on public.external_candidates from anon, authenticated;
revoke all on public.provider_links from anon, authenticated;
revoke all on public.duplicate_clusters from anon, authenticated;
revoke all on public.candidate_scores from anon, authenticated;
revoke all on public.global_candidates_admin from anon, authenticated;

-- Countries/cities may be public metadata.
alter table public.countries enable row level security;
alter table public.cities enable row level security;

drop policy if exists "public read active countries" on public.countries;
create policy "public read active countries"
on public.countries for select
to anon, authenticated
using (is_active = true);

drop policy if exists "public read active cities" on public.cities;
create policy "public read active cities"
on public.cities for select
to anon, authenticated
using (is_active = true);

grant select on public.countries to anon, authenticated;
grant select on public.cities to anon, authenticated;

-- v0.9 promotion function must not be callable directly by arbitrary signed-in users.
revoke all on function public.promote_candidate_to_place(uuid, text) from public, anon, authenticated;
revoke all on function public.assign_duplicate_cluster(uuid) from public, anon, authenticated;
grant execute on function public.promote_candidate_to_place(uuid, text) to service_role;
grant execute on function public.assign_duplicate_cluster(uuid) to service_role;

create or replace function public.admin_candidate_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_app_admin() then
    raise exception 'admin_required';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'ready', count(*) filter (where publishing_status = 'ready'),
    'draft', count(*) filter (where publishing_status = 'draft'),
    'published', count(*) filter (where publishing_status = 'published'),
    'rejected', count(*) filter (where publishing_status = 'rejected'),
    'high_relevance', count(*) filter (where relevance_score >= 70),
    'duplicates', count(*) filter (where duplicate_cluster_id is not null)
  )
  into result
  from public.external_candidates;

  return coalesce(result, '{}'::jsonb);
end;
$$;

create or replace function public.admin_list_candidates(
  p_city_code text default null,
  p_status text default null,
  p_min_score numeric default 0,
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  name_local text,
  city_code text,
  city_name_en text,
  country_iso2 text,
  candidate_type text,
  category_tags text[],
  lat numeric,
  lng numeric,
  address_text text,
  website_url text,
  discovery_stage public.candidate_stage,
  publishing_status text,
  relevance_score numeric,
  confidence_score numeric,
  auto_publish_eligible boolean,
  primary_provider public.discovery_provider,
  external_primary_id text,
  image_candidate_count integer,
  duplicate_cluster_id uuid,
  matched_place_id uuid,
  last_seen_at timestamptz,
  reviewed_at timestamptz,
  rejected_reason text,
  source_metadata jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'admin_required';
  end if;

  return query
  select
    ec.id,
    ec.name,
    ec.name_local,
    ci.city_code,
    ci.name_en,
    co.iso2,
    ec.candidate_type,
    ec.category_tags,
    ec.lat,
    ec.lng,
    ec.address_text,
    ec.website_url,
    ec.discovery_stage,
    ec.publishing_status,
    ec.relevance_score,
    ec.confidence_score,
    ec.auto_publish_eligible,
    ec.primary_provider,
    ec.external_primary_id,
    ec.image_candidate_count,
    ec.duplicate_cluster_id,
    ec.matched_place_id,
    ec.last_seen_at,
    ec.reviewed_at,
    ec.rejected_reason,
    ec.source_metadata
  from public.external_candidates ec
  left join public.cities ci on ci.id = ec.city_id
  left join public.countries co on co.id = ci.country_id
  where (p_city_code is null or ci.city_code = p_city_code)
    and (p_status is null or ec.publishing_status = p_status)
    and coalesce(ec.relevance_score,0) >= coalesce(p_min_score,0)
    and (
      p_search is null
      or ec.name ilike '%' || p_search || '%'
      or coalesce(ec.name_local,'') ilike '%' || p_search || '%'
      or coalesce(ec.candidate_type,'') ilike '%' || p_search || '%'
    )
  order by
    case ec.publishing_status when 'ready' then 0 when 'draft' then 1 else 2 end,
    ec.relevance_score desc nulls last,
    ec.confidence_score desc nulls last,
    ec.updated_at desc
  limit least(greatest(coalesce(p_limit,100),1),500)
  offset greatest(coalesce(p_offset,0),0);
end;
$$;

create or replace function public.admin_update_candidate(
  p_candidate_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.external_candidates;
begin
  if not public.is_app_admin() then
    raise exception 'admin_required';
  end if;

  if p_action not in ('ready','reviewed','reject','hide','restore') then
    raise exception 'invalid_action';
  end if;

  update public.external_candidates
  set
    discovery_stage = case
      when p_action = 'reviewed' then 'reviewed'::public.candidate_stage
      when p_action = 'reject' then 'rejected'::public.candidate_stage
      else discovery_stage
    end,
    publishing_status = case
      when p_action = 'ready' then 'ready'
      when p_action = 'reviewed' then 'ready'
      when p_action = 'reject' then 'rejected'
      when p_action = 'hide' then 'hidden'
      when p_action = 'restore' then 'draft'
      else publishing_status
    end,
    rejected_reason = case when p_action = 'reject' then p_reason else null end,
    reviewed_at = now(),
    reviewed_by = (select auth.uid())::text,
    updated_at = now()
  where id = p_candidate_id
  returning * into row_out;

  if row_out.id is null then
    raise exception 'candidate_not_found';
  end if;

  return jsonb_build_object(
    'id', row_out.id,
    'publishing_status', row_out.publishing_status,
    'discovery_stage', row_out.discovery_stage
  );
end;
$$;

create or replace function public.admin_promote_candidate(
  p_candidate_id uuid,
  p_place_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  adminrow public.app_admins;
  placeid uuid;
begin
  select * into adminrow
  from public.app_admins
  where user_id = (select auth.uid());

  if adminrow.user_id is null or not adminrow.can_promote then
    raise exception 'promotion_not_allowed';
  end if;

  placeid := public.promote_candidate_to_place(p_candidate_id, p_place_code);
  return placeid;
end;
$$;

create or replace function public.admin_list_ingestion_jobs(
  p_limit integer default 30
)
returns table (
  id uuid,
  provider public.discovery_provider,
  job_name text,
  scope_type text,
  status text,
  started_at timestamptz,
  finished_at timestamptz,
  fetched_count integer,
  inserted_count integer,
  updated_count integer,
  flagged_count integer,
  error_message text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'admin_required';
  end if;

  return query
  select
    j.id,j.provider,j.job_name,j.scope_type,j.status,j.started_at,j.finished_at,
    j.fetched_count,j.inserted_count,j.updated_count,j.flagged_count,j.error_message,j.created_at
  from public.ingestion_jobs j
  order by j.created_at desc
  limit least(greatest(coalesce(p_limit,30),1),100);
end;
$$;

revoke all on function public.admin_candidate_stats() from public, anon;
revoke all on function public.admin_list_candidates(text,text,numeric,text,integer,integer) from public, anon;
revoke all on function public.admin_update_candidate(uuid,text,text) from public, anon;
revoke all on function public.admin_promote_candidate(uuid,text) from public, anon;
revoke all on function public.admin_list_ingestion_jobs(integer) from public, anon;

grant execute on function public.admin_candidate_stats() to authenticated;
grant execute on function public.admin_list_candidates(text,text,numeric,text,integer,integer) to authenticated;
grant execute on function public.admin_update_candidate(uuid,text,text) to authenticated;
grant execute on function public.admin_promote_candidate(uuid,text) to authenticated;
grant execute on function public.admin_list_ingestion_jobs(integer) to authenticated;

-- After creating your Supabase Auth account, promote it once from SQL Editor:
-- insert into public.app_admins(user_id, role, can_promote, can_run_discovery)
-- select id, 'owner', true, true
-- from auth.users
-- where email = 'YOUR_EMAIL@example.com'
-- on conflict (user_id) do update set role='owner', can_promote=true, can_run_discovery=true;
