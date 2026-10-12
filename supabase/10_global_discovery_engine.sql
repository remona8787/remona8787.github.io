-- 빛의 건축 v0.9 — Global Discovery Engine
-- 목적:
-- 국가 → 도시 → 장소 후보 자동 탐색
-- external_candidates / provider_links / duplicate_clusters / publishing workflow 지원

create extension if not exists pgcrypto;

-- Optional enums
do $$
begin
  if not exists (select 1 from pg_type where typname = 'discovery_provider') then
    create type public.discovery_provider as enum (
      'osm_overpass',
      'wikidata',
      'foursquare',
      'google_places',
      'ticketmaster',
      'manual'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'candidate_stage') then
    create type public.candidate_stage as enum (
      'discovered',
      'matched',
      'scored',
      'reviewed',
      'published',
      'rejected',
      'archived'
    );
  end if;
end $$;

create table if not exists public.countries (
  id uuid primary key default gen_random_uuid(),
  iso2 text not null unique,
  iso3 text,
  name_en text not null,
  name_local text,
  continent text,
  wikidata_id text,
  osm_relation_id bigint,
  centroid_lat numeric(10,7),
  centroid_lng numeric(10,7),
  default_language text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references public.countries(id) on delete cascade,
  city_code text not null unique,
  name_en text not null,
  name_local text,
  admin_level text,
  wikidata_id text,
  osm_relation_id bigint,
  timezone text,
  centroid_lat numeric(10,7),
  centroid_lng numeric(10,7),
  bbox_min_lat numeric(10,7),
  bbox_min_lng numeric(10,7),
  bbox_max_lat numeric(10,7),
  bbox_max_lng numeric(10,7),
  population bigint,
  discovery_priority integer not null default 100,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cities_country_priority_idx
  on public.cities(country_id, discovery_priority, name_en);

create table if not exists public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  provider public.discovery_provider not null,
  job_name text not null,
  scope_type text not null,         -- country | city | place | bootstrap
  scope_country_id uuid references public.countries(id) on delete set null,
  scope_city_id uuid references public.cities(id) on delete set null,
  status text not null default 'queued',  -- queued | running | success | partial | error
  requested_by text not null default 'system',
  started_at timestamptz,
  finished_at timestamptz,
  fetched_count integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  flagged_count integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ingestion_jobs_scope_idx
  on public.ingestion_jobs(provider, scope_city_id, created_at desc);

create table if not exists public.external_candidates (
  id uuid primary key default gen_random_uuid(),
  city_id uuid references public.cities(id) on delete set null,
  primary_provider public.discovery_provider not null,
  external_primary_id text not null,
  name text not null,
  name_local text,
  short_description text,
  candidate_type text,                  -- building / museum / media_facade / gallery / event_venue ...
  category_tags text[] not null default '{}',
  lat numeric(10,7),
  lng numeric(10,7),
  address_text text,
  website_url text,
  opening_hours_text text,
  business_status text,
  discovery_stage public.candidate_stage not null default 'discovered',
  publishing_status text not null default 'draft',   -- draft | ready | published | hidden | rejected
  matched_place_id uuid references public.places(id) on delete set null,
  duplicate_cluster_id uuid,
  duplicate_master_id uuid references public.external_candidates(id) on delete set null,
  relevance_score numeric(5,2),
  relevance_reason jsonb not null default '{}'::jsonb,
  confidence_score numeric(5,2),
  image_candidate_count integer not null default 0,
  auto_publish_eligible boolean not null default false,
  last_seen_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  rejected_reason text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(primary_provider, external_primary_id)
);

create index if not exists external_candidates_city_stage_idx
  on public.external_candidates(city_id, discovery_stage, publishing_status);

create index if not exists external_candidates_score_idx
  on public.external_candidates(relevance_score desc, confidence_score desc);

create table if not exists public.provider_links (
  id uuid primary key default gen_random_uuid(),
  external_candidate_id uuid not null references public.external_candidates(id) on delete cascade,
  provider public.discovery_provider not null,
  provider_place_id text not null,
  provider_url text,
  provider_name text,
  lat numeric(10,7),
  lng numeric(10,7),
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(provider, provider_place_id),
  unique(external_candidate_id, provider, provider_place_id)
);

create table if not exists public.duplicate_clusters (
  id uuid primary key default gen_random_uuid(),
  city_id uuid references public.cities(id) on delete cascade,
  normalized_key text not null,
  member_count integer not null default 1,
  resolved_candidate_id uuid references public.external_candidates(id) on delete set null,
  resolution_status text not null default 'unresolved', -- unresolved | merged | ignored
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(city_id, normalized_key)
);

alter table public.external_candidates
  add constraint external_candidates_duplicate_cluster_fk
  foreign key (duplicate_cluster_id) references public.duplicate_clusters(id) on delete set null;

create table if not exists public.candidate_scores (
  id uuid primary key default gen_random_uuid(),
  external_candidate_id uuid not null references public.external_candidates(id) on delete cascade,
  model_version text not null default 'v1',
  score_type text not null, -- relevance | confidence | facade | immersive | architecture
  score numeric(5,2) not null,
  reason jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists candidate_scores_candidate_type_idx
  on public.candidate_scores(external_candidate_id, score_type, created_at desc);

create or replace function public.normalize_candidate_key(
  p_name text,
  p_lat numeric,
  p_lng numeric
) returns text
language plpgsql
immutable
as $$
declare
  nm text;
begin
  nm := regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9가-힣]+', '-', 'g');
  nm := regexp_replace(nm, '-+', '-', 'g');
  nm := trim(both '-' from nm);
  return nm || ':' ||
    coalesce(round(p_lat::numeric, 3)::text, 'na') || ':' ||
    coalesce(round(p_lng::numeric, 3)::text, 'na');
end;
$$;

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
