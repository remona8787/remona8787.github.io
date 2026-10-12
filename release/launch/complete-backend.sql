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
create policy articles_public_read on public.archive_articles for select to anon,authenticated using(status='published');
create policy articles_admin on public.archive_articles for all to authenticated using((select public.is_app_admin())) with check((select public.is_app_admin()));
create index articles_published_date on public.archive_articles(published_at desc) where status='published';
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('visit-photos','visit-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy private_visit_photo_read on storage.objects for select to authenticated using(bucket_id='visit-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy private_visit_photo_insert on storage.objects for insert to authenticated with check(bucket_id='visit-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
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
create policy visit_photo_owner_read on public.visit_photos for select to authenticated using(user_id=(select auth.uid()));
create policy visit_photo_owner_insert on public.visit_photos for insert to authenticated with check(user_id=(select auth.uid()));
create policy visit_photo_owner_delete on public.visit_photos for delete to authenticated using(user_id=(select auth.uid()));
create index visit_photos_owner_visit on public.visit_photos(user_id,visit_id);


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
commit;
