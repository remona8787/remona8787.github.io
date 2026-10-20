-- Completes the verified partial deployment in refwrdfxbhcsguweicle.
-- Apply once, atomically. No user identities or keys included.
begin;

-- SOURCE: 04_flutterflow_rpc.sql
-- 빛의 건축 v0.1
-- FlutterFlow에서 클라이언트 Action을 단순화하기 위한 helper RPC.
-- 01_schema.sql, 02_seed_seoul50.sql 이후 실행.

-- 1) public place search
create or replace function public.search_places(p_query text)
returns setof public.places
language sql
stable
security invoker
set search_path = public
as $$
  select p.*
  from public.places p
  where p.is_published = true
    and (
      coalesce(trim(p_query),'') = ''
      or p.name_kr ilike '%' || trim(p_query) || '%'
      or p.name_en ilike '%' || trim(p_query) || '%'
      or p.district ilike '%' || trim(p_query) || '%'
      or p.primary_category ilike '%' || trim(p_query) || '%'
      or p.short_description ilike '%' || trim(p_query) || '%'
    )
  order by
    case p.mvp_priority when 'A' then 1 when 'B' then 2 else 3 end,
    p.name_kr;
$$;

grant execute on function public.search_places(text) to anon, authenticated;


-- 2) save toggle
create or replace function public.toggle_saved_place(p_place_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_exists boolean;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select exists(
    select 1
    from public.saved_places
    where user_id = v_uid and place_id = p_place_id
  ) into v_exists;

  if v_exists then
    delete from public.saved_places
    where user_id = v_uid and place_id = p_place_id;
    return false;
  else
    insert into public.saved_places(user_id, place_id)
    values (v_uid, p_place_id)
    on conflict (user_id, place_id) do nothing;
    return true;
  end if;
end;
$$;

grant execute on function public.toggle_saved_place(uuid) to authenticated;


-- 3) mark visited / increment visit count
create or replace function public.mark_visited_place(
  p_place_id uuid,
  p_rating smallint default null,
  p_comment text default null
)
returns public.visited_places
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.visited_places;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    raise exception 'rating must be between 1 and 5';
  end if;

  insert into public.visited_places(
    user_id, place_id, first_visited_at, last_visited_at,
    visit_count, rating, comment
  )
  values (
    v_uid, p_place_id, now(), now(), 1, p_rating, p_comment
  )
  on conflict (user_id, place_id)
  do update set
    last_visited_at = now(),
    visit_count = public.visited_places.visit_count + 1,
    rating = coalesce(excluded.rating, public.visited_places.rating),
    comment = coalesce(excluded.comment, public.visited_places.comment)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.mark_visited_place(uuid, smallint, text) to authenticated;


-- 4) My Light Map KPI
create or replace function public.get_my_light_stats()
returns table(
  saved_count bigint,
  visited_place_count bigint,
  district_count bigint,
  total_visit_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with
  s as (
    select count(*)::bigint c
    from public.saved_places
    where user_id = auth.uid()
  ),
  v as (
    select
      count(*)::bigint place_count,
      coalesce(sum(visit_count),0)::bigint total_count
    from public.visited_places
    where user_id = auth.uid()
  ),
  d as (
    select count(distinct p.district)::bigint c
    from public.visited_places vp
    join public.places p on p.id = vp.place_id
    where vp.user_id = auth.uid()
  )
  select s.c, v.place_count, d.c, v.total_count
  from s, v, d;
$$;

grant execute on function public.get_my_light_stats() to authenticated;


-- 5) ordered curation content
create or replace function public.get_curation_places(p_curation_id uuid)
returns table(
  sort_order integer,
  editor_comment text,
  place_id uuid,
  place_code text,
  name_kr text,
  name_en text,
  primary_category text,
  district text,
  short_description text,
  free boolean,
  typical_hours text,
  latitude double precision,
  longitude double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    cp.sort_order, cp.editor_comment,
    p.id, p.place_code, p.name_kr, p.name_en,
    p.primary_category, p.district, p.short_description,
    p.free, p.typical_hours, p.latitude, p.longitude
  from public.curation_places cp
  join public.places p on p.id = cp.place_id
  where cp.curation_id = p_curation_id
    and p.is_published = true
  order by cp.sort_order, p.name_kr;
$$;

grant execute on function public.get_curation_places(uuid) to anon, authenticated;

-- SOURCE: 07_audited_corrections.sql
-- 빛의 건축 v0.2 — definite audited corrections

-- Galleria WEST official address correction (WEST=343; EAST=407).
update public.places
set address = '서울특별시 강남구 압구정로 343',
    verified_at = date '2026-09-22',
    updated_at = now()
where place_code = 'SEOUL009';

-- Ground Seesaw Seochon has a current provider conflict; hold from launch pending operator confirmation.
update public.places
set is_published = false,
    verified_at = date '2026-09-22',
    updated_at = now()
where place_code = 'SEOUL042';

-- Lotte Town Light remains upcoming.
update public.places
set status = 'upcoming',
    verified_at = date '2026-09-22',
    updated_at = now()
where place_code = 'SEOUL019';

-- DDP Autumn main event ended; keep place as seasonal.
update public.places
set status = 'seasonal',
    verified_at = date '2026-09-22',
    updated_at = now()
where place_code = 'SEOUL006';

-- SOURCE: 12_seed_countries_cities.sql
-- 빛의 건축 v0.10
-- Initial country/city bootstrap: Seoul / Tokyo / New York City
-- Bounding boxes are operational discovery bounds, not legal administrative boundary geometry.

insert into public.countries (
  iso2, iso3, name_en, name_local, continent,
  wikidata_id, centroid_lat, centroid_lng, default_language,
  is_active, metadata
) values
  ('KR','KOR','South Korea','대한민국','Asia','Q884',36.5000000,127.8000000,'ko',true,
   '{"bootstrap":"v0.10","scope":"global-discovery"}'::jsonb),
  ('JP','JPN','Japan','日本','Asia','Q17',36.2048240,138.2529240,'ja',true,
   '{"bootstrap":"v0.10","scope":"global-discovery"}'::jsonb),
  ('US','USA','United States','United States','North America','Q30',39.8283000,-98.5795000,'en',true,
   '{"bootstrap":"v0.10","scope":"global-discovery"}'::jsonb)
on conflict (iso2) do update set
  iso3 = excluded.iso3,
  name_en = excluded.name_en,
  name_local = excluded.name_local,
  continent = excluded.continent,
  wikidata_id = excluded.wikidata_id,
  centroid_lat = excluded.centroid_lat,
  centroid_lng = excluded.centroid_lng,
  default_language = excluded.default_language,
  is_active = excluded.is_active,
  metadata = public.countries.metadata || excluded.metadata,
  updated_at = now();

insert into public.cities (
  country_id, city_code, name_en, name_local, admin_level,
  wikidata_id, timezone,
  centroid_lat, centroid_lng,
  bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng,
  discovery_priority, is_active, metadata
)
select
  co.id, v.city_code, v.name_en, v.name_local, v.admin_level,
  v.wikidata_id, v.timezone,
  v.centroid_lat, v.centroid_lng,
  v.bbox_min_lat, v.bbox_min_lng, v.bbox_max_lat, v.bbox_max_lng,
  v.discovery_priority, true,
  jsonb_build_object(
    'bootstrap','v0.10',
    'bbox_purpose','operational discovery envelope',
    'notes',v.notes
  )
from public.countries co
join (
  values
    (
      'KR','SEOUL','Seoul','서울','special city','Q8684','Asia/Seoul',
      37.5665000::numeric,126.9780000::numeric,
      37.4132940::numeric,126.7340860::numeric,37.7151330::numeric,127.2693110::numeric,
      1,
      'Initial curated market; existing Seoul seed can be matched against discoveries.'
    ),
    (
      'JP','TOKYO','Tokyo','東京','metropolis / core urban discovery area','Q1490','Asia/Tokyo',
      35.6762000::numeric,139.6503000::numeric,
      35.5289840::numeric,139.5621030::numeric,35.8984030::numeric,139.9183910::numeric,
      2,
      'Operational bbox focuses on the central Tokyo urban area for initial validation.'
    ),
    (
      'US','NEWYORK','New York City','New York City','city','Q60','America/New_York',
      40.7128000::numeric,-74.0060000::numeric,
      40.4773990::numeric,-74.2590900::numeric,40.9175770::numeric,-73.7002720::numeric,
      3,
      'Operational bbox covers the five-borough New York City area.'
    )
) as v(
  iso2,city_code,name_en,name_local,admin_level,wikidata_id,timezone,
  centroid_lat,centroid_lng,
  bbox_min_lat,bbox_min_lng,bbox_max_lat,bbox_max_lng,
  discovery_priority,notes
)
  on co.iso2 = v.iso2
on conflict (city_code) do update set
  country_id = excluded.country_id,
  name_en = excluded.name_en,
  name_local = excluded.name_local,
  admin_level = excluded.admin_level,
  wikidata_id = excluded.wikidata_id,
  timezone = excluded.timezone,
  centroid_lat = excluded.centroid_lat,
  centroid_lng = excluded.centroid_lng,
  bbox_min_lat = excluded.bbox_min_lat,
  bbox_min_lng = excluded.bbox_min_lng,
  bbox_max_lat = excluded.bbox_max_lat,
  bbox_max_lng = excluded.bbox_max_lng,
  discovery_priority = excluded.discovery_priority,
  is_active = excluded.is_active,
  metadata = public.cities.metadata || excluded.metadata,
  updated_at = now();

-- Sanity
select
  c.city_code,
  c.name_en,
  co.iso2,
  c.timezone,
  c.discovery_priority,
  c.bbox_min_lat,
  c.bbox_min_lng,
  c.bbox_max_lat,
  c.bbox_max_lng
from public.cities c
join public.countries co on co.id = c.country_id
where c.city_code in ('SEOUL','TOKYO','NEWYORK')
order by c.discovery_priority;

-- SOURCE: 15_discovery_hardening.sql
-- 빛의 건축 v0.10 — Discovery hardening
-- Re-apply corrected functions if v0.9 was already installed.

create or replace function public.assign_duplicate_cluster(
  p_candidate_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_key text;
  v_cluster_id uuid;
begin
  select * into c
  from public.external_candidates
  where id = p_candidate_id;

  if not found then
    raise exception 'Candidate not found: %', p_candidate_id;
  end if;

  v_key := public.normalize_candidate_key(c.name, c.lat, c.lng);

  insert into public.duplicate_clusters (city_id, normalized_key, member_count)
  values (c.city_id, v_key, 0)
  on conflict (city_id, normalized_key) do update
    set updated_at = now()
  returning id into v_cluster_id;

  if c.duplicate_cluster_id is distinct from v_cluster_id then
    update public.external_candidates
    set duplicate_cluster_id = v_cluster_id,
        updated_at = now()
    where id = p_candidate_id;
  end if;

  update public.duplicate_clusters dc
  set member_count = (
    select count(*) from public.external_candidates ec
    where ec.duplicate_cluster_id = dc.id
  ),
  updated_at = now()
  where dc.id = v_cluster_id;

  return v_cluster_id;
end;
$$;

create or replace view public.global_candidates_admin as
select
  ec.id,
  ec.name,
  ec.name_local,
  c.city_code,
  c.name_en as city_name_en,
  co.iso2 as country_iso2,
  co.name_en as country_name_en,
  ec.candidate_type,
  ec.category_tags,
  ec.lat,
  ec.lng,
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
  ec.rejected_reason
from public.external_candidates ec
left join public.cities c on c.id = ec.city_id
left join public.countries co on co.id = c.country_id;

revoke all on public.global_candidates_admin from anon, authenticated;

create or replace function public.promote_candidate_to_place(
  p_candidate_id uuid,
  p_place_code text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_place_id uuid;
  v_place_code text;
  v_category text;
  v_city_name text;
begin
  select ec.*, ci.name_en as city_name
  into c
  from public.external_candidates ec
  left join public.cities ci on ci.id = ec.city_id
  where ec.id = p_candidate_id;

  if not found then
    raise exception 'Candidate not found';
  end if;

  if c.matched_place_id is not null then
    return c.matched_place_id;
  end if;

  v_place_code := coalesce(
    nullif(trim(p_place_code),''),
    'AUTO-' || upper(substr(replace(c.id::text,'-',''),1,10))
  );

  v_category := case
    when c.candidate_type in ('Media Facade','Media Art','Immersive','Light Art','Architecture')
      then c.candidate_type
    else 'Architecture'
  end;

  v_city_name := coalesce(c.city_name, 'Global');

  insert into public.places (
    place_code,
    name_kr,
    name_en,
    primary_category,
    secondary_categories,
    short_description,
    description,
    expert_description,
    why_it_matters,
    address,
    district,
    latitude,
    longitude,
    status,
    operational_mode,
    website,
    source_url,
    source_publisher,
    verification_status,
    mvp_priority,
    geocode_status,
    is_published
  ) values (
    v_place_code,
    coalesce(nullif(c.name_local,''), c.name),
    c.name,
    v_category,
    coalesce(c.category_tags, array[]::text[]),
    coalesce(c.short_description, c.name),
    coalesce(c.short_description, c.name),
    'Global Discovery Engine에서 자동 수집된 후보입니다. 편집 검토 후 전문가 해설을 보강하세요.',
    '자동 탐색 후보를 canonical place로 승격했습니다. 공개 전 편집 검토가 필요합니다.',
    c.address_text,
    v_city_name,
    c.lat,
    c.lng,
    'verify_current_program',
    'global-discovery',
    c.website_url,
    c.website_url,
    c.primary_provider::text,
    'low',
    'C',
    case when c.lat is not null and c.lng is not null then 'verified' else 'needs_geocoding' end,
    false
  )
  returning id into v_place_id;

  update public.external_candidates
  set matched_place_id = v_place_id,
      discovery_stage = 'published',
      publishing_status = 'published',
      reviewed_at = now(),
      reviewed_by = current_user,
      updated_at = now()
  where id = p_candidate_id;

  return v_place_id;
end;
$$;

grant execute on function public.promote_candidate_to_place(uuid, text) to authenticated;

-- Admin SQL (13) subsequently revokes direct promotion access from normal authenticated users.

-- SOURCE: 13_admin_review_console.sql
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

-- SOURCE: 17_user_sync_and_operations.sql
-- v0.12 additive migration. Apply after 01..16 (cron templates are optional).
-- Existing relational user tables are preserved. Workspace JSON preserves v0.11 IDs.

create table if not exists public.user_workspaces (
 user_id uuid primary key references auth.users(id) on delete cascade,
 document jsonb not null default '{"schema":1,"saved":[],"visits":[],"routes":[],"candidates":[],"legacyVisits":{},"preferences":{}}'::jsonb,
 revision bigint not null default 1 check(revision>0),
 updated_at timestamptz not null default now(),
 constraint workspace_size check (octet_length(document::text)<=5242880),
 constraint workspace_shape check (document->>'schema'='1' and jsonb_typeof(document->'saved')='array' and jsonb_typeof(document->'visits')='array' and jsonb_typeof(document->'routes')='array' and jsonb_typeof(document->'candidates')='array')
);
alter table public.user_workspaces enable row level security;
revoke all on public.user_workspaces from anon,authenticated;
grant select on public.user_workspaces to authenticated;
drop policy if exists workspace_owner_read on public.user_workspaces;
create policy workspace_owner_read on public.user_workspaces for select to authenticated using(user_id=(select auth.uid()));
create or replace function public.save_workspace(p_document jsonb,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_row public.user_workspaces; v_key text;
begin
 if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
 if p_expected_revision<0 or p_expected_revision is null then raise exception 'invalid_revision'; end if;
 if p_document is null then raise exception 'invalid_document'; end if;
 if octet_length(p_document::text)>5242880 or p_document->>'schema' is distinct from '1' then raise exception 'invalid_document'; end if;
 foreach v_key in array array['saved','visits','routes','candidates'] loop
  if jsonb_typeof(p_document->v_key) is distinct from 'array' then raise exception 'invalid_array'; end if;
  if jsonb_array_length(p_document->v_key)>5000 then raise exception 'array_too_large'; end if;
 end loop;
 if p_expected_revision=0 then
  insert into public.user_workspaces(user_id,document) values(v_user,p_document) on conflict(user_id) do nothing returning * into v_row;
 else
  update public.user_workspaces set document=p_document,revision=revision+1,updated_at=now()
  where user_id=v_user and revision=p_expected_revision returning * into v_row;
 end if;
 if v_row.user_id is null then return jsonb_build_object('ok',false,'conflict',true); end if;
 return jsonb_build_object('ok',true,'revision',v_row.revision,'updated_at',v_row.updated_at);
end;$$;
revoke all on function public.save_workspace(jsonb,bigint) from public,anon;
grant execute on function public.save_workspace(jsonb,bigint) to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='user_workspaces') then alter publication supabase_realtime add table public.user_workspaces; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='places') then alter publication supabase_realtime add table public.places; end if;
end $$;
alter table public.places add column if not exists city_id uuid references public.cities(id) on delete set null,
 add column if not exists coordinate_source_url text,
 add column if not exists coordinate_review_status text not null default 'unverified',
 add column if not exists coordinate_checked_at timestamptz;
create index if not exists places_city_public on public.places(city_id,is_published);
create table if not exists public.place_submissions(
 id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete cascade,
 title text not null check(length(title) between 1 and 200),source_url text not null check(source_url ~ '^https://'),
 note text not null default '' check(length(note)<=2000),status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now()
);
alter table public.place_submissions enable row level security;
grant select,insert on public.place_submissions to authenticated;
drop policy if exists submissions_owner_read on public.place_submissions;
create policy submissions_owner_read on public.place_submissions for select to authenticated using(user_id=auth.uid());
drop policy if exists submissions_owner_insert on public.place_submissions;
create policy submissions_owner_insert on public.place_submissions for insert to authenticated with check(user_id=auth.uid() and status='pending');
create table if not exists public.admin_change_log(
 id bigint generated always as identity primary key,actor uuid references auth.users(id) on delete set null,
 operation text not null,entity_id text,details jsonb not null default '{}',created_at timestamptz not null default now()
);
alter table public.admin_change_log enable row level security;
revoke all on public.admin_change_log from anon,authenticated;
create or replace function public.admin_set_place(p_id uuid,p_patch jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_app_admin() then raise exception 'admin_required' using errcode='42501'; end if;
 if exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('name_kr','name_en','short_description','expert_description','is_published','verified_at','coordinate_review_status')) then raise exception 'unsupported_field'; end if;
 update public.places set name_kr=coalesce(p_patch->>'name_kr',name_kr),name_en=coalesce(p_patch->>'name_en',name_en),short_description=coalesce(p_patch->>'short_description',short_description),expert_description=coalesce(p_patch->>'expert_description',expert_description),is_published=coalesce((p_patch->>'is_published')::boolean,is_published),verified_at=coalesce((p_patch->>'verified_at')::date,verified_at),coordinate_review_status=coalesce(p_patch->>'coordinate_review_status',coordinate_review_status) where id=p_id;
 if not found then raise exception 'place_not_found'; end if;
 insert into public.admin_change_log(actor,operation,entity_id,details) values(auth.uid(),'place_edit',p_id::text,p_patch);
end;$$;
revoke all on function public.admin_set_place(uuid,jsonb) from public,anon;
grant execute on function public.admin_set_place(uuid,jsonb) to authenticated;
create or replace function public.admin_operations() returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not public.is_app_admin() then raise exception 'admin_required' using errcode='42501'; end if;
 return jsonb_build_object('submissions',(select coalesce(jsonb_agg(t),'[]') from(select * from public.place_submissions order by created_at desc limit 100)t),'changes',(select coalesce(jsonb_agg(t),'[]') from(select * from public.admin_change_log order by created_at desc limit 100)t),'places',(select coalesce(jsonb_agg(t),'[]') from(select id,place_code,name_kr,is_published,verified_at,coordinate_review_status from public.places order by updated_at desc limit 200)t));
end;$$;
revoke all on function public.admin_operations() from public,anon;
grant execute on function public.admin_operations() to authenticated;


-- SOURCE: 18_discovery_rotation.sql
-- Apply before deploying v0.12 discover-city-candidates.
alter table public.cities add column if not exists last_discovery_at timestamptz;
create index if not exists cities_discovery_rotation on public.cities(last_discovery_at nulls first,discovery_priority) where is_active=true;

-- SOURCE: migrations/20261010160920_archive_media_and_editorial.sql
-- v0.13 extension; apply only AFTER legacy SQL 01..18. Not executed remotely.

alter table public.places
 add column if not exists architect text,
 add column if not exists artist text,
 add column if not exists producer text,
 add column if not exists project_year integer,
 add column if not exists content_type text check(content_type in ('permanent','temporary')),
 add column if not exists spatial_context text,
 add column if not exists technology text,
 add column if not exists operation_verified boolean not null default false,
 add column if not exists operation_verified_until date,
 add column if not exists operation_source_url text;
create table if not exists public.archive_articles(
 id uuid primary key default gen_random_uuid(),title text not null check(length(title) between 1 and 200),
 summary text not null default '' check(length(summary)<=1000),body text not null check(length(body)<=100000),
 author text,source_url text,status text not null default 'draft' check(status in ('draft','published')),
 published_at timestamptz,updated_at timestamptz not null default now()
);
alter table public.archive_articles enable row level security;
revoke all on public.archive_articles from anon,authenticated;
grant select on public.archive_articles to anon,authenticated;
grant insert,update,delete on public.archive_articles to authenticated;
grant all on public.archive_articles to service_role;
drop policy if exists articles_public_read on public.archive_articles;
create policy articles_public_read on public.archive_articles for select to anon,authenticated using(status='published');
drop policy if exists articles_admin on public.archive_articles;
create policy articles_admin on public.archive_articles for all to authenticated using((select public.is_app_admin())) with check((select public.is_app_admin()));
create index if not exists articles_published_date on public.archive_articles(published_at desc) where status='published';
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('visit-photos','visit-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists private_visit_photo_read on storage.objects;
create policy private_visit_photo_read on storage.objects for select to authenticated using(bucket_id='visit-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists private_visit_photo_insert on storage.objects;
create policy private_visit_photo_insert on storage.objects for insert to authenticated with check(bucket_id='visit-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists private_visit_photo_delete on storage.objects;
create policy private_visit_photo_delete on storage.objects for delete to authenticated using(bucket_id='visit-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
create table if not exists public.visit_photos(
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 visit_id text not null check(length(visit_id) between 1 and 100),storage_path text not null unique,
 created_at timestamptz not null default now(),check(split_part(storage_path,'/',1)=user_id::text)
);
alter table public.visit_photos enable row level security;
revoke all on public.visit_photos from anon,authenticated;
grant select,insert,delete on public.visit_photos to authenticated;
grant all on public.visit_photos to service_role;
drop policy if exists visit_photo_owner_read on public.visit_photos;
create policy visit_photo_owner_read on public.visit_photos for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists visit_photo_owner_insert on public.visit_photos;
create policy visit_photo_owner_insert on public.visit_photos for insert to authenticated with check(user_id=(select auth.uid()));
drop policy if exists visit_photo_owner_delete on public.visit_photos;
create policy visit_photo_owner_delete on public.visit_photos for delete to authenticated using(user_id=(select auth.uid()));
create index if not exists visit_photos_owner_visit on public.visit_photos(user_id,visit_id);


alter function public.touch_updated_at() set search_path='';
revoke execute on function public.handle_new_auth_user() from public,anon,authenticated;
update public.places set city_id=(select id from public.cities where city_code='SEOUL') where place_code like 'SEOUL%';
revoke all on function public.promote_candidate_to_place(uuid,text),public.assign_duplicate_cluster(uuid) from public,anon,authenticated;
grant execute on function public.promote_candidate_to_place(uuid,text),public.assign_duplicate_cluster(uuid) to service_role;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
-- A public media asset must also belong to a published parent.
drop policy if exists "public read cleared media assets" on public.media_assets;
create policy "public read cleared media assets" on public.media_assets for select to anon,authenticated using(clearance_status='cleared' and sync_status='active' and not review_required and exists(select 1 from public.places p where p.id=place_id and p.is_published));
-- SOURCE: migrations/20261018000000_media_facade_archive.sql
-- v0.16 global media facade archive (docs/ARCHIVE_SPEC.md §4 and §8; reference: docs/ARCHIVE_DB.md): projects with
-- their sources, credits and media, the collection pipeline (rules, runs, candidates, hits, project updates),
-- researcher assessments and the audit log. Re-runnable: apply after the legacy SQL 01..18, 20261010160920 and
-- 20261013000000 (also part of release/launch/complete-backend.sql), then release/launch/archive-seed.sql.
--
-- Access: every table has RLS on, no policy, and no anon/authenticated privilege. Visitors read only the view
-- public_archive_projects (owner rights, like public_discovered_places, so it is the only way in) and the two public
-- functions. Editors, researchers and admins (app_admins.role) use the security definer admin functions, each of
-- which checks archive_role() first. The Edge Functions (service_role) use the service functions, which nobody else
-- may execute.
--
-- Data honesty: a value is only as verified as its field_status entry says ({state, source_id?, at?}; a missing key
-- means unverified). Web-derived information enters as a candidate and becomes a project only through an editor.

create schema if not exists extensions;
-- pg_trgm is REQUIRED (Supabase ships it): dedupe rules 5 and 6 of archive_ingest, archive_search and the candidate
-- list's suggested matches call it. The schema still installs where it is missing, only so the release bundle can be
-- checked on a bare Postgres: the trigram indexes are then skipped, and those calls fail with 42883 (undefined_function);
-- archive_ingest logs that per item (stage 'ingest') and counts the item as ignored.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_trgm') then create extension if not exists pg_trgm with schema extensions;
 else raise warning 'pg_trgm is not available but the archive requires it: archive_ingest (dedupe rules 5-6), archive_search and archive_admin_list_candidates will fail with 42883 until it is installed'; end if;
end $$;

-- ---- roles ---------------------------------------------------------------------------------------------------
create table if not exists public.app_admins(
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null default 'editor',
 can_promote boolean not null default true,
 can_run_discovery boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from public,anon,authenticated;
grant all on public.app_admins to service_role;
-- The v0.10 setup docs (LAUNCH.md) register the operator as 'owner': that is the archive admin, now and later.
create or replace function public.archive_app_admins_role() returns trigger language plpgsql set search_path='' as $$
begin if new.role='owner' then new.role:='admin'; end if; return new; end $$;
drop trigger if exists app_admins_archive_role on public.app_admins;
create trigger app_admins_archive_role before insert or update of role on public.app_admins for each row execute function public.archive_app_admins_role();
-- Any other legacy value had full admin-console access, which 'editor' keeps.
update public.app_admins set role=case when role='owner' then 'admin' else 'editor' end where role not in ('admin','editor','researcher');
alter table public.app_admins alter column role set default 'editor';
alter table public.app_admins drop constraint if exists app_admins_role_check;
alter table public.app_admins add constraint app_admins_role_check check(role in ('admin','editor','researcher'));

-- Researchers assess projects but are not editors: the legacy admin console and its RPCs stay with admin and editor.
create or replace function public.is_app_admin() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.app_admins a where a.user_id=(select auth.uid()) and a.role in ('admin','editor'))
$$;
create or replace function public.archive_role() returns text language sql stable security definer set search_path=public as $$
 select a.role from public.app_admins a where a.user_id=(select auth.uid())
$$;
create or replace function public.archive_require(p_roles text[]) returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_role text:=public.archive_role();
begin
 if v_role is null or not v_role=any(p_roles) then
  raise exception 'archive role required: %',array_to_string(p_roles,' or ') using errcode='insufficient_privilege';
 end if;
 return v_role;
end $$;

-- ---- pure helpers (also used by check constraints and indexes) -------------------------------------------------
create or replace function public.archive_region_of(p_iso2 text) returns text language sql immutable set search_path='' as $$
 -- site-public-cleared/archive-taxonomy.js regionOf (tests/archive-sql.test.mjs compares the two)
 select case
 when p_iso2 in ('KR','KP','JP','CN','TW','HK','MO','MN') then 'east_asia'
 when p_iso2 in ('SG','MY','TH','VN','PH','ID','KH','LA','MM','BN','TL') then 'southeast_asia'
 when p_iso2 in ('IN','PK','BD','LK','NP','BT','MV','AF') then 'south_asia'
 when p_iso2 in ('KZ','UZ','TM','KG','TJ') then 'central_asia'
 when p_iso2 in ('AE','SA','QA','KW','BH','OM','YE','IQ','IR','IL','PS','JO','LB','SY','TR','CY') then 'middle_east'
 when p_iso2 in ('GB','IE','FR','DE','NL','BE','LU','CH','AT','IT','ES','PT','GR','MT','DK','NO','SE','FI','IS','EE','LV','LT','PL','CZ','SK','HU','SI','HR','BA','RS','ME','MK','AL','XK','BG','RO','MD','UA','BY','RU','GE','AM','AZ','LI','MC','SM','VA','AD','FO','GL','GI','IM','JE','GG','AX') then 'europe'
 when p_iso2 in ('EG','MA','DZ','TN','LY','SD','SS','ET','ER','DJ','SO','KE','UG','TZ','RW','BI','CD','CG','CF','CM','GA','GQ','ST','NG','NE','TD','ML','BF','SN','GM','GW','GN','SL','LR','CI','GH','TG','BJ','MR','CV','AO','ZM','ZW','MW','MZ','MG','MU','SC','KM','NA','BW','ZA','LS','SZ','RE','YT','SH','EH') then 'africa'
 when p_iso2 in ('US','CA','BM','PM') then 'north_america'
 when p_iso2 in ('MX','GT','BZ','SV','HN','NI','CR','PA','CU','JM','HT','DO','PR','BS','BB','TT','AG','DM','GD','KN','LC','VC','AW','CW','SX','BQ','KY','TC','VG','VI','AI','MS','GP','MQ','BL','MF','CO','VE','GY','SR','GF','EC','PE','BO','BR','PY','UY','AR','CL','FK') then 'latin_america'
 when p_iso2 in ('AU','NZ','PG','FJ','SB','VU','NC','PF','WS','TO','KI','TV','NR','FM','MH','PW','GU','MP','AS','CK','NU','TK','WF') then 'oceania'
 end
$$;
create or replace function public.archive_valid_field_status(p jsonb) returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p) is distinct from 'object' then false else not exists(
  select 1 from jsonb_each(p) e(k,v)
  where k !~ '^[a-z][a-z0-9_]{0,63}$' or jsonb_typeof(v)<>'object'
   or coalesce(v->>'state','') not in ('unverified','source_reported','derived','editor_verified','researcher_assessed')) end
$$;
-- The content fields of a project ('credits' stands for its archive_credits rows): field_status keys, editable fields.
create or replace function public.archive_project_fields() returns text[] language sql immutable set search_path='' as $$
 select array['name_original','name_original_lang','name_en','name_ko','aliases','country_iso2','region','city','district','address',
  'latitude','longitude','location_precision','year_installed','year_completed','year_operating_since','year_ended','operating_status',
  'building_name','project_type','installation_method','envelope_type','technology','display_area_m2','resolution_text','pixel_pitch_mm',
  'content_type','interactive','viewing_points','spatial_context','urban_context','summary_ko','summary_en','wikidata_qid','official_url',
  'discovered_qid','curated_place_id','credits']
$$;
-- Comparable form of a URL for official-URL matching: no scheme, fragment, www., trailing slash or tracking parameters.
create or replace function public.archive_url_key(p_url text) returns text language sql immutable set search_path='' as $$
 select case when nullif(btrim(p_url),'') is null then null else (
  select lower(regexp_replace(b.h,'^www\.','','i'))||rtrim(split_part(b.r,'?',1),'/')||coalesce('?'||(
   select string_agg(x.q,'&' order by x.n) from unnest(string_to_array(nullif(substring(b.r from '\?(.*)$'),''),'&')) with ordinality x(q,n)
   where x.q<>'' and x.q !~* '^(utm_[^=]*|fbclid|gclid)(=|$)'),'')
  from (select substring(a.s from '^[^/?]*') h,substring(a.s from '^[^/?]*(.*)$') r
        from (select regexp_replace(regexp_replace(btrim(p_url),'#.*$',''),'^[a-z][a-z0-9+.-]*://','','i') s) a) b) end
$$;
create or replace function public.archive_url_host(p_url text) returns text language sql immutable set search_path='' as $$
 select lower(regexp_replace(substring(regexp_replace(btrim(p_url),'^[a-z][a-z0-9+.-]*://','','i') from '^[^/?#:]*'),'^www\.','','i'))
$$;
-- Same normalization on both sides of dedupe rule 4, so it does not depend on how the collector normalized the name.
create or replace function public.archive_norm_name(p text) returns text language sql immutable set search_path='' as $$
 select nullif(regexp_replace(lower(normalize(p,NFKC)),'[[:space:][:punct:]·・、。「」『』【】〈〉《》（）“”‘’«»]+','','g'),'')
$$;
create or replace function public.archive_name_text(a text,b text,c text,d text[]) returns text language sql immutable set search_path='' as $$
 select lower(concat_ws(' ',a,b,c,array_to_string(d,' ')))
$$;
create or replace function public.archive_slugify(p text) returns text language sql immutable set search_path='' as $$
 select nullif(btrim(left(btrim(regexp_replace(regexp_replace(lower(normalize(coalesce(p,''),NFKD)),'[\u0300-\u036f]','','g'),'[^a-z0-9]+','-','g'),'-'),80),'-'),'')
$$;
create or replace function public.archive_distance_m(lat1 float8,lng1 float8,lat2 float8,lng2 float8) returns float8 language sql immutable set search_path='' as $$
 select 2*6371000*asin(least(1,sqrt(sin(radians(lat2-lat1)/2)^2+cos(radians(lat1))*cos(radians(lat2))*sin(radians(lng2-lng1)/2)^2)))
$$;
create or replace function public.archive_base_reliability(p_kind text) returns smallint language sql immutable set search_path='' as $$
 select (case p_kind when 'official' then 90 when 'public_agency' then 85 when 'academic' then 85 when 'wikidata' then 70
  when 'specialist_media' then 70 when 'news' then 55 when 'search_result' then 40 when 'blog' then 30 end)::smallint
$$;
create or replace function public.archive_union(a text[],b text[]) returns text[] language sql immutable set search_path='' as $$
 select coalesce(array(select distinct x from unnest(coalesce(a,'{}')||coalesce(b,'{}')) x where x is not null order by x),'{}')
$$;
create or replace function public.archive_jstr(j jsonb,p_max int,p_null boolean) returns boolean language sql immutable set search_path='' as $$
 select case when j is null or jsonb_typeof(j)='null' then p_null when jsonb_typeof(j)<>'string' then false
  else length(j#>>'{}')<=p_max and (p_null or length(btrim(j#>>'{}'))>0) end
$$;
create or replace function public.archive_jnum(j jsonb,p_lo numeric,p_hi numeric,p_null boolean) returns boolean language sql immutable set search_path='' as $$
 select case when j is null or jsonb_typeof(j)='null' then p_null when jsonb_typeof(j)<>'number' then false else (j#>>'{}')::numeric between p_lo and p_hi end
$$;
-- A JSON string or array as text[]; empty means no filter.
create or replace function public.archive_jarr(j jsonb) returns text[] language sql immutable set search_path='' as $$
 select case jsonb_typeof(j) when 'array' then nullif(array(select jsonb_array_elements_text(j)),'{}') when 'string' then array[j#>>'{}'] end
$$;
-- Blank strings are no value.
create or replace function public.archive_jclean(j jsonb) returns jsonb language sql immutable set search_path='' as $$
 select case when jsonb_typeof(j)='string' then coalesce(to_jsonb(nullif(btrim(j#>>'{}'),'')),'null'::jsonb) else j end
$$;
create or replace function public.archive_like(p text) returns text language sql immutable set search_path='' as $$
 select '%'||replace(replace(replace(p,'\','\\'),'%','\%'),'_','\_')||'%'
$$;
create or replace function public.archive_higher_status(a text,b text) returns text language sql immutable set search_path='' as $$
 select case when 'needs_review' in (a,b) then 'needs_review' when 'uncertain' in (a,b) then 'uncertain' else 'auto_ignored' end
$$;

-- ---- tables ----------------------------------------------------------------------------------------------------
create table if not exists public.archive_projects(
 id uuid primary key default gen_random_uuid(),
 slug text not null unique check(length(slug)<=120 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 name_original text not null check(length(btrim(name_original)) between 1 and 300),
 name_original_lang text check(length(name_original_lang)<=35 and name_original_lang ~* '^[a-z]{2,3}(-[a-z0-9]{1,8})*$'),
 name_en text check(length(name_en)<=300),
 name_ko text check(length(name_ko)<=300),
 aliases text[] not null default '{}' check(cardinality(aliases)<=60),
 country_iso2 text check(country_iso2 ~ '^[A-Z]{2}$'),
 region text check(region in ('east_asia','southeast_asia','south_asia','central_asia','middle_east','europe','africa','north_america','latin_america','oceania')),
 city text check(length(city)<=200),
 district text check(length(district)<=200),
 address text check(length(address)<=500),
 latitude double precision check(latitude between -90 and 90),
 longitude double precision check(longitude between -180 and 180),
 location_precision text not null default 'unknown' check(location_precision in ('exact','street','city','unknown')),
 year_installed smallint check(year_installed between 1900 and 2100),
 year_completed smallint check(year_completed between 1900 and 2100),
 year_operating_since smallint check(year_operating_since between 1900 and 2100),
 year_ended smallint check(year_ended between 1900 and 2100),
 operating_status text check(operating_status in ('operating','seasonal','event_based','ended','inactive','demolished','unknown')),
 building_name text check(length(building_name)<=300),
 project_type text check(project_type in ('media_facade','projection_mapping','urban_screen','media_wall','interactive_installation','light_art','festival_program','media_architecture','other')),
 installation_method text check(installation_method in ('led_mesh','led_cabinet_screen','led_linear_pixel','led_media_glass','led_backlit_cladding','projection','kinetic','lcd_panel','mixed','other')),
 envelope_type text check(envelope_type in ('glass_curtain_wall','metal_mesh','perforated_metal','stone_masonry','concrete','membrane_etfe','louvres_fins','bridge_infrastructure','historic_facade','other')),
 technology text[] not null default '{}' check(technology <@ array['led_rgb','led_mono','pixel_points','laser_projector','lamp_projector','sensors','mobile_interaction','sound','realtime_data','generative','anamorphic_3d']),
 display_area_m2 numeric check(display_area_m2>0 and display_area_m2<1000000),
 resolution_text text check(length(resolution_text)<=200),
 pixel_pitch_mm numeric check(pixel_pitch_mm>0 and pixel_pitch_mm<10000),
 content_type text[] not null default '{}' check(content_type <@ array['artwork','generative','data_visualization','advertising','information','event_program','interactive','anamorphic_3d','mixed']),
 interactive boolean,
 viewing_points text check(length(viewing_points)<=2000),
 spatial_context text[] not null default '{}' check(spatial_context <@ array['plaza','street','waterfront','skyline','transit_hub','cultural_district','commercial_district','campus','park','heritage_site','bridge','interior_atrium']),
 urban_context text check(length(urban_context)<=4000),
 summary_ko text check(length(summary_ko)<=4000),
 summary_en text check(length(summary_en)<=4000),
 wikidata_qid text unique check(wikidata_qid ~ '^Q[1-9][0-9]*$'),
 official_url text check(length(official_url)<=2000 and official_url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'),
 -- Link check of official_url (archive_record_link_checks); three consecutive failures make it broken.
 official_url_state text not null default 'unknown' check(official_url_state in ('unknown','ok','redirect','broken','robots_disallowed','blocked')),
 official_url_failures smallint not null default 0 check(official_url_failures>=0),
 official_url_checked_at timestamptz,
 -- A plain QID, not a foreign key: discovered_places rows come and go with the 6-hourly sync.
 discovered_qid text check(discovered_qid ~ '^Q[1-9][0-9]*$'),
 curated_place_id text unique check(length(curated_place_id)<=40 and curated_place_id ~ '^[A-Za-z0-9_-]+$'),
 record_origin text not null default 'editor_created' check(record_origin in ('curated','auto_collected','editor_created')),
 review_status text not null default 'unreviewed' check(review_status in ('unreviewed','editor_verified','researcher_assessed')),
 visibility text not null default 'draft' check(visibility in ('draft','published','hidden')),
 update_status text not null default 'current' check(update_status in ('current','new_info','stale','link_broken')),
 field_status jsonb not null default '{}' check(public.archive_valid_field_status(field_status)),
 first_collected_at timestamptz,
 last_collected_at timestamptz,
 -- Set only by an editor review (approve_new, or upsert with "reviewed": true); publishing needs it.
 last_verified_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 created_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 internal_note text check(length(internal_note)<=4000),
 -- Set by archive_admin_merge_projects on the project that was merged away (hidden, its names become aliases).
 merged_into uuid references public.archive_projects(id) on delete set null,
 check((latitude is null)=(longitude is null)),
 check(merged_into is distinct from id),
 check(merged_into is null or visibility='hidden')
);

create table if not exists public.archive_sources(
 id uuid primary key default gen_random_uuid(),
 url text not null check(length(url)<=2000 and url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'),
 canonical_url text not null unique check(length(canonical_url)<=2000 and canonical_url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'),
 title text check(length(title)<=500),
 publisher text check(length(publisher)<=200),
 source_kind text not null check(source_kind in ('official','public_agency','academic','specialist_media','news','blog','wikidata','search_result')),
 language text check(length(language)<=35 and language ~* '^[a-z]{2,3}(-[a-z0-9]{1,8})*$'),
 published_at timestamptz,
 retrieved_at timestamptz not null default now(),
 last_checked_at timestamptz,
 http_status smallint check(http_status between 100 and 599),
 link_state text not null default 'unknown' check(link_state in ('unknown','ok','redirect','broken','robots_disallowed','blocked')),
 consecutive_failures smallint not null default 0 check(consecutive_failures>=0),
 -- Base reliability; the public view shows it 30 lower while the link is broken.
 reliability smallint check(reliability between 0 and 100),
 license text check(length(license)<=200),
 excerpt text check(length(excerpt)<=300),
 -- The rule kind it was collected through; null when an editor added it.
 provider text check(provider in ('gdelt','rss','websub','naver_news','naver_blog','brave','wikidata')),
 created_at timestamptz not null default now()
);

create table if not exists public.archive_credits(
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.archive_projects(id) on delete cascade,
 role text not null check(role in ('architect','facade_designer','media_artist','lighting_designer','manufacturer','operator','owner','curator','producer','other')),
 name text not null check(length(btrim(name)) between 1 and 300),
 name_en text check(length(name_en)<=300),
 wikidata_qid text check(wikidata_qid ~ '^Q[1-9][0-9]*$'),
 source_id uuid references public.archive_sources(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(project_id,role,name)
);

create table if not exists public.archive_project_sources(
 project_id uuid not null references public.archive_projects(id) on delete cascade,
 source_id uuid not null references public.archive_sources(id) on delete cascade,
 -- Field names (archive_project_fields) the source states.
 supports text[] not null default '{}' check(cardinality(supports)<=60 and array_to_string(supports,',') ~ '^[a-z0-9_,]*$'),
 added_at timestamptz not null default now(),
 added_by uuid references auth.users(id) on delete set null,
 primary key(project_id,source_id)
);

create table if not exists public.archive_media(
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.archive_projects(id) on delete cascade,
 url text not null check(length(url)<=2000 and url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'),
 page_url text check(length(page_url)<=2000 and page_url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'),
 commons_file text check(length(commons_file)<=240),
 license text check(length(license)<=200),
 license_url text check(length(license_url)<=2000 and license_url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'),
 author text check(length(author)<=300),
 attribution text check(length(attribution)<=1000),
 rights_status text not null default 'pending' check(rights_status in ('pending','cleared','blocked')),
 is_primary boolean not null default false,
 link_state text not null default 'unknown' check(link_state in ('unknown','ok','redirect','broken','robots_disallowed','blocked')),
 consecutive_failures smallint not null default 0 check(consecutive_failures>=0),
 http_status smallint check(http_status between 100 and 599),
 last_checked_at timestamptz,
 source_id uuid references public.archive_sources(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(project_id,url),
 -- A cleared image is shown with its licence and credit, so both must be there.
 check(rights_status<>'cleared' or (license is not null and coalesce(attribution,author) is not null))
);

create table if not exists public.archive_collection_rules(
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('gdelt','rss','websub','naver_news','naver_blog','brave','wikidata')),
 name text not null check(length(btrim(name)) between 1 and 200),
 query text check(length(query)<=4000),
 url text check(length(url)<=2000 and url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'),
 language text check(length(language)<=35 and language ~* '^[a-z]{2,3}(-[a-z0-9]{1,8})*$'),
 region_hint text check(length(region_hint)<=40),
 enabled boolean not null default true,
 cadence_hours smallint not null default 6 check(cadence_hours between 1 and 720),
 next_run_at timestamptz,
 last_run_at timestamptz,
 last_status text check(last_status in ('running','success','partial','error','skipped')),
 failure_count integer not null default 0 check(failure_count>=0),
 backoff_until timestamptz,
 etag text check(length(etag)<=500),
 last_modified text check(length(last_modified)<=100),
 terms_url text check(length(terms_url)<=2000 and terms_url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'),
 verified_at timestamptz,
 notes text check(length(notes)<=2000),
 -- Who claimed it (archive_claim_due_rules) and when; a claim older than 30 minutes is treated as abandoned.
 claimed_by text check(length(claimed_by)<=100),
 claimed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(kind,name)
);

create table if not exists public.archive_keywords(
 id uuid primary key default gen_random_uuid(),
 term text not null check(length(btrim(term)) between 1 and 200),
 language text not null check(length(language)<=35 and language ~* '^[a-z]{2,3}(-[a-z0-9]{1,8})*$'),
 polarity text not null check(polarity in ('positive','context','negative')),
 weight smallint not null default 10 check(weight between 0 and 100),
 enabled boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(term,language)
);

create table if not exists public.archive_runs(
 id uuid primary key default gen_random_uuid(),
 rule_id uuid references public.archive_collection_rules(id) on delete set null,
 trigger text not null check(trigger in ('cron','admin','websub','probe')),
 status text not null default 'running' check(status in ('running','success','partial','error','skipped')),
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 fetched integer not null default 0 check(fetched>=0),
 kept integer not null default 0 check(kept>=0),
 new_candidates integer not null default 0 check(new_candidates>=0),
 matched_projects integer not null default 0 check(matched_projects>=0),
 duplicates integer not null default 0 check(duplicates>=0),
 ignored integer not null default 0 check(ignored>=0),
 errors integer not null default 0 check(errors>=0),
 attempt smallint not null default 1 check(attempt>=1),
 -- Further counts the collector reports (label breakdowns and the like).
 detail jsonb not null default '{}' check(jsonb_typeof(detail)='object')
);

create table if not exists public.archive_run_errors(
 id uuid primary key default gen_random_uuid(),
 run_id uuid references public.archive_runs(id) on delete cascade,
 rule_id uuid references public.archive_collection_rules(id) on delete set null,
 at timestamptz not null default now(),
 stage text not null check(length(stage) between 1 and 40),
 http_status smallint check(http_status between 100 and 599),
 message text not null check(length(message) between 1 and 1000),
 url text check(length(url)<=2000)
);

create table if not exists public.archive_candidates(
 id uuid primary key default gen_random_uuid(),
 status text not null default 'needs_review' check(status in ('needs_review','uncertain','auto_ignored','approved','merged','rejected','duplicate')),
 label text check(label in ('facade_project','event_program','ad_screen','product_vendor','irrelevant','uncertain')),
 score smallint not null default 0 check(score between 0 and 100),
 confidence smallint not null default 0 check(confidence between 0 and 100),
 reasons jsonb not null default '[]' check(jsonb_typeof(reasons)='array'),
 classifier_version text check(length(classifier_version)<=40),
 detected_name text check(length(detected_name)<=300),
 detected_country_iso2 text check(detected_country_iso2 ~ '^[A-Z]{2}$'),
 detected_city text check(length(detected_city)<=200),
 latitude double precision check(latitude between -90 and 90),
 longitude double precision check(longitude between -180 and 180),
 language text check(length(language)<=35 and language ~* '^[a-z]{2,3}(-[a-z0-9]{1,8})*$'),
 -- keys.story_key of the first hit (dedupe rule 6).
 dedupe_key text check(length(dedupe_key)<=500),
 -- archive_norm_name(keys.normalized_name) and keys.wikidata_qid (dedupe rules 4 and 1).
 normalized_name text check(length(normalized_name)<=300),
 wikidata_qid text check(wikidata_qid ~ '^Q[1-9][0-9]*$'),
 -- The project it became (approved) or was attached to (merged).
 matched_project_id uuid references public.archive_projects(id) on delete set null,
 -- The candidate it was merged into (status duplicate).
 duplicate_of uuid references public.archive_candidates(id) on delete set null,
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 seen_count integer not null default 1 check(seen_count>=1),
 reviewed_by uuid references auth.users(id) on delete set null,
 reviewed_at timestamptz,
 review_note text check(length(review_note)<=2000),
 check((latitude is null)=(longitude is null)),
 check(duplicate_of is distinct from id),
 check(status<>'rejected' or length(btrim(review_note))>0)
);

create table if not exists public.archive_candidate_hits(
 id uuid primary key default gen_random_uuid(),
 candidate_id uuid references public.archive_candidates(id) on delete cascade,
 -- A hit matched to a known project hangs off the project (its archive_project_updates row lists it) instead.
 project_id uuid references public.archive_projects(id) on delete cascade,
 rule_id uuid references public.archive_collection_rules(id) on delete set null,
 provider text not null check(provider in ('gdelt','rss','websub','naver_news','naver_blog','brave','wikidata')),
 external_id text check(length(external_id)<=500),
 url text not null check(length(url)<=2000 and url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'),
 canonical_url text not null check(length(canonical_url)<=2000 and canonical_url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'),
 title text not null check(length(btrim(title)) between 1 and 500),
 excerpt text check(length(excerpt)<=300),
 publisher text check(length(publisher)<=200),
 language text check(length(language)<=35 and language ~* '^[a-z]{2,3}(-[a-z0-9]{1,8})*$'),
 published_at timestamptz,
 fetched_at timestamptz not null default now(),
 source_kind text check(source_kind in ('official','public_agency','academic','specialist_media','news','blog','wikidata','search_result')),
 reliability smallint check(reliability between 0 and 100),
 score smallint check(score between 0 and 100),
 label text check(label in ('facade_project','event_program','ad_screen','product_vendor','irrelevant','uncertain')),
 -- API fields only, never article bodies: the contract's 4 kB, with room for Postgres's own wider text form.
 raw jsonb not null default '{}' check(jsonb_typeof(raw)='object' and octet_length(raw::text)<=6144),
 unique(provider,canonical_url),
 check(num_nonnulls(candidate_id,project_id)=1)
);

create table if not exists public.archive_project_updates(
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.archive_projects(id) on delete cascade,
 kind text not null check(kind in ('new_source','changed_field','link_broken','image_broken','wikidata_changed')),
 detail jsonb not null default '{}' check(jsonb_typeof(detail)='object'),
 status text not null default 'open' check(status in ('open','applied','dismissed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 resolved_by uuid references auth.users(id) on delete set null,
 resolved_at timestamptz,
 check((status='open')=(resolved_at is null))
);

create table if not exists public.archive_websub_subscriptions(
 id uuid primary key default gen_random_uuid(),
 topic text not null unique check(length(topic)<=2000 and topic ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'),
 hub text not null check(length(hub)<=2000 and hub ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'),
 -- The HMAC key the hub signs pushes with. Server only: no view and no client-callable function returns it.
 secret text not null check(length(secret) between 16 and 200),
 state text not null default 'pending' check(state in ('pending','active','failed','expired')),
 lease_expires_at timestamptz,
 last_push_at timestamptz,
 rule_id uuid references public.archive_collection_rules(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.archive_assessments(
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.archive_projects(id) on delete cascade,
 assessor uuid references auth.users(id) on delete set null,
 attribute text not null check(attribute ~ '^[a-z][a-z0-9_]{0,63}$'),
 value jsonb not null check(octet_length(value::text)<=4096),
 confidence text not null check(confidence in ('low','medium','high')),
 method text check(length(method)<=300),
 note text check(length(note)<=2000),
 created_at timestamptz not null default now()
);

create table if not exists public.archive_audit_log(
 id uuid primary key default gen_random_uuid(),
 actor uuid,
 action text not null check(length(action) between 1 and 80),
 entity text not null check(length(entity) between 1 and 80),
 entity_id text check(length(entity_id)<=100),
 before jsonb,
 after jsonb,
 at timestamptz not null default now()
);

create table if not exists public.archive_settings(
 id boolean primary key default true check(id),
 auto_list_structured boolean not null default true,
 auto_ignore_below smallint not null default 35 check(auto_ignore_below between 0 and 100),
 review_threshold smallint not null default 60 check(review_threshold between 0 and 100),
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null,
 check(auto_ignore_below<=review_threshold)
);
insert into public.archive_settings(id) values(true) on conflict(id) do nothing;

do $$ declare t text; begin
 foreach t in array array['archive_projects','archive_sources','archive_credits','archive_project_sources','archive_media','archive_collection_rules',
  'archive_keywords','archive_runs','archive_run_errors','archive_candidates','archive_candidate_hits','archive_project_updates',
  'archive_websub_subscriptions','archive_assessments','archive_audit_log','archive_settings'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

-- ---- indexes ---------------------------------------------------------------------------------------------------
create index if not exists archive_projects_country on public.archive_projects(country_iso2);
create index if not exists archive_projects_type on public.archive_projects(project_type);
create index if not exists archive_projects_year on public.archive_projects(year_installed);
create index if not exists archive_projects_updated on public.archive_projects(updated_at);
create index if not exists archive_projects_first_collected on public.archive_projects(first_collected_at);
create index if not exists archive_projects_official_url on public.archive_projects(public.archive_url_key(official_url)) where official_url is not null;
create index if not exists archive_projects_location on public.archive_projects(latitude,longitude) where latitude is not null;
create index if not exists archive_credits_project on public.archive_credits(project_id);
create index if not exists archive_project_sources_source on public.archive_project_sources(source_id);
create index if not exists archive_media_project on public.archive_media(project_id);
create unique index if not exists archive_media_one_primary on public.archive_media(project_id) where is_primary;
create index if not exists archive_candidates_queue on public.archive_candidates(status,confidence desc);
create index if not exists archive_candidates_qid on public.archive_candidates(wikidata_qid) where wikidata_qid is not null;
create index if not exists archive_candidates_story on public.archive_candidates(dedupe_key);
create index if not exists archive_candidates_name on public.archive_candidates(normalized_name) where normalized_name is not null;
create index if not exists archive_candidates_duplicate_of on public.archive_candidates(duplicate_of) where duplicate_of is not null;
create index if not exists archive_candidates_ignored on public.archive_candidates(last_seen_at) where status='auto_ignored';
create index if not exists archive_candidate_hits_url on public.archive_candidate_hits(canonical_url);
create index if not exists archive_candidate_hits_candidate on public.archive_candidate_hits(candidate_id);
create index if not exists archive_candidate_hits_project on public.archive_candidate_hits(project_id) where project_id is not null;
create index if not exists archive_candidate_hits_fetched on public.archive_candidate_hits(fetched_at);
create unique index if not exists archive_project_updates_open on public.archive_project_updates(project_id,kind) where status='open';
create index if not exists archive_runs_rule on public.archive_runs(rule_id,started_at desc);
create index if not exists archive_runs_started on public.archive_runs(started_at);
create index if not exists archive_run_errors_at on public.archive_run_errors(at);
create index if not exists archive_run_errors_run on public.archive_run_errors(run_id);
create index if not exists archive_assessments_project on public.archive_assessments(project_id);
create index if not exists archive_audit_log_entity on public.archive_audit_log(entity,entity_id,at);
create index if not exists archive_audit_log_at on public.archive_audit_log(at);
-- The operator class is looked up where the extension lives (extensions on Supabase, public on older installs).
do $$ declare s text:=(select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm');
begin
 if s is not null then
  execute format('create index if not exists archive_projects_names_trgm on public.archive_projects using gin (public.archive_name_text(name_original,name_en,name_ko,aliases) %I.gin_trgm_ops)',s);
  execute format('create index if not exists archive_candidate_hits_title_trgm on public.archive_candidate_hits using gin (lower(title) %I.gin_trgm_ops)',s);
 end if;
end $$;

-- ---- triggers --------------------------------------------------------------------------------------------------
create or replace function public.archive_touch() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at:=now(); return new; end $$;
-- Collection and link-check bookkeeping is not an edit: "recently updated" means the record itself changed.
create or replace function public.archive_projects_touch() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-array['updated_at','last_collected_at','update_status','official_url_state','official_url_checked_at','official_url_failures'])
    is distinct from (to_jsonb(old)-array['updated_at','last_collected_at','update_status','official_url_state','official_url_checked_at','official_url_failures']) then
  new.updated_at:=now();
 end if;
 return new;
end $$;
drop trigger if exists archive_projects_touch on public.archive_projects;
create trigger archive_projects_touch before update on public.archive_projects for each row execute function public.archive_projects_touch();
do $$ declare t text; begin
 foreach t in array array['archive_media','archive_collection_rules','archive_keywords','archive_project_updates','archive_websub_subscriptions','archive_settings'] loop
  execute format('drop trigger if exists %I on public.%I',t||'_touch',t);
  execute format('create trigger %I before update on public.%I for each row execute function public.archive_touch()',t||'_touch',t);
 end loop;
end $$;

-- ---- internal helpers (owner and service_role only) ------------------------------------------------------------
create or replace function public.archive_audit(p_action text,p_entity text,p_entity_id text,p_before jsonb,p_after jsonb) returns void
language sql security definer set search_path=public,pg_temp as $$
 insert into public.archive_audit_log(actor,action,entity,entity_id,before,after) values((select auth.uid()),p_action,p_entity,p_entity_id,p_before,p_after)
$$;
-- The project a merged project was merged into (followed to the end), or the project itself; null if unknown.
create or replace function public.archive_project_target(p_id uuid) returns uuid language plpgsql stable set search_path=public,pg_temp as $$
declare v_cur uuid:=p_id; v_next uuid;
begin
 for i in 1..20 loop
  select p.merged_into into v_next from public.archive_projects p where p.id=v_cur;
  if not found then return null; end if;
  if v_next is null then return v_cur; end if;
  v_cur:=v_next;
 end loop;
 return v_cur;
end $$;
-- Where a hit for this candidate belongs: a duplicate's target candidate, or the project an approved/merged one became.
create or replace function public.archive_candidate_target(p_id uuid,out o_candidate uuid,out o_project uuid) language plpgsql stable set search_path=public,pg_temp as $$
declare v_c record; v_cur uuid:=p_id;
begin
 for i in 1..10 loop
  select c.id,c.status,c.duplicate_of,c.matched_project_id into v_c from public.archive_candidates c where c.id=v_cur;
  if not found then return; end if;
  exit when v_c.status<>'duplicate' or v_c.duplicate_of is null;
  v_cur:=v_c.duplicate_of;
 end loop;
 o_candidate:=v_c.id;
 if v_c.status in ('approved','merged') and v_c.matched_project_id is not null then o_project:=public.archive_project_target(v_c.matched_project_id); end if;
end $$;
-- confidence = round(0.6 × score + 0.4 × best reliability), +10 per further independent domain (at most +20).
create or replace function public.archive_refresh_candidate(p_id uuid) returns void language sql set search_path=public,pg_temp as $$
 update public.archive_candidates c set confidence=x.conf
 from (select round(0.6*c2.score+0.4*least(100,coalesce(max(h.reliability),0)+least(20,10*greatest(count(distinct public.archive_url_host(h.canonical_url))-1,0))))::smallint conf
       from public.archive_candidates c2
       left join public.archive_candidate_hits h on h.candidate_id=c2.id or h.candidate_id in (select d.id from public.archive_candidates d where d.duplicate_of=c2.id)
       where c2.id=p_id group by c2.score) x
 where c.id=p_id and c.confidence is distinct from x.conf
$$;
-- update_status from the open updates: a broken official link first, then new information, otherwise current.
create or replace function public.archive_refresh_update_status(p_project uuid) returns void language sql set search_path=public,pg_temp as $$
 update public.archive_projects p set update_status=x.s
 from (select case
   when exists(select 1 from public.archive_project_updates u where u.project_id=q.id and u.status='open' and u.kind='link_broken') then 'link_broken'
   when exists(select 1 from public.archive_project_updates u where u.project_id=q.id and u.status='open' and u.kind in ('new_source','changed_field','wikidata_changed')) then 'new_info'
   when q.update_status in ('link_broken','new_info') then 'current' else q.update_status end s
  from public.archive_projects q where q.id=p_project) x
 where p.id=p_project and p.update_status is distinct from x.s
$$;
-- Merges new detail into an open update: "hits" lists are appended (the latest 100 kept), other keys replaced; "count"
-- is the number of reports.
create or replace function public.archive_merge_detail(a jsonb,b jsonb) returns jsonb language sql immutable set search_path='' as $$
 select (coalesce(a,'{}')||(coalesce(b,'{}')-'hits'-'count'))
  ||case when a ? 'hits' or b ? 'hits' then jsonb_build_object('hits',(
     select coalesce(jsonb_agg(t.x order by t.n),'[]') from (
      select s.x,s.n from jsonb_array_elements(coalesce(a->'hits','[]')||coalesce(b->'hits','[]')) with ordinality s(x,n) order by s.n desc limit 100) t))
   else '{}' end
  ||jsonb_build_object('count',coalesce((a->>'count')::int,0)+1)
$$;
create or replace function public.archive_new_slug(p_name text) returns text language plpgsql set search_path=public,pg_temp as $$
declare v_base text:=coalesce(public.archive_slugify(p_name),'project'); v_slug text:=v_base;
begin
 for i in 2..50 loop
  exit when not exists(select 1 from public.archive_projects where slug=v_slug);
  v_slug:=btrim(left(v_base,72),'-')||'-'||i;
 end loop;
 if exists(select 1 from public.archive_projects where slug=v_slug) then v_slug:=btrim(left(v_base,64),'-')||'-'||substr(md5(gen_random_uuid()::text),1,8); end if;
 return v_slug;
end $$;
-- An archive_sources row for a hit (one per canonical URL), linked to the project.
create or replace function public.archive_source_from_hit(p_hit uuid,p_project uuid,p_supports text[]) returns uuid language plpgsql set search_path=public,pg_temp as $$
declare h public.archive_candidate_hits; v_sid uuid;
begin
 select * into h from public.archive_candidate_hits where id=p_hit;
 if not found then return null; end if;
 insert into public.archive_sources as s(url,canonical_url,title,publisher,source_kind,language,published_at,retrieved_at,reliability,excerpt,provider)
 values(h.url,h.canonical_url,h.title,h.publisher,coalesce(h.source_kind,'search_result'),h.language,h.published_at,h.fetched_at,h.reliability,h.excerpt,h.provider)
 on conflict(canonical_url) do update set title=coalesce(s.title,excluded.title) returning s.id into v_sid;
 insert into public.archive_project_sources as ps(project_id,source_id,supports,added_by) values(p_project,v_sid,public.archive_union(p_supports,'{}'),auth.uid())
 on conflict(project_id,source_id) do update set supports=public.archive_union(ps.supports,excluded.supports);
 return v_sid;
end $$;
-- Sources for every hit of a candidate and of the candidates merged into it; returns the Wikidata source if there is
-- one, else the most reliable (the source of source-reported fields).
create or replace function public.archive_sources_from_candidate(p_candidate uuid,p_project uuid,p_supports text[]) returns uuid language plpgsql set search_path=public,pg_temp as $$
declare h record; v_sid uuid; v_best uuid; v_wd uuid;
begin
 for h in select x.id,x.provider from public.archive_candidate_hits x
  where x.candidate_id=p_candidate or x.candidate_id in (select d.id from public.archive_candidates d where d.duplicate_of=p_candidate)
  order by x.reliability desc nulls last,x.fetched_at loop
  v_sid:=public.archive_source_from_hit(h.id,p_project,p_supports);
  v_best:=coalesce(v_best,v_sid);
  if h.provider='wikidata' then v_wd:=coalesce(v_wd,v_sid); end if;
 end loop;
 return coalesce(v_wd,v_best);
end $$;

-- Creates (p_id null) or updates a project from editor-submitted fields (p_fields) and source-reported ones
-- (p_reported, from p_source). Field states: submitted → editor_verified, reported → source_reported, region from the
-- country → derived, no value → no entry (unverified). Callers check the role and write the audit log.
create or replace function public.archive_apply_project(p_id uuid,p_fields jsonb,p_reported jsonb,p_source uuid,p_origin text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_f text[]:=public.archive_project_fields();
 -- Set by the database; a client may send them back from archive_admin_list_projects and they are ignored.
 v_ro constant text[]:=array['id','created_at','updated_at','created_by','updated_by','field_status','record_origin','review_status','update_status',
  'first_collected_at','last_collected_at','last_verified_at','merged_into','official_url_state','official_url_checked_at','official_url_failures',
  'sources','media','assessments','open_updates','candidates'];
 v_meta constant text[]:=array['slug','visibility','reviewed','reported','reported_source_id','internal_note'];
 v_rep jsonb:=coalesce(p_reported,'{}'); v_patch jsonb; v_fs jsonb; v_k text; v_v jsonb; v_cr jsonb;
 v_old public.archive_projects; v_new public.archive_projects; v_uid uuid:=auth.uid(); v_now timestamptz:=now(); v_name text; v_region text;
begin
 if jsonb_typeof(p_fields) is distinct from 'object' then raise exception 'project must be a JSON object' using errcode='22023'; end if;
 if jsonb_typeof(v_rep)<>'object' then raise exception 'reported must be a JSON object' using errcode='22023'; end if;
 for v_k in select jsonb_object_keys(p_fields) loop
  if not (v_k=any(v_f) or v_k=any(v_ro) or v_k=any(v_meta)) then raise exception 'unknown project field: %',v_k using errcode='22023'; end if;
 end loop;
 for v_k in select jsonb_object_keys(v_rep) loop
  if not v_k=any(v_f) then raise exception 'unknown reported field: %',v_k using errcode='22023'; end if;
 end loop;
 select coalesce(jsonb_object_agg(e.key,public.archive_jclean(e.value)),'{}') into v_patch
 from (select key,value from jsonb_each(v_rep) where not p_fields ? key union all select key,value from jsonb_each(p_fields) where key=any(v_f)) e;
 if jsonb_typeof(v_patch->'country_iso2')='string' then v_patch:=jsonb_set(v_patch,'{country_iso2}',to_jsonb(upper(v_patch->>'country_iso2'))); end if;
 if p_id is null then
  v_name:=coalesce(v_patch->>'name_original',v_patch->>'name_en',v_patch->>'name_ko');
  if v_name is null then raise exception 'a project needs a name (name_original, name_en or name_ko)' using errcode='22023'; end if;
  insert into public.archive_projects(slug,name_original,record_origin,created_by,updated_by)
  values(coalesce(nullif(btrim(p_fields->>'slug'),''),public.archive_new_slug(coalesce(v_patch->>'name_en',v_name))),v_name,p_origin,v_uid,v_uid) returning * into v_old;
  v_fs:='{}';
  -- An original name taken from the English or Korean one is derived from it, not verified as the original.
  if not v_patch ? 'name_original' then v_fs:=jsonb_build_object('name_original',jsonb_build_object('state','derived','at',v_now)); end if;
 else
  select * into v_old from public.archive_projects where id=p_id for update;
  if not found then raise exception 'unknown project %',p_id using errcode='22023'; end if;
  v_fs:=v_old.field_status;
 end if;
 v_new:=jsonb_populate_record(v_old,v_patch-'credits');
 v_new.aliases:=coalesce(v_new.aliases,'{}'); v_new.technology:=coalesce(v_new.technology,'{}');
 v_new.content_type:=coalesce(v_new.content_type,'{}'); v_new.spatial_context:=coalesce(v_new.spatial_context,'{}');
 v_new.location_precision:=coalesce(v_new.location_precision,'unknown');
 if v_new.name_original is null then raise exception 'name_original cannot be removed' using errcode='22023'; end if;
 for v_k,v_v in select key,value from jsonb_each(v_patch) loop
  if v_v='null'::jsonb or v_v='[]'::jsonb then v_fs:=v_fs-v_k;
  elsif p_fields ? v_k then v_fs:=v_fs||jsonb_build_object(v_k,jsonb_build_object('state','editor_verified','at',v_now));
  else v_fs:=v_fs||jsonb_build_object(v_k,jsonb_strip_nulls(jsonb_build_object('state','source_reported','source_id',p_source,'at',v_now)));
  end if;
 end loop;
 -- The region follows the country (taxonomy regionOf); only a country outside that map keeps a stated region.
 if v_patch ? 'country_iso2' then
  v_region:=public.archive_region_of(v_new.country_iso2);
  if v_region is not null then v_new.region:=v_region; v_fs:=v_fs||jsonb_build_object('region',jsonb_build_object('state','derived','at',v_now));
  elsif not v_patch ? 'region' then v_new.region:=null; v_fs:=v_fs-'region'; end if;
 end if;
 if v_new.official_url is distinct from v_old.official_url then
  v_new.official_url_state:='unknown'; v_new.official_url_failures:=0; v_new.official_url_checked_at:=null;
 end if;
 if nullif(btrim(p_fields->>'slug'),'') is not null then v_new.slug:=btrim(p_fields->>'slug'); end if;
 if p_fields ? 'internal_note' then v_new.internal_note:=nullif(btrim(p_fields->>'internal_note'),''); end if;
 if coalesce((p_fields->>'reviewed')::boolean,false) then
  v_new.last_verified_at:=v_now;
  if v_new.review_status='unreviewed' then v_new.review_status:='editor_verified'; end if;
 end if;
 if p_fields ? 'visibility' then v_new.visibility:=p_fields->>'visibility'; end if;
 if v_new.visibility='published' and v_new.merged_into is not null then raise exception 'project was merged into %',v_new.merged_into using errcode='22023'; end if;
 if v_new.visibility='published' and v_new.last_verified_at is null then
  raise exception 'publishing needs an editor review first ("reviewed": true)' using errcode='22023';
 end if;
 if v_patch ? 'credits' then
  v_cr:=v_patch->'credits';
  if v_cr='null'::jsonb then v_cr:='[]'; end if;
  if jsonb_typeof(v_cr)<>'array' then raise exception 'credits must be a JSON array' using errcode='22023'; end if;
  if p_fields ? 'credits' then delete from public.archive_credits where project_id=v_old.id; end if;
  insert into public.archive_credits(project_id,role,name,name_en,wikidata_qid,source_id)
  select v_old.id,c.role,btrim(c.name),nullif(btrim(c.name_en),''),nullif(btrim(c.wikidata_qid),''),case when p_fields ? 'credits' then null else p_source end
  from jsonb_to_recordset(v_cr) c(role text,name text,name_en text,wikidata_qid text)
  on conflict(project_id,role,name) do nothing;
 end if;
 update public.archive_projects set
  slug=v_new.slug,name_original=v_new.name_original,name_original_lang=v_new.name_original_lang,name_en=v_new.name_en,name_ko=v_new.name_ko,aliases=v_new.aliases,
  country_iso2=v_new.country_iso2,region=v_new.region,city=v_new.city,district=v_new.district,address=v_new.address,latitude=v_new.latitude,longitude=v_new.longitude,
  location_precision=v_new.location_precision,year_installed=v_new.year_installed,year_completed=v_new.year_completed,year_operating_since=v_new.year_operating_since,
  year_ended=v_new.year_ended,operating_status=v_new.operating_status,building_name=v_new.building_name,project_type=v_new.project_type,
  installation_method=v_new.installation_method,envelope_type=v_new.envelope_type,technology=v_new.technology,display_area_m2=v_new.display_area_m2,
  resolution_text=v_new.resolution_text,pixel_pitch_mm=v_new.pixel_pitch_mm,content_type=v_new.content_type,interactive=v_new.interactive,
  viewing_points=v_new.viewing_points,spatial_context=v_new.spatial_context,urban_context=v_new.urban_context,summary_ko=v_new.summary_ko,summary_en=v_new.summary_en,
  wikidata_qid=v_new.wikidata_qid,official_url=v_new.official_url,official_url_state=v_new.official_url_state,official_url_failures=v_new.official_url_failures,
  official_url_checked_at=v_new.official_url_checked_at,discovered_qid=v_new.discovered_qid,curated_place_id=v_new.curated_place_id,
  review_status=v_new.review_status,visibility=v_new.visibility,last_verified_at=v_new.last_verified_at,internal_note=v_new.internal_note,
  field_status=v_fs,updated_by=v_uid
 where id=v_old.id;
 return v_old.id;
end $$;

-- Why an ingest item breaks the §8 contract (null when it is valid).
create or replace function public.archive_item_problem(it jsonb) returns text language plpgsql stable set search_path=public,pg_temp as $$
declare v_url constant text:='^https?://[^[:space:]/?#]+[^[:space:]]*$';
 v_uuid constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; c jsonb; d jsonb; k jsonb;
begin
 if jsonb_typeof(it) is distinct from 'object' then return 'not an object'; end if;
 if not public.archive_jstr(it->'provider',20,false) or it->>'provider' not in ('gdelt','rss','websub','naver_news','naver_blog','brave','wikidata') then return 'provider'; end if;
 if it->>'rule_id' is not null then
  if not public.archive_jstr(it->'rule_id',36,false) or it->>'rule_id' !~* v_uuid then return 'rule_id'; end if;
  if not exists(select 1 from public.archive_collection_rules r where r.id=(it->>'rule_id')::uuid) then return 'rule_id (unknown rule)'; end if;
 end if;
 if not public.archive_jstr(it->'external_id',500,true) then return 'external_id'; end if;
 if not public.archive_jstr(it->'url',2000,false) or it->>'url' !~* v_url then return 'url (http or https, at most 2000 characters)'; end if;
 if not public.archive_jstr(it->'canonical_url',2000,false) or it->>'canonical_url' !~* v_url then return 'canonical_url (http or https, at most 2000 characters)'; end if;
 if not public.archive_jstr(it->'title',500,false) then return 'title (1 to 500 characters)'; end if;
 if not public.archive_jstr(it->'excerpt',300,true) then return 'excerpt (at most 300 characters)'; end if;
 if not public.archive_jstr(it->'publisher',200,true) then return 'publisher (at most 200 characters)'; end if;
 if not public.archive_jstr(it->'language',35,true) or it->>'language' !~* '^[a-z]{2,3}(-[a-z0-9]{1,8})*$' then return 'language'; end if;
 if not public.archive_jstr(it->'published_at',40,true) then return 'published_at'; end if;
 if it->>'published_at' is not null then
  begin perform (it->>'published_at')::timestamptz; exception when others then return 'published_at'; end;
 end if;
 if not public.archive_jstr(it->'source_kind',20,false) or it->>'source_kind' not in ('official','public_agency','academic','specialist_media','news','blog','wikidata','search_result') then return 'source_kind'; end if;
 if not public.archive_jnum(it->'reliability',0,100,false) then return 'reliability (0 to 100)'; end if;
 c:=it->'classification';
 if jsonb_typeof(c) is distinct from 'object' then return 'classification'; end if;
 if not public.archive_jnum(c->'score',0,100,false) then return 'classification.score (0 to 100)'; end if;
 if not public.archive_jstr(c->'label',20,false) or c->>'label' not in ('facade_project','event_program','ad_screen','product_vendor','irrelevant','uncertain') then return 'classification.label'; end if;
 if jsonb_typeof(c->'reasons') is distinct from 'array' then return 'classification.reasons'; end if;
 if jsonb_array_length(c->'reasons')>20 or exists(select 1 from jsonb_array_elements(c->'reasons') r where not public.archive_jstr(r,300,false)) then return 'classification.reasons (at most 20 strings)'; end if;
 if not public.archive_jstr(c->'version',40,false) then return 'classification.version'; end if;
 d:=it->'detected';
 if d is null or jsonb_typeof(d)='null' then d:='{}'; end if;
 if jsonb_typeof(d)<>'object' then return 'detected'; end if;
 if not public.archive_jstr(d->'name',300,true) then return 'detected.name'; end if;
 if not public.archive_jstr(d->'country_iso2',2,true) or d->>'country_iso2' !~ '^[A-Z]{2}$' then return 'detected.country_iso2'; end if;
 if not public.archive_jstr(d->'city',200,true) then return 'detected.city'; end if;
 if not public.archive_jnum(d->'latitude',-90,90,true) or not public.archive_jnum(d->'longitude',-180,180,true)
    or (d->>'latitude' is null)<>(d->>'longitude' is null) then return 'detected.latitude/longitude'; end if;
 k:=it->'keys';
 if jsonb_typeof(k) is distinct from 'object' then return 'keys'; end if;
 if not public.archive_jstr(k->'normalized_name',300,true) then return 'keys.normalized_name'; end if;
 if not public.archive_jstr(k->'story_key',500,false) then return 'keys.story_key'; end if;
 if not public.archive_jstr(k->'wikidata_qid',20,true) or k->>'wikidata_qid' !~ '^Q[1-9][0-9]*$' then return 'keys.wikidata_qid'; end if;
 if not public.archive_jstr(k->'alias_project_id',36,true) or k->>'alias_project_id' !~* v_uuid then return 'keys.alias_project_id'; end if;
 if it->'raw' is not null and jsonb_typeof(it->'raw') not in ('object','null') then return 'raw'; end if;
 if octet_length(coalesce(it->'raw','{}')::text)>6144 then return 'raw (over 4 kB)'; end if;
 return null;
end $$;
create or replace function public.archive_insert_hit(it jsonb,p_candidate uuid,p_project uuid,p_rule uuid) returns uuid language sql set search_path=public,pg_temp as $$
 insert into public.archive_candidate_hits(candidate_id,project_id,rule_id,provider,external_id,url,canonical_url,title,excerpt,publisher,language,published_at,source_kind,reliability,score,label,raw)
 values(p_candidate,p_project,p_rule,it->>'provider',it->>'external_id',it->>'url',it->>'canonical_url',btrim(it->>'title'),it->>'excerpt',it->>'publisher',it->>'language',
  (it->>'published_at')::timestamptz,it->>'source_kind',round((it->>'reliability')::numeric),round((it#>>'{classification,score}')::numeric),it#>>'{classification,label}',
  case when jsonb_typeof(it->'raw')='object' then it->'raw' else '{}'::jsonb end)
 returning id
$$;
create or replace function public.archive_rank(p_q text,a text,b text,c text,d text[]) returns real language plpgsql immutable set search_path=public,extensions,pg_temp as $$
declare v_t text:=public.archive_name_text(a,b,c,d); v_best real:=0; v_n text;
begin
 foreach v_n in array array_remove(array[a,b,c]||coalesce(d,'{}'),null) loop
  if lower(v_n)=p_q then return 2; end if;
  v_best:=greatest(v_best,similarity(lower(v_n),p_q));
 end loop;
 return v_best+word_similarity(p_q,v_t)*0.5+case when v_t like p_q||'%' then 0.3 else 0 end;
end $$;

-- ---- public read API -------------------------------------------------------------------------------------------
-- Published projects only, with sources, credits, cleared and unbroken media, and researcher assessments without
-- the assessor. No editor identities, review or internal notes.
create or replace view public.public_archive_projects with (security_invoker=false) as
select p.id,p.slug,p.name_original,p.name_original_lang,p.name_en,p.name_ko,p.aliases,
 p.country_iso2,p.region,p.city,p.district,p.address,p.latitude,p.longitude,p.location_precision,
 p.year_installed,p.year_completed,p.year_operating_since,p.year_ended,p.operating_status,
 p.building_name,p.project_type,p.installation_method,p.envelope_type,p.technology,p.display_area_m2,p.resolution_text,p.pixel_pitch_mm,p.content_type,p.interactive,
 p.viewing_points,p.spatial_context,p.urban_context,p.summary_ko,p.summary_en,
 p.wikidata_qid,p.official_url,p.official_url_state,p.official_url_checked_at,p.discovered_qid,p.curated_place_id,
 p.record_origin,p.review_status,p.visibility,p.update_status,p.field_status,
 p.first_collected_at,p.last_collected_at,p.last_verified_at,p.created_at,p.updated_at,
 coalesce((select jsonb_agg(jsonb_build_object('role',c.role,'name',c.name,'name_en',c.name_en,'wikidata_qid',c.wikidata_qid) order by c.role,c.name)
   from public.archive_credits c where c.project_id=p.id),'[]') credits,
 coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'url',s.url,'publisher',s.publisher,'kind',s.source_kind,'language',s.language,
    'published_at',s.published_at,'retrieved_at',s.retrieved_at,'last_checked_at',s.last_checked_at,'link_state',s.link_state,
    'reliability',case when s.link_state='broken' then greatest(0,s.reliability-30) else s.reliability end,'license',s.license,'supports',ps.supports)
    order by s.reliability desc nulls last,s.published_at desc nulls last,s.id)
   from public.archive_project_sources ps join public.archive_sources s on s.id=ps.source_id where ps.project_id=p.id),'[]') sources,
 coalesce((select jsonb_agg(jsonb_build_object('url',m.url,'page_url',m.page_url,'license',m.license,'license_url',m.license_url,'author',m.author,
    'attribution',m.attribution,'is_primary',m.is_primary) order by m.is_primary desc,m.created_at,m.id)
   from public.archive_media m where m.project_id=p.id and m.rights_status='cleared' and m.link_state<>'broken'),'[]') media,
 coalesce((select jsonb_agg(jsonb_build_object('attribute',a.attribute,'value',a.value,'confidence',a.confidence,'method',a.method,'note',a.note,'created_at',a.created_at)
    order by a.created_at,a.id)
   from public.archive_assessments a where a.project_id=p.id),'[]') assessments
from public.archive_projects p
where p.visibility='published' and p.merged_into is null;
-- Supabase grants new views to anon/authenticated by default; a view with its owner's rights must be read-only for them.
revoke all on public.public_archive_projects from public,anon,authenticated;
grant select on public.public_archive_projects to anon,authenticated,service_role;

-- Filters (each a string or an array of strings): region, country_iso2, city, project_type, installation_method,
-- envelope_type, technology (any of), operating_status, year_from, year_to (on the first known of year_installed,
-- year_completed, year_operating_since), origin (record_origin), review_status. Unknown keys are ignored.
create or replace function public.archive_search(p_q text default null,p_filters jsonb default '{}',p_sort text default 'relevance',p_limit integer default 50,p_offset integer default 0)
returns setof public.public_archive_projects language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare f jsonb:=coalesce(p_filters,'{}'); v_q text:=lower(left(nullif(btrim(p_q),''),200)); v_sort text:=coalesce(nullif(p_sort,''),'relevance');
 f_region text[]; f_country text[]; f_city text[]; f_type text[]; f_method text[]; f_envelope text[]; f_tech text[]; f_status text[]; f_origin text[]; f_review text[];
 f_from int; f_to int;
begin
 if jsonb_typeof(f)<>'object' then raise exception 'p_filters must be a JSON object' using errcode='22023'; end if;
 if v_sort not in ('relevance','newest','updated','year_desc','year_asc','name') then raise exception 'unknown sort %',v_sort using errcode='22023'; end if;
 f_region:=public.archive_jarr(f->'region'); f_country:=(select array_agg(upper(x)) from unnest(public.archive_jarr(f->'country_iso2')) x);
 f_city:=(select array_agg(lower(btrim(x))) from unnest(public.archive_jarr(f->'city')) x); f_type:=public.archive_jarr(f->'project_type');
 f_method:=public.archive_jarr(f->'installation_method'); f_envelope:=public.archive_jarr(f->'envelope_type'); f_tech:=public.archive_jarr(f->'technology');
 f_status:=public.archive_jarr(f->'operating_status'); f_origin:=public.archive_jarr(f->'origin'); f_review:=public.archive_jarr(f->'review_status');
 f_from:=case when f->>'year_from' ~ '^[0-9]{4}$' then (f->>'year_from')::int end;
 f_to:=case when f->>'year_to' ~ '^[0-9]{4}$' then (f->>'year_to')::int end;
 return query
 select v.* from public.public_archive_projects v
 where (v_q is null or public.archive_name_text(v.name_original,v.name_en,v.name_ko,v.aliases) like public.archive_like(v_q)
        or lower(concat_ws(' ',v.city,v.building_name)) like public.archive_like(v_q)
        or v_q <% public.archive_name_text(v.name_original,v.name_en,v.name_ko,v.aliases))
  and (f_region is null or v.region=any(f_region))
  and (f_country is null or v.country_iso2=any(f_country))
  and (f_city is null or lower(btrim(v.city))=any(f_city))
  and (f_type is null or v.project_type=any(f_type))
  and (f_method is null or v.installation_method=any(f_method))
  and (f_envelope is null or v.envelope_type=any(f_envelope))
  and (f_tech is null or v.technology && f_tech)
  and (f_status is null or v.operating_status=any(f_status))
  and (f_origin is null or v.record_origin=any(f_origin))
  and (f_review is null or v.review_status=any(f_review))
  and (f_from is null or coalesce(v.year_installed,v.year_completed,v.year_operating_since)>=f_from)
  and (f_to is null or coalesce(v.year_installed,v.year_completed,v.year_operating_since)<=f_to)
 order by
  case when v_sort='relevance' and v_q is not null then public.archive_rank(v_q,v.name_original,v.name_en,v.name_ko,v.aliases) end desc nulls last,
  case when v_sort='relevance' and v_q is null then case v.review_status when 'researcher_assessed' then 0 when 'editor_verified' then 1 else 2 end end,
  case when v_sort='newest' then coalesce(v.first_collected_at,v.created_at) end desc,
  case when v_sort in ('updated','relevance') then v.updated_at end desc,
  case when v_sort='year_desc' then coalesce(v.year_installed,v.year_completed,v.year_operating_since) end desc nulls last,
  case when v_sort='year_asc' then coalesce(v.year_installed,v.year_completed,v.year_operating_since) end asc nulls last,
  case when v_sort='name' then lower(coalesce(v.name_en,v.name_original)) end asc,
  v.id
 limit greatest(1,least(coalesce(p_limit,50),200)) offset greatest(0,least(coalesce(p_offset,0),100000));
end $$;

-- Counts over the published projects ("unknown" for no value). settings.auto_list_structured tells clients whether
-- the auto-collected Wikidata places (public_discovered_places) are to be listed.
create or replace function public.archive_public_stats() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with v as (select * from public.public_archive_projects)
 select jsonb_build_object(
  'total',(select count(*) from v),
  'by_region',(select coalesce(jsonb_object_agg(k,n),'{}') from (select coalesce(region,'unknown') k,count(*) n from v group by 1) x),
  'by_country',(select coalesce(jsonb_object_agg(k,n),'{}') from (select coalesce(country_iso2,'unknown') k,count(*) n from v group by 1) x),
  'by_year',(select coalesce(jsonb_object_agg(k,n),'{}') from (select coalesce(coalesce(year_installed,year_completed,year_operating_since)::text,'unknown') k,count(*) n from v group by 1) x),
  'by_project_type',(select coalesce(jsonb_object_agg(k,n),'{}') from (select coalesce(project_type,'unknown') k,count(*) n from v group by 1) x),
  'by_installation_method',(select coalesce(jsonb_object_agg(k,n),'{}') from (select coalesce(installation_method,'unknown') k,count(*) n from v group by 1) x),
  'by_technology',(select coalesce(jsonb_object_agg(k,n),'{}') from (select coalesce(t,'unknown') k,count(*) n from v left join lateral unnest(nullif(v.technology,'{}')) t on true group by 1) x),
  'by_review_status',(select coalesce(jsonb_object_agg(k,n),'{}') from (select review_status k,count(*) n from v group by 1) x),
  'settings',(select jsonb_build_object('auto_list_structured',s.auto_list_structured) from public.archive_settings s where s.id),
  'generated_at',now())
$$;

-- ---- admin API (authenticated; each checks archive_role(); editor+ = admin or editor) --------------------------
create or replace function public.archive_admin_dashboard() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.archive_require(array['admin','editor']);
 return jsonb_build_object(
  'queue',(select coalesce(jsonb_object_agg(status,n),'{}') from (select status,count(*) n from public.archive_candidates group by status) x),
  'runs_24h',(select jsonb_build_object('total',count(*),'running',count(*) filter(where status='running'),'success',count(*) filter(where status='success'),
     'partial',count(*) filter(where status='partial'),'error',count(*) filter(where status='error'),'skipped',count(*) filter(where status='skipped'),
     'new_candidates',coalesce(sum(new_candidates),0),'matched_projects',coalesce(sum(matched_projects),0))
    from public.archive_runs where started_at>now()-interval '24 hours'),
  'runs_7d',(select jsonb_build_object('total',count(*),'running',count(*) filter(where status='running'),'success',count(*) filter(where status='success'),
     'partial',count(*) filter(where status='partial'),'error',count(*) filter(where status='error'),'skipped',count(*) filter(where status='skipped'),
     'new_candidates',coalesce(sum(new_candidates),0),'matched_projects',coalesce(sum(matched_projects),0))
    from public.archive_runs where started_at>now()-interval '7 days'),
  'errors_24h',(select count(*) from public.archive_run_errors where at>now()-interval '24 hours'),
  'errors_7d',(select count(*) from public.archive_run_errors where at>now()-interval '7 days'),
  'rules',(select jsonb_build_object('total',count(*),'enabled',count(*) filter(where enabled),'failing',count(*) filter(where failure_count>0),
     'backing_off',count(*) filter(where backoff_until>now()),'unverified',count(*) filter(where verified_at is null)) from public.archive_collection_rules),
  'rules_by_status',(select coalesce(jsonb_object_agg(k,n),'{}') from (select coalesce(last_status,'never_run') k,count(*) n from public.archive_collection_rules group by 1) x),
  'sources_by_link_state',(select coalesce(jsonb_object_agg(link_state,n),'{}') from (select link_state,count(*) n from public.archive_sources group by 1) x),
  'projects_by_visibility',(select coalesce(jsonb_object_agg(visibility,n),'{}') from (select visibility,count(*) n from public.archive_projects where merged_into is null group by 1) x),
  'projects_by_review',(select coalesce(jsonb_object_agg(review_status,n),'{}') from (select review_status,count(*) n from public.archive_projects where merged_into is null group by 1) x),
  'open_updates',(select coalesce(jsonb_object_agg(kind,n),'{}') from (select kind,count(*) n from public.archive_project_updates where status='open' group by 1) x),
  'broken_links',jsonb_build_object('sources',(select count(*) from public.archive_sources where link_state='broken'),
     'media',(select count(*) from public.archive_media where link_state='broken'),
     'official_urls',(select count(*) from public.archive_projects where official_url_state='broken' and merged_into is null)),
  'websub',(select coalesce(jsonb_object_agg(state,n),'{}') from (select state,count(*) n from public.archive_websub_subscriptions group by 1) x),
  'settings',(select to_jsonb(s)-'id' from public.archive_settings s where s.id),
  'generated_at',now());
end $$;

-- p_status: a candidate status, 'open' (default: needs_review and uncertain) or 'all'.
create or replace function public.archive_admin_list_candidates(p_status text default null,p_q text default null,p_min_conf integer default null,p_limit integer default 50,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare v_q text:=nullif(btrim(p_q),''); v_status text:=coalesce(nullif(p_status,''),'open');
begin
 perform public.archive_require(array['admin','editor']);
 if v_status not in ('open','all','needs_review','uncertain','auto_ignored','approved','merged','rejected','duplicate') then raise exception 'unknown status %',v_status using errcode='22023'; end if;
 return query
 select to_jsonb(c)||jsonb_build_object(
  'total_seen',c.seen_count+coalesce((select sum(d.seen_count) from public.archive_candidates d where d.duplicate_of=c.id),0),
  'hits',(select coalesce(jsonb_agg(to_jsonb(h)-'raw' order by h.fetched_at desc,h.id),'[]') from public.archive_candidate_hits h
          where h.candidate_id=c.id or h.candidate_id in (select d.id from public.archive_candidates d where d.duplicate_of=c.id)),
  'suggested_matches',(select coalesce(jsonb_agg(m.j order by m.sim desc),'[]') from (
    select jsonb_build_object('project_id',p.id,'slug',p.slug,'name',coalesce(p.name_en,p.name_original),'name_original',p.name_original,'country_iso2',p.country_iso2,
      'city',p.city,'visibility',p.visibility,'similarity',round(s.sim::numeric,3),'reason',s.reason) j,s.sim
    from public.archive_projects p
    cross join lateral (select case when p.wikidata_qid=c.wikidata_qid then 1.0::real else
       (select max(similarity(lower(n),lower(c.detected_name))) from unnest(array[p.name_original,p.name_en,p.name_ko]||p.aliases) n) end sim,
      case when p.wikidata_qid=c.wikidata_qid then 'wikidata_qid' else 'name' end reason) s
    where p.merged_into is null and (p.wikidata_qid=c.wikidata_qid or (c.detected_name is not null
      and (public.archive_name_text(p.name_original,p.name_en,p.name_ko,p.aliases) % lower(c.detected_name)
           or lower(c.detected_name) <% public.archive_name_text(p.name_original,p.name_en,p.name_ko,p.aliases))))
    order by s.sim desc nulls last limit 3) m where m.sim>=0.3)
 )
 from public.archive_candidates c
 where (case v_status when 'open' then c.status in ('needs_review','uncertain') when 'all' then true else c.status=v_status end)
  and (p_min_conf is null or c.confidence>=p_min_conf)
  and (v_q is null or c.detected_name ilike public.archive_like(v_q)
       or exists(select 1 from public.archive_candidate_hits h where h.candidate_id=c.id and h.title ilike public.archive_like(v_q)))
 order by c.confidence desc,c.last_seen_at desc,c.id
 limit greatest(1,least(coalesce(p_limit,50),200)) offset greatest(0,coalesce(p_offset,0));
end $$;

-- Actions and payloads:
--   approve_new {project fields…, publish?, reported?, supports?, credits?, note?}: needs a name, a country and at
--     least one hit; the project is editor-reviewed and its sources are the candidate's hits.
--   attach {project_id, supports?, note?}   merge {into_candidate_id, note?}   reject {note} (required)
--   ignore {note?}   reopen {}
create or replace function public.archive_admin_review_candidate(p_id uuid,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_pay jsonb:=coalesce(p_payload,'{}'); c public.archive_candidates; v_before jsonb; v_note text; v_pid uuid; v_src uuid; v_t public.archive_candidates;
 v_fields jsonb; v_rep jsonb; v_wd boolean; v_sup text[]; v_dup uuid; st public.archive_settings;
begin
 perform public.archive_require(array['admin','editor']);
 if jsonb_typeof(v_pay)<>'object' then raise exception 'p_payload must be a JSON object' using errcode='22023'; end if;
 select * into c from public.archive_candidates where id=p_id for update;
 if not found then raise exception 'unknown candidate %',p_id using errcode='22023'; end if;
 v_before:=to_jsonb(c);
 v_note:=nullif(btrim(v_pay->>'note'),'');
 if length(v_note)>2000 then raise exception 'note is longer than 2000 characters' using errcode='22023'; end if;
 if p_action in ('approve_new','attach','merge','reject','ignore') and c.status not in ('needs_review','uncertain','auto_ignored') then
  raise exception 'candidate is % (reopen it first)',c.status using errcode='22023';
 end if;
 v_sup:=coalesce(public.archive_jarr(v_pay->'supports'),'{}');
 if exists(select 1 from unnest(v_sup) x where not x=any(public.archive_project_fields())) then raise exception 'supports names an unknown field' using errcode='22023'; end if;
 if p_action='approve_new' then
  if not exists(select 1 from public.archive_candidate_hits h where h.candidate_id=c.id or h.candidate_id in (select d.id from public.archive_candidates d where d.duplicate_of=c.id)) then
   raise exception 'approve_new needs at least one source' using errcode='22023';
  end if;
  v_fields:=v_pay-array['publish','note','supports','reported'];
  v_rep:=coalesce(v_pay->'reported','{}');
  -- What a Wikidata item states and the editor did not restate is stored as source-reported; a news item's location
  -- is only a gazetteer guess and is not carried over.
  v_wd:=c.wikidata_qid is not null and exists(select 1 from public.archive_candidate_hits h where h.candidate_id=c.id and h.provider='wikidata');
  if v_wd then
   v_rep:=jsonb_strip_nulls(jsonb_build_object('wikidata_qid',c.wikidata_qid,'name_original',c.detected_name,'country_iso2',c.detected_country_iso2,
    'city',c.detected_city,'latitude',c.latitude,'longitude',c.longitude))||v_rep;
  end if;
  if nullif(btrim(coalesce(v_fields->>'name_original',v_fields->>'name_en',v_fields->>'name_ko',v_rep->>'name_original')),'') is null then
   raise exception 'approve_new needs a name' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(v_fields->>'country_iso2',v_rep->>'country_iso2')),'') is null then raise exception 'approve_new needs a country' using errcode='22023'; end if;
  select p.id into v_pid from public.archive_projects p where p.wikidata_qid=coalesce(v_fields->>'wikidata_qid',v_rep->>'wikidata_qid');
  if v_pid is not null then raise exception 'wikidata_qid already belongs to project % (attach instead)',v_pid using errcode='22023'; end if;
  v_pid:=public.archive_apply_project(null,v_fields||jsonb_build_object('reviewed',true,'visibility',case when coalesce((v_pay->>'publish')::boolean,false) then 'published' else 'draft' end),
   v_rep,null,'auto_collected');
  v_src:=public.archive_sources_from_candidate(c.id,v_pid,v_sup);
  update public.archive_projects p set first_collected_at=c.first_seen_at,last_collected_at=c.last_seen_at,
   field_status=(select coalesce(jsonb_object_agg(e.k,case when e.v->>'state'='source_reported' and not e.v ? 'source_id' then e.v||jsonb_build_object('source_id',v_src) else e.v end),'{}')
                 from jsonb_each(p.field_status) e(k,v))
  where p.id=v_pid;
  update public.archive_credits set source_id=v_src where project_id=v_pid and source_id is null and not v_fields ? 'credits';
  perform public.archive_audit('project.create','archive_projects',v_pid::text,null,(select to_jsonb(p) from public.archive_projects p where p.id=v_pid));
  update public.archive_candidates set status='approved',matched_project_id=v_pid,reviewed_by=auth.uid(),reviewed_at=now(),review_note=v_note where id=c.id;
 elsif p_action='attach' then
  v_pid:=public.archive_project_target(case when v_pay->>'project_id' ~* '^[0-9a-f-]{36}$' then (v_pay->>'project_id')::uuid end);
  if v_pid is null then raise exception 'attach needs an existing project_id' using errcode='22023'; end if;
  perform public.archive_sources_from_candidate(c.id,v_pid,v_sup);
  update public.archive_projects set first_collected_at=least(coalesce(first_collected_at,c.first_seen_at),c.first_seen_at),
   last_collected_at=greatest(coalesce(last_collected_at,c.last_seen_at),c.last_seen_at) where id=v_pid;
  update public.archive_candidates set status='merged',matched_project_id=v_pid,reviewed_by=auth.uid(),reviewed_at=now(),review_note=v_note where id=c.id;
 elsif p_action='merge' then
  v_dup:=case when v_pay->>'into_candidate_id' ~* '^[0-9a-f-]{36}$' then (v_pay->>'into_candidate_id')::uuid end;
  select * into v_t from public.archive_candidates where id=v_dup for update;
  if not found or v_t.id=c.id then raise exception 'merge needs another candidate (into_candidate_id)' using errcode='22023'; end if;
  if v_t.status not in ('needs_review','uncertain') then raise exception 'the candidate to merge into is %',v_t.status using errcode='22023'; end if;
  -- Hits stay where they are; the target lists them through duplicate_of (so a reopen is lossless).
  update public.archive_candidates set duplicate_of=v_t.id where duplicate_of=c.id;
  update public.archive_candidates set status='duplicate',duplicate_of=v_t.id,reviewed_by=auth.uid(),reviewed_at=now(),review_note=v_note where id=c.id;
  update public.archive_candidates set first_seen_at=least(first_seen_at,c.first_seen_at),last_seen_at=greatest(last_seen_at,c.last_seen_at),
   score=greatest(score,c.score) where id=v_t.id;
  perform public.archive_refresh_candidate(v_t.id);
 elsif p_action='reject' then
  if v_note is null then raise exception 'reject needs a note' using errcode='22023'; end if;
  update public.archive_candidates set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),review_note=v_note where id=c.id;
 elsif p_action='ignore' then
  -- Editor-dismissed noise: kept 30 days like the automatic kind, then pruned.
  update public.archive_candidates set status='auto_ignored',reviewed_by=auth.uid(),reviewed_at=now(),review_note=v_note where id=c.id;
 elsif p_action='reopen' then
  if c.status in ('needs_review','uncertain') then raise exception 'candidate is already open' using errcode='22023'; end if;
  select * into st from public.archive_settings where id;
  update public.archive_candidates set status=case when score>=st.review_threshold then 'needs_review' else 'uncertain' end,
   duplicate_of=null,matched_project_id=null,reviewed_by=null,reviewed_at=null,review_note=null where id=c.id;
 else
  raise exception 'unknown action %',p_action using errcode='22023';
 end if;
 select * into c from public.archive_candidates where id=p_id;
 perform public.archive_audit('candidate.'||p_action,'archive_candidates',p_id::text,v_before,to_jsonb(c)||jsonb_build_object('payload',v_pay));
 return jsonb_build_object('ok',true,'action',p_action,'candidate_id',c.id,'status',c.status,'project_id',c.matched_project_id,'duplicate_of',c.duplicate_of);
end $$;

-- Creates (no id) or updates a project. Only the fields present are written; each becomes editor_verified, a field
-- sent as null or "" is cleared (unverified). "reviewed": true records an editor review; "reported" (with
-- "reported_source_id") stores values copied from a source as source_reported.
create or replace function public.archive_admin_upsert_project(p_project jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_before jsonb;
begin
 perform public.archive_require(array['admin','editor']);
 if jsonb_typeof(p_project) is distinct from 'object' then raise exception 'p_project must be a JSON object' using errcode='22023'; end if;
 v_id:=nullif(p_project->>'id','')::uuid;
 if v_id is not null then
  select to_jsonb(p) into v_before from public.archive_projects p where p.id=v_id;
  if v_before is null then raise exception 'unknown project %',v_id using errcode='22023'; end if;
 end if;
 v_id:=public.archive_apply_project(v_id,p_project,p_project->'reported',nullif(p_project->>'reported_source_id','')::uuid,
  case when v_id is null and p_project->>'record_origin'='curated' then 'curated' else 'editor_created' end);
 perform public.archive_audit(case when v_before is null then 'project.create' else 'project.update' end,'archive_projects',v_id::text,v_before,
  (select to_jsonb(p) from public.archive_projects p where p.id=v_id));
 return v_id;
end $$;

create or replace function public.archive_admin_set_visibility(p_project_id uuid,p_visibility text,p_note text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_p public.archive_projects;
begin
 perform public.archive_require(array['admin','editor']);
 if p_visibility is null or p_visibility not in ('draft','published','hidden') then raise exception 'unknown visibility %',p_visibility using errcode='22023'; end if;
 if length(p_note)>2000 then raise exception 'note is longer than 2000 characters' using errcode='22023'; end if;
 select * into v_p from public.archive_projects where id=p_project_id for update;
 if not found then raise exception 'unknown project %',p_project_id using errcode='22023'; end if;
 if p_visibility<>'hidden' and v_p.merged_into is not null then raise exception 'project was merged into %',v_p.merged_into using errcode='22023'; end if;
 if p_visibility='published' and v_p.last_verified_at is null then raise exception 'publishing needs an editor review first ("reviewed": true)' using errcode='22023'; end if;
 update public.archive_projects set visibility=p_visibility,updated_by=auth.uid() where id=p_project_id and visibility<>p_visibility;
 perform public.archive_audit('project.set_visibility','archive_projects',p_project_id::text,jsonb_build_object('visibility',v_p.visibility),
  jsonb_build_object('visibility',p_visibility,'note',nullif(btrim(p_note),'')));
 return jsonb_build_object('id',p_project_id,'visibility',p_visibility,'previous',v_p.visibility);
end $$;

-- Moves sources, credits, media, assessments, hits and open updates of p_drop to p_keep; p_drop's names become
-- p_keep's aliases and it is hidden with merged_into = p_keep. Identifiers p_keep lacks (QID, curated id) move too.
create or replace function public.archive_admin_merge_projects(p_keep uuid,p_drop uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare k public.archive_projects; d public.archive_projects; u record; v_fs jsonb; v_now timestamptz:=now();
begin
 perform public.archive_require(array['admin','editor']);
 if p_keep is null or p_drop is null or p_keep=p_drop then raise exception 'merge needs two different projects' using errcode='22023'; end if;
 select * into k from public.archive_projects where id=p_keep for update;
 select * into d from public.archive_projects where id=p_drop for update;
 if k.id is null or d.id is null then raise exception 'unknown project' using errcode='22023'; end if;
 if k.merged_into is not null or d.merged_into is not null then raise exception 'project was already merged' using errcode='22023'; end if;
 insert into public.archive_project_sources as ps(project_id,source_id,supports,added_at,added_by)
 select p_keep,source_id,supports,added_at,added_by from public.archive_project_sources where project_id=p_drop
 on conflict(project_id,source_id) do update set supports=public.archive_union(ps.supports,excluded.supports);
 delete from public.archive_project_sources where project_id=p_drop;
 insert into public.archive_credits(project_id,role,name,name_en,wikidata_qid,source_id)
 select p_keep,role,name,name_en,wikidata_qid,source_id from public.archive_credits where project_id=p_drop on conflict(project_id,role,name) do nothing;
 delete from public.archive_credits where project_id=p_drop;
 update public.archive_media m set project_id=p_keep,is_primary=m.is_primary and not exists(select 1 from public.archive_media x where x.project_id=p_keep and x.is_primary)
 where m.project_id=p_drop and not exists(select 1 from public.archive_media x where x.project_id=p_keep and x.url=m.url);
 delete from public.archive_media where project_id=p_drop;
 update public.archive_assessments set project_id=p_keep where project_id=p_drop;
 update public.archive_candidate_hits set project_id=p_keep where project_id=p_drop;
 update public.archive_candidates set matched_project_id=p_keep where matched_project_id=p_drop;
 update public.archive_projects set merged_into=p_keep where merged_into=p_drop;
 for u in select * from public.archive_project_updates where project_id=p_drop and status='open' loop
  perform public.archive_record_project_update(p_keep,u.kind,u.detail-'count');
 end loop;
 delete from public.archive_project_updates where project_id=p_drop and status='open';
 update public.archive_project_updates set project_id=p_keep where project_id=p_drop;
 v_fs:=k.field_status||jsonb_build_object('aliases',jsonb_build_object('state','editor_verified','at',v_now));
 if k.wikidata_qid is null and d.wikidata_qid is not null then v_fs:=(v_fs-'wikidata_qid')||jsonb_strip_nulls(jsonb_build_object('wikidata_qid',d.field_status->'wikidata_qid')); end if;
 if k.curated_place_id is null and d.curated_place_id is not null then v_fs:=(v_fs-'curated_place_id')||jsonb_strip_nulls(jsonb_build_object('curated_place_id',d.field_status->'curated_place_id')); end if;
 update public.archive_projects set visibility='hidden',merged_into=p_keep,
  wikidata_qid=case when k.wikidata_qid is null then null else wikidata_qid end,
  curated_place_id=case when k.curated_place_id is null then null else curated_place_id end,updated_by=auth.uid()
 where id=p_drop;
 update public.archive_projects set
  aliases=(select coalesce(array_agg(distinct n order by n),'{}') from unnest(k.aliases||array[d.name_original,d.name_en,d.name_ko]||d.aliases) n
           where nullif(btrim(n),'') is not null and lower(n) not in (select lower(x) from unnest(array_remove(array[k.name_original,k.name_en,k.name_ko],null)) x)),
  wikidata_qid=coalesce(k.wikidata_qid,d.wikidata_qid),curated_place_id=coalesce(k.curated_place_id,d.curated_place_id),discovered_qid=coalesce(k.discovered_qid,d.discovered_qid),
  first_collected_at=least(k.first_collected_at,d.first_collected_at),last_collected_at=greatest(k.last_collected_at,d.last_collected_at),
  field_status=v_fs,updated_by=auth.uid()
 where id=p_keep;
 perform public.archive_refresh_update_status(p_keep);
 perform public.archive_audit('project.merge','archive_projects',p_keep::text,jsonb_build_object('keep',to_jsonb(k),'drop',to_jsonb(d)),
  (select to_jsonb(p) from public.archive_projects p where p.id=p_keep));
 return p_keep;
end $$;

-- p_source: {url, canonical_url?, title?, publisher?, source_kind (or kind), language?, published_at?, license?,
-- excerpt?, reliability?}; p_supports: the fields it states. An unverified or derived field with a value that the
-- source supports becomes source_reported.
create or replace function public.archive_admin_add_source(p_project_id uuid,p_source jsonb,p_supports text[] default '{}') returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_pid uuid; s jsonb:=p_source; v_sid uuid; v_k text; v_sup text[]:=coalesce(p_supports,'{}'); v_row jsonb; v_fs jsonb; v_kind text; v_now timestamptz:=now();
begin
 perform public.archive_require(array['admin','editor']);
 v_pid:=public.archive_project_target(p_project_id);
 if v_pid is null then raise exception 'unknown project %',p_project_id using errcode='22023'; end if;
 if jsonb_typeof(s) is distinct from 'object' then raise exception 'p_source must be a JSON object' using errcode='22023'; end if;
 for v_k in select jsonb_object_keys(s) loop
  if v_k not in ('url','canonical_url','title','publisher','source_kind','kind','language','published_at','license','excerpt','reliability') then
   raise exception 'unknown source field: %',v_k using errcode='22023';
  end if;
 end loop;
 if exists(select 1 from unnest(v_sup) x where not x=any(public.archive_project_fields())) then raise exception 'supports names an unknown field' using errcode='22023'; end if;
 v_kind:=coalesce(s->>'source_kind',s->>'kind');
 insert into public.archive_sources as x(url,canonical_url,title,publisher,source_kind,language,published_at,license,excerpt,reliability)
 values(btrim(s->>'url'),coalesce(nullif(btrim(s->>'canonical_url'),''),btrim(s->>'url')),nullif(btrim(s->>'title'),''),nullif(btrim(s->>'publisher'),''),v_kind,
  nullif(btrim(s->>'language'),''),nullif(s->>'published_at','')::timestamptz,nullif(btrim(s->>'license'),''),nullif(btrim(s->>'excerpt'),''),
  coalesce(round(nullif(s->>'reliability','')::numeric),public.archive_base_reliability(v_kind)))
 on conflict(canonical_url) do update set title=coalesce(excluded.title,x.title),publisher=coalesce(excluded.publisher,x.publisher),
  license=coalesce(excluded.license,x.license),published_at=coalesce(x.published_at,excluded.published_at)
 returning x.id into v_sid;
 insert into public.archive_project_sources as ps(project_id,source_id,supports,added_by) values(v_pid,v_sid,public.archive_union(v_sup,'{}'),auth.uid())
 on conflict(project_id,source_id) do update set supports=public.archive_union(ps.supports,excluded.supports);
 select to_jsonb(p),p.field_status into v_row,v_fs from public.archive_projects p where p.id=v_pid for update;
 foreach v_k in array v_sup loop
  continue when v_k='credits' and not exists(select 1 from public.archive_credits where project_id=v_pid);
  continue when v_k<>'credits' and (v_row->v_k is null or v_row->v_k in ('null'::jsonb,'[]'::jsonb));
  if v_fs->v_k is null or v_fs#>>array[v_k,'state'] in ('unverified','derived') then
   v_fs:=v_fs||jsonb_build_object(v_k,jsonb_build_object('state','source_reported','source_id',v_sid,'at',v_now));
  elsif not (v_fs->v_k) ? 'source_id' then v_fs:=jsonb_set(v_fs,array[v_k,'source_id'],to_jsonb(v_sid));
  end if;
 end loop;
 update public.archive_projects set field_status=v_fs,updated_by=auth.uid() where id=v_pid and field_status is distinct from v_fs;
 perform public.archive_audit('project.add_source','archive_projects',v_pid::text,null,jsonb_build_object('source_id',v_sid,'supports',v_sup));
 return v_sid;
end $$;

-- Unlinks a source from a project (admin console, contract change). A field that cited it moves to another linked
-- source that supports it; otherwise a source-reported field loses its state (unverified again) and any other state
-- only loses the pointer. Credits citing it lose the pointer. The archive_sources row stays while another project or
-- an image still refers to it, so link checks stop for a URL nobody uses. False when the link did not exist.
create or replace function public.archive_admin_remove_source(p_project_id uuid,p_source_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_pid uuid; v_link public.archive_project_sources; v_fs jsonb; v_out jsonb:='{}'; v_k text; v_v jsonb; v_alt uuid; v_deleted boolean:=false;
begin
 perform public.archive_require(array['admin','editor']);
 v_pid:=public.archive_project_target(p_project_id);
 if v_pid is null then raise exception 'unknown project %',p_project_id using errcode='22023'; end if;
 select field_status into v_fs from public.archive_projects where id=v_pid for update;
 delete from public.archive_project_sources ps where ps.project_id=v_pid and ps.source_id=p_source_id returning * into v_link;
 if v_link.source_id is null then return false; end if;
 for v_k,v_v in select key,value from jsonb_each(v_fs) loop
  if v_v->>'source_id'=p_source_id::text then
   select ps.source_id into v_alt from public.archive_project_sources ps where ps.project_id=v_pid and v_k=any(ps.supports) order by ps.added_at,ps.source_id limit 1;
   if v_alt is not null then v_v:=jsonb_set(v_v,'{source_id}',to_jsonb(v_alt));
   elsif v_v->>'state'='source_reported' then continue;
   else v_v:=v_v-'source_id';
   end if;
  end if;
  v_out:=v_out||jsonb_build_object(v_k,v_v);
 end loop;
 update public.archive_projects set field_status=v_out,updated_by=auth.uid() where id=v_pid and field_status is distinct from v_out;
 update public.archive_credits set source_id=null where project_id=v_pid and source_id=p_source_id;
 if not exists(select 1 from public.archive_project_sources where source_id=p_source_id) and not exists(select 1 from public.archive_media where source_id=p_source_id) then
  delete from public.archive_sources where id=p_source_id; v_deleted:=true;
 end if;
 perform public.archive_audit('project.remove_source','archive_projects',v_pid::text,
  jsonb_build_object('source_id',p_source_id,'supports',v_link.supports,'field_status',v_fs),
  jsonb_build_object('source_id',p_source_id,'source_deleted',v_deleted,'field_status',v_out));
 return true;
end $$;

-- p_media: {id?, url, page_url?, commons_file?, license?, license_url?, author?, attribution?, rights_status?,
-- is_primary?, source_id?}; matched by id, else by (project, url). A new URL is unchecked again.
create or replace function public.archive_admin_set_media(p_project_id uuid,p_media jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_pid uuid; v_id uuid; v_k text; v_old public.archive_media; v_new public.archive_media; v_before jsonb; v_m jsonb;
begin
 perform public.archive_require(array['admin','editor']);
 v_pid:=public.archive_project_target(p_project_id);
 if v_pid is null then raise exception 'unknown project %',p_project_id using errcode='22023'; end if;
 if jsonb_typeof(p_media) is distinct from 'object' then raise exception 'p_media must be a JSON object' using errcode='22023'; end if;
 for v_k in select jsonb_object_keys(p_media) loop
  if v_k not in ('id','url','page_url','commons_file','license','license_url','author','attribution','rights_status','is_primary','source_id',
                 'project_id','link_state','last_checked_at','consecutive_failures','http_status','created_at','updated_at') then
   raise exception 'unknown media field: %',v_k using errcode='22023';
  end if;
 end loop;
 select coalesce(jsonb_object_agg(key,public.archive_jclean(value)),'{}') into v_m from jsonb_each(p_media)
 where key in ('url','page_url','commons_file','license','license_url','author','attribution','rights_status','is_primary','source_id');
 v_id:=nullif(p_media->>'id','')::uuid;
 if v_id is null then select id into v_id from public.archive_media where project_id=v_pid and url=btrim(p_media->>'url'); end if;
 if coalesce((v_m->>'is_primary')::boolean,false) then
  update public.archive_media set is_primary=false where project_id=v_pid and is_primary and id is distinct from v_id;
 end if;
 if v_id is null then
  insert into public.archive_media(project_id,url) values(v_pid,v_m->>'url') returning * into v_old;
 else
  select * into v_old from public.archive_media where id=v_id and project_id=v_pid for update;
  if not found then raise exception 'unknown media %',v_id using errcode='22023'; end if;
  v_before:=to_jsonb(v_old);
 end if;
 v_new:=jsonb_populate_record(v_old,v_m);
 if v_new.url is distinct from v_old.url then v_new.link_state:='unknown'; v_new.consecutive_failures:=0; v_new.last_checked_at:=null; v_new.http_status:=null; end if;
 update public.archive_media set url=v_new.url,page_url=v_new.page_url,commons_file=v_new.commons_file,license=v_new.license,license_url=v_new.license_url,
  author=v_new.author,attribution=v_new.attribution,rights_status=coalesce(v_new.rights_status,'pending'),is_primary=coalesce(v_new.is_primary,false),
  source_id=v_new.source_id,link_state=v_new.link_state,consecutive_failures=v_new.consecutive_failures,last_checked_at=v_new.last_checked_at,http_status=v_new.http_status
 where id=v_old.id;
 perform public.archive_audit(case when v_before is null then 'media.create' else 'media.update' end,'archive_media',v_old.id::text,v_before,
  (select to_jsonb(m) from public.archive_media m where m.id=v_old.id));
 return v_old.id;
end $$;

create or replace function public.archive_admin_remove_media(p_media_id uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before jsonb;
begin
 perform public.archive_require(array['admin','editor']);
 delete from public.archive_media m where m.id=p_media_id returning to_jsonb(m) into v_before;
 if v_before is null then return false; end if;
 perform public.archive_audit('media.remove','archive_media',p_media_id::text,v_before,null);
 return true;
end $$;

-- Projects with their credits, sources, all media (with rights and link state) and assessments (with assessor).
-- p_visibility null lists every project except those merged away; 'hidden' includes them.
create or replace function public.archive_admin_list_projects(p_q text default null,p_visibility text default null,p_limit integer default 50,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_q text:=nullif(btrim(p_q),'');
begin
 perform public.archive_require(array['admin','editor']);
 if p_visibility is not null and p_visibility not in ('draft','published','hidden') then raise exception 'unknown visibility %',p_visibility using errcode='22023'; end if;
 return query
 select to_jsonb(p)||jsonb_build_object(
  'credits',(select coalesce(jsonb_agg(to_jsonb(c) order by c.role,c.name),'[]') from public.archive_credits c where c.project_id=p.id),
  'sources',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('supports',ps.supports,'added_at',ps.added_at) order by s.reliability desc nulls last,s.id),'[]')
             from public.archive_project_sources ps join public.archive_sources s on s.id=ps.source_id where ps.project_id=p.id),
  'media',(select coalesce(jsonb_agg(to_jsonb(m) order by m.is_primary desc,m.created_at),'[]') from public.archive_media m where m.project_id=p.id),
  'assessments',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at),'[]') from public.archive_assessments a where a.project_id=p.id),
  'open_updates',(select count(*) from public.archive_project_updates u where u.project_id=p.id and u.status='open'),
  'candidates',(select count(*) from public.archive_candidates c where c.matched_project_id=p.id))
 from public.archive_projects p
 where (case when p_visibility is null then p.merged_into is null else p.visibility=p_visibility end)
  and (v_q is null or p.id::text=v_q or p.slug=lower(v_q) or public.archive_name_text(p.name_original,p.name_en,p.name_ko,p.aliases) like public.archive_like(lower(v_q))
       or lower(concat_ws(' ',p.city,p.building_name)) like public.archive_like(lower(v_q)))
 order by p.updated_at desc,p.id
 limit greatest(1,least(coalesce(p_limit,50),200)) offset greatest(0,coalesce(p_offset,0));
end $$;

-- p_status: 'open' (default), 'applied', 'dismissed' or 'all'.
create or replace function public.archive_admin_list_updates(p_status text default 'open',p_limit integer default 50) returns setof jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_status text:=coalesce(nullif(p_status,''),'open');
begin
 perform public.archive_require(array['admin','editor']);
 if v_status not in ('open','applied','dismissed','all') then raise exception 'unknown status %',v_status using errcode='22023'; end if;
 return query
 select to_jsonb(u)||jsonb_build_object('project_name',coalesce(p.name_en,p.name_original),'project_slug',p.slug,'project_visibility',p.visibility)
 from public.archive_project_updates u join public.archive_projects p on p.id=u.project_id
 where v_status='all' or u.status=v_status
 order by u.updated_at desc,u.id
 limit greatest(1,least(coalesce(p_limit,50),500));
end $$;

-- 'apply' on new_source adds the listed hits as sources of the project; 'dismiss' only closes the update.
create or replace function public.archive_admin_resolve_update(p_id uuid,p_action text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare u public.archive_project_updates; h jsonb;
begin
 perform public.archive_require(array['admin','editor']);
 if p_action is null or p_action not in ('apply','dismiss') then raise exception 'unknown action %',p_action using errcode='22023'; end if;
 select * into u from public.archive_project_updates where id=p_id for update;
 if not found then raise exception 'unknown update %',p_id using errcode='22023'; end if;
 if u.status<>'open' then raise exception 'update is already %',u.status using errcode='22023'; end if;
 if p_action='apply' and u.kind='new_source' and jsonb_typeof(u.detail->'hits')='array' then
  for h in select value from jsonb_array_elements(u.detail->'hits') loop
   if h->>'hit_id' ~* '^[0-9a-f-]{36}$' then perform public.archive_source_from_hit((h->>'hit_id')::uuid,u.project_id,'{}'); end if;
  end loop;
 end if;
 update public.archive_project_updates set status=case when p_action='apply' then 'applied' else 'dismissed' end,resolved_by=auth.uid(),resolved_at=now() where id=p_id;
 perform public.archive_refresh_update_status(u.project_id);
 perform public.archive_audit('update.'||p_action,'archive_project_updates',p_id::text,to_jsonb(u),(select to_jsonb(x) from public.archive_project_updates x where x.id=p_id));
 return jsonb_build_object('id',p_id,'project_id',u.project_id,'status',case when p_action='apply' then 'applied' else 'dismissed' end);
end $$;

create or replace function public.archive_admin_list_runs(p_limit integer default 50,p_rule_id uuid default null) returns setof jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.archive_require(array['admin','editor']);
 return query
 select to_jsonb(r)||jsonb_build_object('rule_name',x.name,'rule_kind',x.kind)
 from public.archive_runs r left join public.archive_collection_rules x on x.id=r.rule_id
 where p_rule_id is null or r.rule_id=p_rule_id
 order by r.started_at desc,r.id
 limit greatest(1,least(coalesce(p_limit,50),500));
end $$;

create or replace function public.archive_admin_list_errors(p_limit integer default 100) returns setof jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.archive_require(array['admin','editor']);
 return query
 select to_jsonb(e)||jsonb_build_object('rule_name',x.name,'rule_kind',x.kind)
 from public.archive_run_errors e left join public.archive_collection_rules x on x.id=e.rule_id
 order by e.at desc,e.id
 limit greatest(1,least(coalesce(p_limit,100),1000));
end $$;

-- Rules with their WebSub subscription state (never its secret).
create or replace function public.archive_admin_list_rules() returns setof jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.archive_require(array['admin','editor']);
 return query
 select to_jsonb(r)||jsonb_build_object('websub',(select jsonb_build_object('topic',w.topic,'hub',w.hub,'state',w.state,'lease_expires_at',w.lease_expires_at,'last_push_at',w.last_push_at)
   from public.archive_websub_subscriptions w where w.rule_id=r.id order by w.updated_at desc limit 1))
 from public.archive_collection_rules r order by r.kind,r.name;
end $$;

-- p_rule: {id?, kind, name, query?, url?, language?, region_hint?, enabled?, cadence_hours?, terms_url?, verified?
-- (true stamps verified_at, false clears it), notes?, next_run_at?}. Without an id the (kind, name) pair is the key.
-- A new keyed or metered rule (naver_*, brave) starts disabled unless "enabled" is given; changing the source or
-- re-enabling a rule clears its backoff.
create or replace function public.archive_admin_upsert_rule(p_rule jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_k text; v_old public.archive_collection_rules; v_new public.archive_collection_rules; v_before jsonb; v_r jsonb;
begin
 perform public.archive_require(array['admin']);
 if jsonb_typeof(p_rule) is distinct from 'object' then raise exception 'p_rule must be a JSON object' using errcode='22023'; end if;
 for v_k in select jsonb_object_keys(p_rule) loop
  if v_k not in ('id','kind','name','query','url','language','region_hint','enabled','cadence_hours','terms_url','verified','notes','next_run_at',
                 'verified_at','last_run_at','last_status','failure_count','backoff_until','etag','last_modified','claimed_by','claimed_at','created_at','updated_at','websub') then
   raise exception 'unknown rule field: %',v_k using errcode='22023';
  end if;
 end loop;
 select coalesce(jsonb_object_agg(key,public.archive_jclean(value)),'{}') into v_r from jsonb_each(p_rule)
 where key in ('kind','name','query','url','language','region_hint','enabled','cadence_hours','terms_url','notes','next_run_at');
 v_id:=nullif(p_rule->>'id','')::uuid;
 if v_id is null then select id into v_id from public.archive_collection_rules where kind=v_r->>'kind' and name=v_r->>'name'; end if;
 if v_id is null then
  if v_r->>'kind' is null or v_r->>'name' is null then raise exception 'a new rule needs kind and name' using errcode='22023'; end if;
  insert into public.archive_collection_rules(kind,name,enabled) values(v_r->>'kind',v_r->>'name',coalesce((v_r->>'enabled')::boolean,v_r->>'kind' not in ('naver_news','naver_blog','brave')))
  returning * into v_old;
 else
  select * into v_old from public.archive_collection_rules where id=v_id for update;
  if not found then raise exception 'unknown rule %',v_id using errcode='22023'; end if;
  v_before:=to_jsonb(v_old);
 end if;
 v_new:=jsonb_populate_record(v_old,v_r);
 v_new.enabled:=coalesce(v_new.enabled,v_old.enabled); v_new.cadence_hours:=coalesce(v_new.cadence_hours,v_old.cadence_hours);
 if p_rule ? 'verified' then v_new.verified_at:=case when coalesce((p_rule->>'verified')::boolean,false) then now() end; end if;
 if v_new.kind in ('rss','websub') and v_new.url is null then raise exception '% rules need a url',v_new.kind using errcode='22023'; end if;
 if v_new.kind in ('gdelt','naver_news','naver_blog','brave') and v_new.query is null then raise exception '% rules need a query',v_new.kind using errcode='22023'; end if;
 if v_before is not null and (v_new.url is distinct from v_old.url or v_new.query is distinct from v_old.query or (v_new.enabled and not v_old.enabled)) then
  v_new.failure_count:=0; v_new.backoff_until:=null; v_new.etag:=null; v_new.last_modified:=null;
 end if;
 update public.archive_collection_rules set kind=v_new.kind,name=v_new.name,query=v_new.query,url=v_new.url,language=v_new.language,region_hint=v_new.region_hint,
  enabled=v_new.enabled,cadence_hours=v_new.cadence_hours,terms_url=v_new.terms_url,verified_at=v_new.verified_at,notes=v_new.notes,next_run_at=v_new.next_run_at,
  failure_count=v_new.failure_count,backoff_until=v_new.backoff_until,etag=v_new.etag,last_modified=v_new.last_modified
 where id=v_old.id;
 perform public.archive_audit(case when v_before is null then 'rule.create' else 'rule.update' end,'archive_collection_rules',v_old.id::text,v_before,
  (select to_jsonb(r) from public.archive_collection_rules r where r.id=v_old.id));
 return v_old.id;
end $$;

create or replace function public.archive_admin_list_keywords() returns setof jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.archive_require(array['admin','editor']);
 return query select to_jsonb(k) from public.archive_keywords k order by k.polarity,k.language,k.term;
end $$;

-- p_kw: {id?, term, language, polarity, weight?, enabled?}; without an id (term, language) is the key.
create or replace function public.archive_admin_upsert_keyword(p_kw jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_k text; v_before jsonb; v_old public.archive_keywords; v_new public.archive_keywords; v_w jsonb;
begin
 perform public.archive_require(array['admin']);
 if jsonb_typeof(p_kw) is distinct from 'object' then raise exception 'p_kw must be a JSON object' using errcode='22023'; end if;
 for v_k in select jsonb_object_keys(p_kw) loop
  if v_k not in ('id','term','language','polarity','weight','enabled','created_at','updated_at') then raise exception 'unknown keyword field: %',v_k using errcode='22023'; end if;
 end loop;
 select coalesce(jsonb_object_agg(key,public.archive_jclean(value)),'{}') into v_w from jsonb_each(p_kw) where key in ('term','language','polarity','weight','enabled');
 v_id:=nullif(p_kw->>'id','')::uuid;
 if v_id is null then select id into v_id from public.archive_keywords where term=v_w->>'term' and language=v_w->>'language'; end if;
 if v_id is null then
  insert into public.archive_keywords(term,language,polarity) values(v_w->>'term',v_w->>'language',v_w->>'polarity') returning * into v_old;
 else
  select * into v_old from public.archive_keywords where id=v_id for update;
  if not found then raise exception 'unknown keyword %',v_id using errcode='22023'; end if;
  v_before:=to_jsonb(v_old);
 end if;
 v_new:=jsonb_populate_record(v_old,v_w);
 update public.archive_keywords set term=v_new.term,language=v_new.language,polarity=v_new.polarity,weight=coalesce(v_new.weight,v_old.weight),enabled=coalesce(v_new.enabled,v_old.enabled)
 where id=v_old.id;
 perform public.archive_audit(case when v_before is null then 'keyword.create' else 'keyword.update' end,'archive_keywords',v_old.id::text,v_before,
  (select to_jsonb(k) from public.archive_keywords k where k.id=v_old.id));
 return v_old.id;
end $$;

-- Deletes the keyword keyed by (term, language) (admin console, contract change). Every keyword has a language, so
-- p_language is required. False when no such keyword exists. The seed (archive-seed.sql) would add a seeded term back.
create or replace function public.archive_admin_delete_keyword(p_term text,p_language text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before jsonb;
begin
 perform public.archive_require(array['admin']);
 if nullif(btrim(p_term),'') is null then raise exception 'p_term is required' using errcode='22023'; end if;
 if nullif(btrim(p_language),'') is null then raise exception 'p_language is required (keywords are keyed by term and language)' using errcode='22023'; end if;
 delete from public.archive_keywords k where k.term=btrim(p_term) and k.language=btrim(p_language) returning to_jsonb(k) into v_before;
 if v_before is null then return false; end if;
 perform public.archive_audit('keyword.delete','archive_keywords',v_before->>'id',v_before,null);
 return true;
end $$;

-- p_settings: any of auto_list_structured, auto_ignore_below, review_threshold. Returns the settings.
create or replace function public.archive_admin_set_settings(p_settings jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_k text; v_before jsonb; v_after jsonb;
begin
 perform public.archive_require(array['admin']);
 if jsonb_typeof(p_settings) is distinct from 'object' then raise exception 'p_settings must be a JSON object' using errcode='22023'; end if;
 for v_k in select jsonb_object_keys(p_settings) loop
  if v_k not in ('auto_list_structured','auto_ignore_below','review_threshold','updated_at','updated_by') then raise exception 'unknown setting: %',v_k using errcode='22023'; end if;
 end loop;
 select to_jsonb(s)-'id' into v_before from public.archive_settings s where s.id;
 update public.archive_settings set
  auto_list_structured=coalesce((p_settings->>'auto_list_structured')::boolean,auto_list_structured),
  auto_ignore_below=coalesce((p_settings->>'auto_ignore_below')::smallint,auto_ignore_below),
  review_threshold=coalesce((p_settings->>'review_threshold')::smallint,review_threshold),updated_by=auth.uid()
 where id returning to_jsonb(archive_settings)-'id' into v_after;
 perform public.archive_audit('settings.update','archive_settings','true',v_before,v_after);
 return v_after;
end $$;

-- Researcher judgements are stored apart from the collected values; the project becomes researcher_assessed and an
-- assessed field is marked so, but the assessment never overwrites the field.
create or replace function public.archive_research_add_assessment(p_project_id uuid,p_attribute text,p_value jsonb,p_confidence text,p_method text default null,p_note text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_pid uuid; v_id uuid;
begin
 perform public.archive_require(array['admin','editor','researcher']);
 v_pid:=public.archive_project_target(p_project_id);
 if v_pid is null then raise exception 'unknown project %',p_project_id using errcode='22023'; end if;
 if p_value is null then raise exception 'p_value is required' using errcode='22023'; end if;
 insert into public.archive_assessments(project_id,assessor,attribute,value,confidence,method,note)
 values(v_pid,auth.uid(),p_attribute,p_value,p_confidence,nullif(btrim(p_method),''),nullif(btrim(p_note),'')) returning id into v_id;
 update public.archive_projects set review_status='researcher_assessed',
  field_status=case when p_attribute=any(public.archive_project_fields()) then field_status||jsonb_build_object(p_attribute,jsonb_build_object('state','researcher_assessed','at',now())) else field_status end
 where id=v_pid;
 perform public.archive_audit('assessment.create','archive_assessments',v_id::text,null,(select to_jsonb(a) from public.archive_assessments a where a.id=v_id));
 return v_id;
end $$;

-- ---- service API (service_role only; the Edge Functions) -------------------------------------------------------
-- Due: enabled, next_run_at reached, not backing off, not already running (a claim older than 30 minutes is taken
-- as abandoned). WebSub rules are push-driven and never claimed. p_rule_ids ("지금 실행") claims those enabled
-- rules regardless of their schedule and backoff. Rows locked by a concurrent claim are skipped.
create or replace function public.archive_claim_due_rules(p_limit integer,p_owner text,p_rule_ids uuid[] default null)
returns setof public.archive_collection_rules language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if coalesce(length(p_owner),0) not between 1 and 100 then raise exception 'p_owner is required' using errcode='22023'; end if;
 return query
 update public.archive_collection_rules r set last_status='running',claimed_by=p_owner,claimed_at=now()
 where r.id in (
  select d.id from public.archive_collection_rules d
  where d.enabled and d.kind<>'websub'
   and not coalesce(d.last_status='running' and d.claimed_at>now()-interval '30 minutes',false)
   and (case when p_rule_ids is null then (d.next_run_at is null or d.next_run_at<=now()) and (d.backoff_until is null or d.backoff_until<=now())
        else d.id=any(p_rule_ids) end)
  order by d.next_run_at nulls first,d.last_run_at nulls first,d.id
  limit greatest(1,least(coalesce(p_limit,6),50))
  for update skip locked)
 returning r.*;
end $$;

create or replace function public.archive_start_run(p_rule_id uuid,p_trigger text) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id uuid; v_attempt int;
begin
 if p_trigger is null or p_trigger not in ('cron','admin','websub','probe') then raise exception 'unknown trigger %',p_trigger using errcode='22023'; end if;
 if p_rule_id is not null then
  select failure_count+1 into v_attempt from public.archive_collection_rules where id=p_rule_id;
  if not found then raise exception 'unknown rule %',p_rule_id using errcode='22023'; end if;
 end if;
 insert into public.archive_runs(rule_id,trigger,attempt) values(p_rule_id,p_trigger,least(coalesce(v_attempt,1),32767)) returning id into v_id;
 if p_trigger='websub' and p_rule_id is not null then update public.archive_websub_subscriptions set last_push_at=now() where rule_id=p_rule_id; end if;
 return v_id;
end $$;

-- Dedupe/match, first rule that hits wins (keys computed by the collector, §3):
--   1 same wikidata_qid   2 same canonical URL (official URL, a source, or another hit)   3 keys.alias_project_id
--   4 same normalized name, country and city   5 within 200 m and name similarity ≥ 0.45
--   6 an open candidate with the same story key, or a hit title with similarity ≥ 0.6, seen within 14 days.
-- Rules 3–6 are skipped for items below auto_ignore_below. A project match records the hit on the project's open
-- new_source update; a candidate match adds the hit to the candidate.
create or replace function public.archive_ingest(p_run_id uuid,p_items jsonb) returns jsonb language plpgsql security invoker set search_path=public,extensions,pg_temp as $$
declare st public.archive_settings; v_run public.archive_runs; it jsonb; v_prob text; v_out jsonb:='[]'; v_o jsonb; h record; t record;
 n_kept int:=0; n_new int:=0; n_match int:=0; n_dup int:=0; n_ign int:=0;
 v_prov text; v_curl text; v_title text; v_score smallint; v_rel smallint; v_status text; v_rule uuid; v_label text;
 v_qid text; v_alias uuid; v_norm text; v_story text; v_name text; v_cc text; v_city text; v_lat float8; v_lng float8; v_dlng float8;
 v_pid uuid; v_cid uuid; v_kind text; v_hit uuid;
begin
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'p_items must be a JSON array' using errcode='22023'; end if;
 if jsonb_array_length(p_items)>2000 then raise exception 'at most 2000 items per call' using errcode='22023'; end if;
 select * into st from public.archive_settings where id;
 if p_run_id is not null then
  select * into v_run from public.archive_runs where id=p_run_id;
  if not found then raise exception 'unknown run %',p_run_id using errcode='22023'; end if;
 end if;
 for it in select value from jsonb_array_elements(p_items) loop
  v_prob:=public.archive_item_problem(it);
  if v_prob is not null then
   n_ign:=n_ign+1;
   insert into public.archive_run_errors(run_id,rule_id,stage,message,url)
   values(p_run_id,v_run.rule_id,'validate',left('invalid item: '||v_prob,1000),left(case when jsonb_typeof(it)='object' and jsonb_typeof(it->'url')='string' then it->>'url' end,2000));
   v_out:=v_out||jsonb_build_array(jsonb_build_object('canonical_url',case when jsonb_typeof(it)='object' then it->'canonical_url' end,'outcome','ignored'));
   continue;
  end if;
  begin
   v_prov:=it->>'provider'; v_curl:=it->>'canonical_url'; v_title:=btrim(it->>'title'); v_label:=it#>>'{classification,label}';
   v_score:=round((it#>>'{classification,score}')::numeric); v_rel:=round((it->>'reliability')::numeric);
   v_status:=case when v_score>=st.review_threshold then 'needs_review' when v_score>=st.auto_ignore_below then 'uncertain' else 'auto_ignored' end;
   v_rule:=coalesce((it->>'rule_id')::uuid,v_run.rule_id);
   v_qid:=it#>>'{keys,wikidata_qid}'; v_alias:=(it#>>'{keys,alias_project_id}')::uuid; v_story:=it#>>'{keys,story_key}';
   v_norm:=public.archive_norm_name(it#>>'{keys,normalized_name}');
   v_name:=nullif(btrim(coalesce(it#>>'{detected,name}',it#>>'{keys,normalized_name}')),'');
   v_cc:=it#>>'{detected,country_iso2}'; v_city:=nullif(btrim(it#>>'{detected,city}'),'');
   v_lat:=(it#>>'{detected,latitude}')::float8; v_lng:=(it#>>'{detected,longitude}')::float8;
   v_pid:=null; v_cid:=null; v_kind:=null;
   -- Concurrent runs (cron and a WebSub push) must not both create the same URL.
   perform pg_advisory_xact_lock(hashtextextended('archive:'||v_curl,0));
   select x.id,x.candidate_id,x.project_id into h from public.archive_candidate_hits x where x.provider=v_prov and x.canonical_url=v_curl;
   if found then
    -- Seen before from this provider: only the sighting counts.
    if h.candidate_id is not null then update public.archive_candidates set last_seen_at=now(),seen_count=seen_count+1 where id=h.candidate_id; end if;
    n_dup:=n_dup+1; n_kept:=n_kept+1;
    v_out:=v_out||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('canonical_url',v_curl,'outcome','duplicate_hit','candidate_id',h.candidate_id,'project_id',h.project_id)));
    continue;
   end if;
   if v_qid is not null then
    select p.id into v_pid from public.archive_projects p where p.wikidata_qid=v_qid;
    if v_pid is null then
     select c.id into v_cid from public.archive_candidates c where c.wikidata_qid=v_qid order by c.status in ('needs_review','uncertain') desc,c.last_seen_at desc limit 1;
    end if;
    if v_pid is not null or v_cid is not null then v_kind:='match'; end if;
   end if;
   if v_kind is null then
    select p.id into v_pid from public.archive_projects p where p.official_url is not null and public.archive_url_key(p.official_url)=public.archive_url_key(v_curl)
    order by p.merged_into nulls first limit 1;
    if v_pid is null then
     select ps.project_id into v_pid from public.archive_sources s join public.archive_project_sources ps on ps.source_id=s.id where s.canonical_url=v_curl
     order by ps.added_at limit 1;
    end if;
    if v_pid is null then
     select x.candidate_id,x.project_id into v_cid,v_pid from public.archive_candidate_hits x where x.canonical_url=v_curl order by x.fetched_at limit 1;
    end if;
    if v_pid is not null or v_cid is not null then v_kind:='duplicate'; end if;
   end if;
   if v_kind is null and v_status<>'auto_ignored' then
    if v_alias is not null then
     select p.id into v_pid from public.archive_projects p where p.id=v_alias;
     if v_pid is not null then v_kind:='match'; end if;
    end if;
    if v_kind is null and v_norm is not null and v_cc is not null and v_city is not null then
     select p.id into v_pid from public.archive_projects p
     where p.country_iso2=v_cc and lower(btrim(p.city))=lower(v_city)
      and v_norm in (select public.archive_norm_name(n) from unnest(array[p.name_original,p.name_en,p.name_ko]||p.aliases) n)
     order by p.merged_into nulls first limit 1;
     if v_pid is null then
      select c.id into v_cid from public.archive_candidates c
      where c.status in ('needs_review','uncertain') and c.normalized_name=v_norm and c.detected_country_iso2=v_cc and lower(btrim(c.detected_city))=lower(v_city)
      order by c.last_seen_at desc limit 1;
     end if;
     if v_pid is not null or v_cid is not null then v_kind:='match'; end if;
    end if;
    if v_kind is null and v_lat is not null and v_name is not null then
     -- 0.0019° of latitude ≈ 211 m: a box first, then the exact distance.
     v_dlng:=0.0019/greatest(cos(radians(v_lat)),0.01);
     select p.id into v_pid from public.archive_projects p
     cross join lateral (select max(similarity(lower(n),lower(v_name))) sim from unnest(array[p.name_original,p.name_en,p.name_ko]||p.aliases) n) s
     where p.latitude between v_lat-0.0019 and v_lat+0.0019 and p.longitude between v_lng-v_dlng and v_lng+v_dlng
      and public.archive_distance_m(v_lat,v_lng,p.latitude,p.longitude)<=200 and s.sim>=0.45
     order by p.merged_into nulls first,s.sim desc,public.archive_distance_m(v_lat,v_lng,p.latitude,p.longitude) limit 1;
     if v_pid is null then
      select c.id into v_cid from public.archive_candidates c
      where c.status in ('needs_review','uncertain') and c.detected_name is not null
       and c.latitude between v_lat-0.0019 and v_lat+0.0019 and c.longitude between v_lng-v_dlng and v_lng+v_dlng
       and public.archive_distance_m(v_lat,v_lng,c.latitude,c.longitude)<=200 and similarity(lower(c.detected_name),lower(v_name))>=0.45
      order by similarity(lower(c.detected_name),lower(v_name)) desc,c.last_seen_at desc limit 1;
     end if;
     if v_pid is not null or v_cid is not null then v_kind:='match'; end if;
    end if;
    if v_kind is null then
     select c.id into v_cid from public.archive_candidates c
     where c.status in ('needs_review','uncertain') and c.dedupe_key=v_story and c.last_seen_at>now()-interval '14 days'
     order by c.last_seen_at desc limit 1;
     if v_cid is null then
      select x.candidate_id into v_cid from public.archive_candidate_hits x join public.archive_candidates c on c.id=x.candidate_id
      where c.status in ('needs_review','uncertain') and x.fetched_at>now()-interval '14 days'
       and lower(x.title) % lower(v_title) and similarity(lower(x.title),lower(v_title))>=0.6
      order by similarity(lower(x.title),lower(v_title)) desc,x.fetched_at desc limit 1;
     end if;
     if v_cid is not null then v_kind:='match'; end if;
    end if;
   end if;
   if v_cid is not null then
    select * into t from public.archive_candidate_target(v_cid);
    v_cid:=t.o_candidate;
    if t.o_project is not null then v_pid:=t.o_project; v_cid:=null; end if;
   end if;
   if v_pid is not null then v_pid:=public.archive_project_target(v_pid); v_cid:=null; end if;
   if v_pid is not null then
    v_hit:=public.archive_insert_hit(it,null,v_pid,v_rule);
    if v_kind='match' then
     perform public.archive_record_project_update(v_pid,'new_source',jsonb_build_object('hits',jsonb_build_array(jsonb_build_object(
      'hit_id',v_hit,'provider',v_prov,'url',it->>'url','canonical_url',v_curl,'title',v_title,'publisher',it->>'publisher','published_at',it->>'published_at','score',v_score))));
     update public.archive_projects set last_collected_at=now() where id=v_pid;
     n_match:=n_match+1;
     v_o:=jsonb_build_object('canonical_url',v_curl,'outcome','matched_project','project_id',v_pid);
    else
     n_dup:=n_dup+1;
     v_o:=jsonb_build_object('canonical_url',v_curl,'outcome','duplicate_hit','project_id',v_pid);
    end if;
   elsif v_cid is not null then
    v_hit:=public.archive_insert_hit(it,v_cid,null,v_rule);
    -- The best-scored hit gives the label and reasons; an editor's decision is never undone by a new hit.
    update public.archive_candidates c set last_seen_at=now(),seen_count=c.seen_count+1,
     label=case when v_score>c.score then v_label else c.label end,
     reasons=case when v_score>c.score then it#>'{classification,reasons}' else c.reasons end,
     classifier_version=case when v_score>c.score then it#>>'{classification,version}' else c.classifier_version end,
     score=greatest(c.score,v_score),
     detected_name=coalesce(c.detected_name,v_name),detected_country_iso2=coalesce(c.detected_country_iso2,v_cc),detected_city=coalesce(c.detected_city,v_city),
     latitude=case when c.latitude is null then v_lat else c.latitude end,longitude=case when c.latitude is null then v_lng else c.longitude end,
     language=coalesce(c.language,it->>'language'),wikidata_qid=coalesce(c.wikidata_qid,v_qid),normalized_name=coalesce(c.normalized_name,v_norm),
     status=case when c.reviewed_by is null and c.status in ('needs_review','uncertain','auto_ignored') then public.archive_higher_status(c.status,v_status) else c.status end
    where c.id=v_cid;
    perform public.archive_refresh_candidate(v_cid);
    n_dup:=n_dup+1;
    v_o:=jsonb_build_object('canonical_url',v_curl,'outcome',case when v_kind='duplicate' then 'duplicate_hit' else 'attached_candidate' end,'candidate_id',v_cid);
   else
    insert into public.archive_candidates(status,label,score,confidence,reasons,classifier_version,detected_name,detected_country_iso2,detected_city,latitude,longitude,
     language,dedupe_key,normalized_name,wikidata_qid)
    values(v_status,v_label,v_score,round(0.6*v_score+0.4*v_rel),it#>'{classification,reasons}',it#>>'{classification,version}',v_name,v_cc,v_city,v_lat,v_lng,
     it->>'language',v_story,v_norm,v_qid)
    returning id into v_cid;
    v_hit:=public.archive_insert_hit(it,v_cid,null,v_rule);
    if v_status='auto_ignored' then n_ign:=n_ign+1; else n_new:=n_new+1; end if;
    v_o:=jsonb_build_object('canonical_url',v_curl,'outcome',case when v_status='auto_ignored' then 'ignored' else 'new_candidate' end,'candidate_id',v_cid);
   end if;
   n_kept:=n_kept+1;
  exception when others then
   n_ign:=n_ign+1;
   insert into public.archive_run_errors(run_id,rule_id,stage,message,url) values(p_run_id,v_run.rule_id,'ingest',left(sqlstate||' '||sqlerrm,1000),left(it->>'url',2000));
   v_o:=jsonb_build_object('canonical_url',it->'canonical_url','outcome','ignored');
  end;
  v_out:=v_out||jsonb_build_array(v_o);
 end loop;
 if p_run_id is not null then
  update public.archive_runs set kept=kept+n_kept,new_candidates=new_candidates+n_new,matched_projects=matched_projects+n_match,duplicates=duplicates+n_dup,ignored=ignored+n_ign,
   errors=errors+(select count(*) from jsonb_array_elements(v_out) o where o->>'outcome'='ignored' and o->>'candidate_id' is null)
  where id=p_run_id;
 end if;
 return jsonb_build_object('kept',n_kept,'new_candidates',n_new,'matched_projects',n_match,'duplicates',n_dup,'ignored',n_ign,'items',v_out);
end $$;

-- p_counts: {fetched, kept, new_candidates, matched_projects, duplicates, ignored, errors, …}; a given count
-- replaces what archive_ingest accumulated, other keys go to detail. p_rule_state: {etag?, last_modified?,
-- next_run_at?, backoff_until?}. Success, partial and skipped reset the failures and schedule the next run after the
-- rule's cadence (or at next_run_at, at most 30 days ahead); an error backs off for min(48 h, 1 h × 2^(failures − 1)),
-- or until a later backoff_until the collector derived from Retry-After, never more than 48 h. A second call for
-- the same run changes nothing. WebSub and probe runs leave the poll schedule alone.
create or replace function public.archive_finish_run(p_run_id uuid,p_status text,p_counts jsonb default '{}',p_rule_state jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.archive_runs; c jsonb:=coalesce(p_counts,'{}'); s jsonb:=coalesce(p_rule_state,'{}'); v_next timestamptz; v_rule public.archive_collection_rules;
 v_keys constant text[]:=array['fetched','kept','new_candidates','matched_projects','duplicates','ignored','errors']; v_given timestamptz; v_backoff timestamptz;
begin
 if p_status is null or p_status not in ('success','partial','error','skipped') then raise exception 'unknown status %',p_status using errcode='22023'; end if;
 if jsonb_typeof(c)<>'object' or jsonb_typeof(s)<>'object' then raise exception 'p_counts and p_rule_state must be JSON objects' using errcode='22023'; end if;
 select * into r from public.archive_runs where id=p_run_id for update;
 if not found then raise exception 'unknown run %',p_run_id using errcode='22023'; end if;
 if r.finished_at is not null then return jsonb_build_object('run_id',r.id,'status',r.status,'already_finished',true); end if;
 update public.archive_runs set status=p_status,finished_at=now(),
  fetched=case when public.archive_jnum(c->'fetched',0,1e9,false) then (c->>'fetched')::numeric::int else fetched end,
  kept=case when public.archive_jnum(c->'kept',0,1e9,false) then (c->>'kept')::numeric::int else kept end,
  new_candidates=case when public.archive_jnum(c->'new_candidates',0,1e9,false) then (c->>'new_candidates')::numeric::int else new_candidates end,
  matched_projects=case when public.archive_jnum(c->'matched_projects',0,1e9,false) then (c->>'matched_projects')::numeric::int else matched_projects end,
  duplicates=case when public.archive_jnum(c->'duplicates',0,1e9,false) then (c->>'duplicates')::numeric::int else duplicates end,
  ignored=case when public.archive_jnum(c->'ignored',0,1e9,false) then (c->>'ignored')::numeric::int else ignored end,
  errors=greatest(errors,case when public.archive_jnum(c->'errors',0,1e9,false) then (c->>'errors')::numeric::int else 0 end),
  detail=detail||(c-v_keys)
 where id=p_run_id;
 if r.rule_id is not null and r.trigger not in ('websub','probe') then
  select * into v_rule from public.archive_collection_rules where id=r.rule_id for update;
  if p_status='error' then
   if jsonb_typeof(s->'backoff_until')='string' then
    begin v_given:=(s->>'backoff_until')::timestamptz; exception when others then v_given:=null; end;
   end if;
   v_backoff:=least(now()+interval '48 hours',greatest(now()+least(interval '48 hours',interval '1 hour'*power(2,least(v_rule.failure_count,30))),v_given));
   update public.archive_collection_rules set failure_count=failure_count+1,backoff_until=v_backoff,next_run_at=v_backoff,
    last_status='error',last_run_at=now(),claimed_by=null,claimed_at=null
   where id=r.rule_id;
  else
   v_next:=now()+make_interval(hours=>v_rule.cadence_hours);
   if s->>'next_run_at' is not null then
    begin v_next:=least(now()+interval '30 days',greatest(now(),(s->>'next_run_at')::timestamptz)); exception when others then null; end;
   end if;
   update public.archive_collection_rules set failure_count=0,backoff_until=null,next_run_at=v_next,last_status=p_status,last_run_at=now(),claimed_by=null,claimed_at=null,
    etag=case when s ? 'etag' then left(s->>'etag',500) else etag end,
    last_modified=case when s ? 'last_modified' then left(s->>'last_modified',100) else last_modified end
   where id=r.rule_id;
  end if;
 end if;
 return (select jsonb_build_object('run_id',p_run_id,'status',p_status,'rule',jsonb_build_object('id',x.id,'failure_count',x.failure_count,'backoff_until',x.backoff_until,'next_run_at',x.next_run_at))
         from (select 1) one left join public.archive_collection_rules x on x.id=r.rule_id);
end $$;

-- Never fails for a bad argument: an error report must not be lost (unknown ids become null, text is truncated).
create or replace function public.archive_log_error(p_run_id uuid,p_rule_id uuid,p_stage text,p_http integer,p_message text,p_url text) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_run uuid:=(select id from public.archive_runs where id=p_run_id);
begin
 insert into public.archive_run_errors(run_id,rule_id,stage,http_status,message,url)
 values(v_run,coalesce((select id from public.archive_collection_rules where id=p_rule_id),(select rule_id from public.archive_runs where id=v_run)),
  left(coalesce(nullif(btrim(p_stage),''),'unknown'),40),case when p_http between 100 and 599 then p_http end,left(coalesce(nullif(p_message,''),'(no message)'),1000),left(p_url,2000));
 if v_run is not null then update public.archive_runs set errors=errors+1 where id=v_run; end if;
end $$;

-- The oldest-checked URLs not checked in the last 20 hours: {target: 'source'|'media'|'project', id, url, html (robots
-- applies), link_state, consecutive_failures, last_checked_at}. Results go back through archive_record_link_checks.
create or replace function public.archive_links_due(p_limit integer) returns setof jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select x.j from (
  select jsonb_build_object('target','source','id',s.id,'url',s.url,'html',true,'link_state',s.link_state,'consecutive_failures',s.consecutive_failures,'last_checked_at',s.last_checked_at) j,s.last_checked_at at
  from public.archive_sources s where s.last_checked_at is null or s.last_checked_at<now()-interval '20 hours'
  union all
  select jsonb_build_object('target','media','id',m.id,'url',m.url,'html',false,'link_state',m.link_state,'consecutive_failures',m.consecutive_failures,'last_checked_at',m.last_checked_at),m.last_checked_at
  from public.archive_media m where m.rights_status<>'blocked' and (m.last_checked_at is null or m.last_checked_at<now()-interval '20 hours')
  union all
  select jsonb_build_object('target','project','id',p.id,'url',p.official_url,'html',true,'link_state',p.official_url_state,'consecutive_failures',p.official_url_failures,'last_checked_at',p.official_url_checked_at),p.official_url_checked_at
  from public.archive_projects p where p.official_url is not null and p.merged_into is null and (p.official_url_checked_at is null or p.official_url_checked_at<now()-interval '20 hours')
 ) x order by x.at nulls first
 limit greatest(0,least(coalesce(p_limit,200),5000))
$$;

-- p_results: [{target, id, url, state: ok|redirect|broken|robots_disallowed|blocked, http_status?}], state 'broken'
-- meaning this check failed. Three consecutive failures make the link broken; a success resets the count; robots and
-- SSRF refusals are recorded but are not failures. A result whose url no longer matches is stale and ignored.
-- A newly broken image opens an image_broken update (the view hides it), a broken official URL a link_broken one
-- (update_status link_broken); recovery closes them.
create or replace function public.archive_record_link_checks(p_results jsonb) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r jsonb; v_t text; v_s text; v_id uuid; v_http int; v_url text; v_old text; v_fail int; v_new text; v_pid uuid; n_up int:=0; n_br int:=0; n_rec int:=0;
begin
 if jsonb_typeof(p_results) is distinct from 'array' then raise exception 'p_results must be a JSON array' using errcode='22023'; end if;
 for r in select value from jsonb_array_elements(p_results) loop
  continue when jsonb_typeof(r)<>'object';
  v_t:=r->>'target'; v_s:=r->>'state'; v_url:=r->>'url';
  continue when v_t is null or v_t not in ('source','media','project') or v_s is null or v_s not in ('ok','redirect','broken','robots_disallowed','blocked')
   or coalesce(r->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_id:=(r->>'id')::uuid;
  v_http:=case when public.archive_jnum(r->'http_status',100,599,false) then (r->>'http_status')::numeric::int end;
  v_old:=null; v_pid:=null;
  if v_t='source' then select link_state,consecutive_failures into v_old,v_fail from public.archive_sources where id=v_id and url=v_url for update;
  elsif v_t='media' then select link_state,consecutive_failures,project_id into v_old,v_fail,v_pid from public.archive_media where id=v_id and url=v_url for update;
  else select official_url_state,official_url_failures,id into v_old,v_fail,v_pid from public.archive_projects where id=v_id and official_url=v_url for update;
  end if;
  continue when v_old is null;
  v_fail:=case when v_s='broken' then v_fail+1 when v_s in ('ok','redirect') then 0 else v_fail end;
  v_new:=case when v_s<>'broken' then v_s when v_fail>=3 then 'broken' else v_old end;
  if v_t='source' then update public.archive_sources set link_state=v_new,consecutive_failures=least(v_fail,32767),http_status=v_http,last_checked_at=now() where id=v_id;
  elsif v_t='media' then update public.archive_media set link_state=v_new,consecutive_failures=least(v_fail,32767),http_status=v_http,last_checked_at=now() where id=v_id;
  else update public.archive_projects set official_url_state=v_new,official_url_failures=least(v_fail,32767),official_url_checked_at=now() where id=v_id;
  end if;
  n_up:=n_up+1;
  if v_new='broken' and v_old<>'broken' then
   n_br:=n_br+1;
   if v_t='media' then perform public.archive_record_project_update(v_pid,'image_broken',jsonb_build_object('media_id',v_id,'url',v_url,'http_status',v_http));
   elsif v_t='project' then perform public.archive_record_project_update(v_pid,'link_broken',jsonb_build_object('url',v_url,'http_status',v_http));
   end if;
  elsif v_old='broken' and v_new in ('ok','redirect') then
   n_rec:=n_rec+1;
   if v_t='project' or (v_t='media' and not exists(select 1 from public.archive_media where project_id=v_pid and link_state='broken')) then
    update public.archive_project_updates set status='dismissed',resolved_at=now(),detail=detail||jsonb_build_object('auto_resolved','recovered')
    where project_id=v_pid and status='open' and kind=case when v_t='project' then 'link_broken' else 'image_broken' end;
    perform public.archive_refresh_update_status(v_pid);
   end if;
  end if;
 end loop;
 return jsonb_build_object('updated',n_up,'broken',n_br,'recovered',n_rec);
end $$;

-- Every project not merged away, with all its names (known-project matching, dedupe rule 3).
create or replace function public.archive_alias_index() returns setof jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('project_id',p.id,'slug',p.slug,
  'names',(select coalesce(jsonb_agg(distinct btrim(n)),'[]') from unnest(array[p.name_original,p.name_en,p.name_ko]||p.aliases) n where nullif(btrim(n),'') is not null),
  'wikidata_qid',p.wikidata_qid,'country_iso2',p.country_iso2,'city',p.city)
 from public.archive_projects p where p.merged_into is null order by p.id
$$;

-- Upsert by topic. A null p_secret, p_hub or p_rule_id keeps the stored one (a new topic needs hub and secret);
-- p_lease_seconds sets lease_expires_at from now.
create or replace function public.archive_websub_upsert(p_topic text,p_hub text,p_secret text,p_state text,p_lease_seconds integer,p_rule_id uuid) returns uuid
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id uuid; v_lease timestamptz:=case when p_lease_seconds is not null then now()+make_interval(secs=>greatest(0,least(p_lease_seconds,31536000))) end;
begin
 if p_state is null or p_state not in ('pending','active','failed','expired') then raise exception 'unknown state %',p_state using errcode='22023'; end if;
 select id into v_id from public.archive_websub_subscriptions where topic=p_topic for update;
 if v_id is null then
  insert into public.archive_websub_subscriptions(topic,hub,secret,state,lease_expires_at,rule_id) values(p_topic,p_hub,p_secret,p_state,v_lease,p_rule_id) returning id into v_id;
 else
  update public.archive_websub_subscriptions set hub=coalesce(p_hub,hub),secret=coalesce(p_secret,secret),state=p_state,
   lease_expires_at=case when p_lease_seconds is not null then v_lease else lease_expires_at end,rule_id=coalesce(p_rule_id,rule_id)
  where id=v_id;
 end if;
 return v_id;
end $$;

create or replace function public.archive_websub_get(p_topic text) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('topic',w.topic,'hub',w.hub,'secret',w.secret,'state',w.state,'lease_expires_at',w.lease_expires_at,'rule_id',w.rule_id)
 from public.archive_websub_subscriptions w where w.topic=p_topic
$$;

-- Subscriptions to (re)subscribe: active ones whose lease ends within p_within_hours (or is unknown), failed and
-- expired ones, and pending ones the hub has not verified for an hour. No secrets (archive_websub_get has it).
create or replace function public.archive_websub_due(p_within_hours integer) returns setof jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('id',w.id,'topic',w.topic,'hub',w.hub,'state',w.state,'lease_expires_at',w.lease_expires_at,'rule_id',w.rule_id,
  'reason',case when w.state in ('failed','expired') then w.state when w.state='pending' then 'unverified' when w.lease_expires_at<=now() then 'expired' else 'expiring' end)
 from public.archive_websub_subscriptions w
 where (w.state='active' and (w.lease_expires_at is null or w.lease_expires_at<now()+make_interval(hours=>greatest(0,least(coalesce(p_within_hours,48),720)))))
  or w.state in ('failed','expired') or (w.state='pending' and w.updated_at<now()-interval '1 hour')
 order by w.lease_expires_at nulls first,w.topic
 limit 200
$$;

-- One open row per (project, kind): a new report extends it (archive_merge_detail) instead of adding another.
create or replace function public.archive_record_project_update(p_project_id uuid,p_kind text,p_detail jsonb) returns uuid
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_pid uuid:=public.archive_project_target(p_project_id); v_id uuid; v_d jsonb:=coalesce(p_detail,'{}'); v_new boolean:=false;
begin
 if v_pid is null then raise exception 'unknown project %',p_project_id using errcode='22023'; end if;
 if p_kind is null or p_kind not in ('new_source','changed_field','link_broken','image_broken','wikidata_changed') then raise exception 'unknown kind %',p_kind using errcode='22023'; end if;
 if jsonb_typeof(v_d)<>'object' or octet_length(v_d::text)>16384 then raise exception 'p_detail must be a JSON object of at most 16 kB' using errcode='22023'; end if;
 if v_d ? 'hits' and jsonb_typeof(v_d->'hits')<>'array' then raise exception 'detail.hits must be an array' using errcode='22023'; end if;
 select id into v_id from public.archive_project_updates where project_id=v_pid and kind=p_kind and status='open' for update;
 if v_id is null then
  insert into public.archive_project_updates(project_id,kind,detail) values(v_pid,p_kind,public.archive_merge_detail('{}',v_d))
  on conflict(project_id,kind) where status='open' do nothing returning id into v_id;
  v_new:=v_id is not null;
 end if;
 if v_id is null then select id into v_id from public.archive_project_updates where project_id=v_pid and kind=p_kind and status='open' for update; end if;
 if not v_new then update public.archive_project_updates set detail=public.archive_merge_detail(detail,v_d) where id=v_id; end if;
 perform public.archive_refresh_update_status(v_pid);
 return v_id;
end $$;

-- Deletes auto_ignored candidates unseen for 30 days (with their hits) and runs older than 180 days (with their
-- errors). Never a project, and never an approved, merged, rejected or duplicate candidate.
create or replace function public.archive_prune() returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare n_c int; n_r int; n_e int;
begin
 delete from public.archive_candidates where status='auto_ignored' and last_seen_at<now()-interval '30 days';
 get diagnostics n_c=row_count;
 delete from public.archive_runs where started_at<now()-interval '180 days';
 get diagnostics n_r=row_count;
 delete from public.archive_run_errors where at<now()-interval '180 days';
 get diagnostics n_e=row_count;
 return jsonb_build_object('candidates',n_c,'runs',n_r,'errors',n_e);
end $$;

-- ---- privileges ------------------------------------------------------------------------------------------------
-- Supabase grants every new function to anon and authenticated; each group below is set explicitly on every run.
revoke all on function public.is_app_admin() from public,anon;
grant execute on function public.is_app_admin() to authenticated,service_role;
revoke all on function public.archive_role() from public,anon;
grant execute on function public.archive_role() to authenticated,service_role;
-- Internal: the owner runs them inside the functions above; service_role's (invoker) functions and its direct writes
-- need them too (check constraints and indexes call some).
revoke all on function public.archive_app_admins_role(),public.archive_require(text[]),public.archive_region_of(text),public.archive_valid_field_status(jsonb),
 public.archive_project_fields(),public.archive_url_key(text),public.archive_url_host(text),public.archive_norm_name(text),public.archive_name_text(text,text,text,text[]),
 public.archive_slugify(text),public.archive_distance_m(float8,float8,float8,float8),public.archive_base_reliability(text),public.archive_union(text[],text[]),
 public.archive_jstr(jsonb,integer,boolean),public.archive_jnum(jsonb,numeric,numeric,boolean),public.archive_jarr(jsonb),public.archive_jclean(jsonb),public.archive_like(text),
 public.archive_higher_status(text,text),public.archive_touch(),public.archive_projects_touch(),public.archive_audit(text,text,text,jsonb,jsonb),
 public.archive_project_target(uuid),public.archive_candidate_target(uuid),public.archive_refresh_candidate(uuid),public.archive_refresh_update_status(uuid),
 public.archive_merge_detail(jsonb,jsonb),public.archive_new_slug(text),public.archive_source_from_hit(uuid,uuid,text[]),public.archive_sources_from_candidate(uuid,uuid,text[]),
 public.archive_apply_project(uuid,jsonb,jsonb,uuid,text),public.archive_item_problem(jsonb),public.archive_insert_hit(jsonb,uuid,uuid,uuid),
 public.archive_rank(text,text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.archive_region_of(text),public.archive_valid_field_status(jsonb),public.archive_project_fields(),public.archive_url_key(text),
 public.archive_url_host(text),public.archive_norm_name(text),public.archive_name_text(text,text,text,text[]),public.archive_slugify(text),
 public.archive_distance_m(float8,float8,float8,float8),public.archive_base_reliability(text),public.archive_union(text[],text[]),public.archive_jstr(jsonb,integer,boolean),
 public.archive_jnum(jsonb,numeric,numeric,boolean),public.archive_jarr(jsonb),public.archive_jclean(jsonb),public.archive_like(text),public.archive_higher_status(text,text),
 public.archive_project_target(uuid),public.archive_candidate_target(uuid),public.archive_refresh_candidate(uuid),public.archive_refresh_update_status(uuid),
 public.archive_merge_detail(jsonb,jsonb),public.archive_item_problem(jsonb),public.archive_insert_hit(jsonb,uuid,uuid,uuid),public.archive_rank(text,text,text,text,text[]) to service_role;
-- Public read API: both read only the published view.
revoke all on function public.archive_search(text,jsonb,text,integer,integer),public.archive_public_stats() from public,anon,authenticated;
grant execute on function public.archive_search(text,jsonb,text,integer,integer),public.archive_public_stats() to anon,authenticated,service_role;
-- Admin API: signed-in users; each function checks archive_role() itself.
revoke all on function public.archive_admin_dashboard(),public.archive_admin_list_candidates(text,text,integer,integer,integer),
 public.archive_admin_review_candidate(uuid,text,jsonb),public.archive_admin_upsert_project(jsonb),public.archive_admin_set_visibility(uuid,text,text),
 public.archive_admin_merge_projects(uuid,uuid),public.archive_admin_add_source(uuid,jsonb,text[]),public.archive_admin_set_media(uuid,jsonb),
 public.archive_admin_remove_media(uuid),public.archive_admin_list_projects(text,text,integer,integer),public.archive_admin_list_updates(text,integer),
 public.archive_admin_resolve_update(uuid,text),public.archive_admin_list_runs(integer,uuid),public.archive_admin_list_errors(integer),
 public.archive_admin_list_rules(),public.archive_admin_upsert_rule(jsonb),public.archive_admin_list_keywords(),public.archive_admin_upsert_keyword(jsonb),
 public.archive_admin_set_settings(jsonb),public.archive_research_add_assessment(uuid,text,jsonb,text,text,text),
 public.archive_admin_remove_source(uuid,uuid),public.archive_admin_delete_keyword(text,text) from public,anon;
grant execute on function public.archive_admin_dashboard(),public.archive_admin_list_candidates(text,text,integer,integer,integer),
 public.archive_admin_review_candidate(uuid,text,jsonb),public.archive_admin_upsert_project(jsonb),public.archive_admin_set_visibility(uuid,text,text),
 public.archive_admin_merge_projects(uuid,uuid),public.archive_admin_add_source(uuid,jsonb,text[]),public.archive_admin_set_media(uuid,jsonb),
 public.archive_admin_remove_media(uuid),public.archive_admin_list_projects(text,text,integer,integer),public.archive_admin_list_updates(text,integer),
 public.archive_admin_resolve_update(uuid,text),public.archive_admin_list_runs(integer,uuid),public.archive_admin_list_errors(integer),
 public.archive_admin_list_rules(),public.archive_admin_upsert_rule(jsonb),public.archive_admin_list_keywords(),public.archive_admin_upsert_keyword(jsonb),
 public.archive_admin_set_settings(jsonb),public.archive_research_add_assessment(uuid,text,jsonb,text,text,text),
 public.archive_admin_remove_source(uuid,uuid),public.archive_admin_delete_keyword(text,text) to authenticated;
-- Service API: the Edge Functions only.
revoke all on function public.archive_claim_due_rules(integer,text,uuid[]),public.archive_start_run(uuid,text),public.archive_ingest(uuid,jsonb),
 public.archive_finish_run(uuid,text,jsonb,jsonb),public.archive_log_error(uuid,uuid,text,integer,text,text),public.archive_links_due(integer),
 public.archive_record_link_checks(jsonb),public.archive_alias_index(),public.archive_websub_upsert(text,text,text,text,integer,uuid),public.archive_websub_get(text),
 public.archive_websub_due(integer),public.archive_record_project_update(uuid,text,jsonb),public.archive_prune() from public,anon,authenticated;
grant execute on function public.archive_claim_due_rules(integer,text,uuid[]),public.archive_start_run(uuid,text),public.archive_ingest(uuid,jsonb),
 public.archive_finish_run(uuid,text,jsonb,jsonb),public.archive_log_error(uuid,uuid,text,integer,text,text),public.archive_links_due(integer),
 public.archive_record_link_checks(jsonb),public.archive_alias_index(),public.archive_websub_upsert(text,text,text,text,integer,uuid),public.archive_websub_get(text),
 public.archive_websub_due(integer),public.archive_record_project_update(uuid,text,jsonb),public.archive_prune() to service_role;
-- SOURCE: migrations/20261013000000_discovered_places.sql
-- v0.15 server-side nationwide/worldwide place sync (Edge Function sync-global-places: places every 6 hours, photo
-- checks every 3 hours). The Wikidata branch queries run ONCE per run on the server instead of in every visitor's
-- browser; the app reads the result from public.public_discovered_places (one REST request) and falls back to its own
-- browser sync when the server has no rows. Re-runnable, also over the first released version of this file: apply
-- after the legacy SQL 01..18 and 20261010160920 (also part of release/launch/complete-backend.sql).
--
-- Access: RLS is on and there is no policy for anon/authenticated, and they hold no privilege on the table: clients read
-- only through the view, which hides rows the sync has not seen for 72 hours and photo verdicts older than 24 hours
-- (the same limits as the browser sync). Only service_role (the Edge Function) writes, through the functions below.
-- The view deliberately runs with its owner's rights (security_invoker = false) so that it is the only way in; the
-- Supabase Security Advisor lists it as a "security definer view" for that reason (see release/launch/LAUNCH.md).
--
-- Editorial overrides (lasting; the sync never sets or clears them), set in the SQL Editor:
--   place_block: the place is not in the view at all.
--   image_block: the place's photo is shown as blocked ('editorial_block'), whatever file Wikidata names now or later;
--     its verdicts are neither re-checked nor replaced by the sync.
-- A row with either is never deleted by prune_discovered_places, so the override survives the place dropping out of
-- Wikidata and coming back.
create table if not exists public.discovered_places(
 qid text primary key check(qid ~ '^Q[0-9]+$'),
 scope text not null check(scope in ('korea','world')),
 -- The app's compact place record (compactPlaces in edge-functions/_shared/global-places.mjs): a positional array whose
 -- first element is the QID. Branch indexes inside it are only valid for the same code version: "branches" is the
 -- authoritative list.
 record jsonb not null check(jsonb_typeof(record)='array' and record->>0=qid),
 primary_category text not null check(primary_category in ('Media Facade','Light Art','Media Art','Festival','Exhibition','Architectural Lighting','Public Art','Nightscape')),
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 sitelinks integer not null default 0 check(sitelinks>=0),
 branches text[] not null default '{}',
 -- Wikidata P18 file name (Commons), NULL when the item has none.
 image_file text check(image_file is null or length(image_file) between 1 and 240),
 image_status text not null default 'none' check(image_status in ('none','pending','cleared','blocked')),
 image_reasons text[] not null default '{}',
 -- Rights-cleared, attributed rows (live-media.mjs toMediaRow shape); empty unless image_status is 'cleared'.
 media jsonb not null default '[]' check(jsonb_typeof(media)='array'),
 media_checked_at timestamptz,
 -- MEDIA_KR_FOP_DISPLAY policy the verdict was made under (a changed policy makes the photo due again).
 media_kr_fop boolean,
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 synced_at timestamptz not null default now(),
 check((image_status='none')=(image_file is null)),
 check(image_status='cleared' or media='[]'::jsonb),
 check(image_status<>'cleared' or jsonb_array_length(media)>0)
);
-- The editorial overrides: the reason (e.g. "rights complaint 2026-10-17, ticket 12"); NULL = none. The reason itself is
-- never shown to visitors.
alter table public.discovered_places add column if not exists place_block text check(place_block is null or length(btrim(place_block)) between 1 and 500);
alter table public.discovered_places add column if not exists image_block text check(image_block is null or length(btrim(image_block)) between 1 and 500);
create index if not exists discovered_places_last_seen on public.discovered_places(last_seen_at);
create index if not exists discovered_places_media_due on public.discovered_places(media_checked_at nulls first) where image_file is not null;
alter table public.discovered_places enable row level security;
revoke all on public.discovered_places from public,anon,authenticated;
grant all on public.discovered_places to service_role;

-- One sync run at a time (both phases take job 'sync-global-places'): see claim_discovered_sync.
create table if not exists public.discovered_sync_locks(
 job_name text primary key check(length(job_name) between 1 and 100),
 owner text not null check(length(owner) between 1 and 100),
 locked_at timestamptz not null default now(),
 expires_at timestamptz not null
);
alter table public.discovered_sync_locks enable row level security;
revoke all on public.discovered_sync_locks from public,anon,authenticated;
grant all on public.discovered_sync_locks to service_role;

create or replace view public.public_discovered_places with (security_invoker=false) as
select d.qid,d.scope,d.record,d.branches,d.primary_category,d.latitude,d.longitude,d.sitelinks,d.image_file,
 case when d.image_file is null then 'none'
      when d.image_block is not null then 'blocked'
      when d.image_status in ('cleared','blocked') and d.media_checked_at>now()-interval '24 hours' then d.image_status
      else 'pending' end as image_status,
 case when d.image_file is null then '{}'::text[]
      when d.image_block is not null then array['editorial_block']
      when d.image_status='blocked' and d.media_checked_at>now()-interval '24 hours' then d.image_reasons
      else '{}'::text[] end as image_reasons,
 case when d.image_block is null and d.image_status='cleared' and d.media_checked_at>now()-interval '24 hours' then d.media else '[]'::jsonb end as media,
 -- An editorial block is a current verdict at every read, so it also replaces a verdict a browser still holds.
 case when d.image_file is not null and d.image_block is not null then now() else d.media_checked_at end as media_checked_at,
 d.first_seen_at,d.last_seen_at,d.synced_at
from public.discovered_places d
where d.last_seen_at>now()-interval '72 hours' and d.place_block is null;
-- Supabase grants new views to anon/authenticated by default; a view with its owner's rights must be read-only for them.
revoke all on public.public_discovered_places from public,anon,authenticated;
grant select on public.public_discovered_places to anon,authenticated,service_role;

-- Takes the run lock p_job for p_lease_seconds (at most an hour) unless another run holds one that has not expired;
-- p_force takes it anyway. Returns {"ok": true, "owner"} or {"ok": false, "owner", "locked_at", "expires_at"} (the
-- holder). Atomic: concurrent claims serialize on the primary key, so exactly one of them gets a free lock. (A session
-- advisory lock would not hold: every PostgREST request runs in its own transaction on a pooled connection.)
create or replace function public.claim_discovered_sync(p_job text,p_owner text,p_lease_seconds integer,p_force boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare got text; held record;
begin
 if coalesce(length(p_job),0) not between 1 and 100 or coalesce(length(p_owner),0) not between 1 and 100 then
  raise exception 'p_job and p_owner are required';
 end if;
 insert into public.discovered_sync_locks as l(job_name,owner,locked_at,expires_at)
 values(p_job,p_owner,now(),now()+make_interval(secs=>greatest(1,least(coalesce(p_lease_seconds,0),3600))))
 on conflict(job_name) do update set owner=excluded.owner,locked_at=excluded.locked_at,expires_at=excluded.expires_at
  where l.expires_at<=now() or l.owner=excluded.owner or coalesce(p_force,false)
 returning l.owner into got;
 if got is not null then return jsonb_build_object('ok',true,'owner',got); end if;
 select x.owner,x.locked_at,x.expires_at into held from public.discovered_sync_locks x where x.job_name=p_job;
 return jsonb_build_object('ok',false,'owner',held.owner,'locked_at',held.locked_at,'expires_at',held.expires_at);
end $$;

-- Gives the lock back; only its owner can (a run whose lock a forced run took releases nothing).
create or replace function public.release_discovered_sync(p_job text,p_owner text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 delete from public.discovered_sync_locks where job_name=p_job and owner=p_owner;
 return found;
end $$;

-- Upserts one batch of places seen by a run. A changed P18 file resets the photo verdict to 'pending'; an unchanged
-- one keeps its verdict. first_seen_at and the editorial overrides are never changed. A row a newer run already wrote
-- (later last_seen_at) is left alone, so a slower, older run that overlaps it cannot put back older data.
create or replace function public.apply_discovered_places(p_rows jsonb,p_seen_at timestamptz)
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'p_rows must be a JSON array'; end if;
 insert into public.discovered_places as d(qid,scope,record,primary_category,latitude,longitude,sitelinks,branches,image_file,image_status,first_seen_at,last_seen_at,synced_at)
 select distinct on (r.qid) r.qid,r.scope,r.record,r.primary_category,r.latitude,r.longitude,coalesce(r.sitelinks,0),coalesce(r.branches,'{}'),
  nullif(r.image_file,''),case when nullif(r.image_file,'') is null then 'none' else 'pending' end,p_seen_at,p_seen_at,now()
 from jsonb_to_recordset(p_rows) as r(qid text,scope text,record jsonb,primary_category text,latitude double precision,longitude double precision,sitelinks integer,branches text[],image_file text)
 order by r.qid
 on conflict(qid) do update set
  scope=excluded.scope,record=excluded.record,primary_category=excluded.primary_category,latitude=excluded.latitude,longitude=excluded.longitude,
  sitelinks=excluded.sitelinks,branches=excluded.branches,last_seen_at=excluded.last_seen_at,synced_at=now(),
  image_file=excluded.image_file,
  image_status=case when excluded.image_file is not distinct from d.image_file then d.image_status else excluded.image_status end,
  image_reasons=case when excluded.image_file is not distinct from d.image_file then d.image_reasons else '{}'::text[] end,
  media=case when excluded.image_file is not distinct from d.image_file then d.media else '[]'::jsonb end,
  media_checked_at=case when excluded.image_file is not distinct from d.image_file then d.media_checked_at end,
  media_kr_fop=case when excluded.image_file is not distinct from d.image_file then d.media_kr_fop end
 where d.last_seen_at<=excluded.last_seen_at;
 get diagnostics n=row_count;
 return n;
end $$;

-- After a run: removes the places it did not see, except those a failed branch may have returned (they stay until
-- that branch answers again; the view hides them after 72 hours) and those with an editorial override. Anything else
-- unseen for 30 days goes regardless.
create or replace function public.prune_discovered_places(p_seen_at timestamptz,p_failed_branches text[] default '{}')
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 delete from public.discovered_places d
 where d.last_seen_at<p_seen_at and d.place_block is null and d.image_block is null
  and (not (d.branches && coalesce(p_failed_branches,'{}'::text[])) or d.last_seen_at<p_seen_at-interval '30 days');
 get diagnostics n=row_count;
 return n;
end $$;

-- Places stored per branch id ({"korea:classes": 44, …}), over the rows seen in the 72 hours before p_seen_at (the
-- rows the view still shows). A place run reads it before it writes: a branch that answers with less than half of its
-- count is treated as failed for pruning (global-places-server.mjs droppedBranches). Rows unseen for 72 hours no
-- longer count, so a real, lasting drop is accepted by the first run after that.
create or replace function public.discovered_branch_counts(p_seen_at timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(x.branch,x.n),'{}'::jsonb)
 from (
  select b.branch,count(*)::integer n
  from public.discovered_places d cross join lateral unnest(d.branches) as b(branch)
  where d.last_seen_at>p_seen_at-interval '72 hours'
  group by b.branch
 ) x
$$;

-- Photos to rights-check next, as one JSON array [{qid, image_file}]: never checked first, then those checked under
-- another FoP policy, then the oldest verdicts (more-linked places first). Only places the view still shows, never a
-- place or photo with an editorial override.
create or replace function public.discovered_images_due(p_limit integer,p_checked_before timestamptz,p_kr_fop boolean)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('qid',q.qid,'image_file',q.image_file) order by q.ord,q.checked nulls first,q.sitelinks desc,q.qid),'[]'::jsonb)
 from (
  select d.qid,d.image_file,d.media_checked_at checked,d.sitelinks,
   case when d.media_checked_at is null then 0 when d.media_kr_fop is distinct from p_kr_fop then 1 else 2 end ord
  from public.discovered_places d
  where d.image_file is not null and d.last_seen_at>now()-interval '72 hours'
   and d.place_block is null and d.image_block is null
   and (d.media_checked_at is null or d.media_checked_at<p_checked_before or d.media_kr_fop is distinct from p_kr_fop)
  order by ord,checked nulls first,d.sitelinks desc,d.qid
  limit greatest(0,least(coalesce(p_limit,0),20000))
 ) q
$$;

-- Stores rights verdicts [{qid, image_file, status: 'cleared'|'blocked', reasons, media}] made at p_checked_at.
-- Ignored: a verdict for a file the place no longer uses, for a place or photo with an editorial override, or one
-- older than the verdict already stored (an older, overlapping run).
create or replace function public.set_discovered_media(p_rows jsonb,p_checked_at timestamptz,p_kr_fop boolean)
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'p_rows must be a JSON array'; end if;
 update public.discovered_places d set
  image_status=r.status,
  image_reasons=case when r.status='blocked' then coalesce(r.reasons,'{}') else '{}'::text[] end,
  media=case when r.status='cleared' then r.media else '[]'::jsonb end,
  media_checked_at=p_checked_at,media_kr_fop=p_kr_fop,synced_at=now()
 from (select distinct on (x.qid) x.* from jsonb_to_recordset(p_rows) as x(qid text,image_file text,status text,reasons text[],media jsonb) order by x.qid) r
 where d.qid=r.qid and d.image_file=r.image_file and r.status in ('cleared','blocked')
  and d.place_block is null and d.image_block is null
  and (d.media_checked_at is null or d.media_checked_at<=p_checked_at)
  and (r.status='blocked' or (jsonb_typeof(r.media)='array' and jsonb_array_length(r.media)>0));
 get diagnostics n=row_count;
 return n;
end $$;

revoke all on function public.apply_discovered_places(jsonb,timestamptz),public.prune_discovered_places(timestamptz,text[]),
 public.discovered_images_due(integer,timestamptz,boolean),public.set_discovered_media(jsonb,timestamptz,boolean),
 public.discovered_branch_counts(timestamptz),public.claim_discovered_sync(text,text,integer,boolean),public.release_discovered_sync(text,text) from public,anon,authenticated;
grant execute on function public.apply_discovered_places(jsonb,timestamptz),public.prune_discovered_places(timestamptz,text[]),
 public.discovered_images_due(integer,timestamptz,boolean),public.set_discovered_media(jsonb,timestamptz,boolean),
 public.discovered_branch_counts(timestamptz),public.claim_discovered_sync(text,text,integer,boolean),public.release_discovered_sync(text,text) to service_role;
commit;
