-- 빛의 건축 v0.2 — Live Data / Global Expansion Schema
-- Run after v0.1 schema/seed/storage/RPC.

create extension if not exists pgcrypto;

create table if not exists public.external_place_links (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  provider text not null,
  external_id text not null,
  external_url text,
  match_method text,
  match_confidence numeric(4,3) check (match_confidence is null or match_confidence between 0 and 1),
  status text not null default 'active',
  last_matched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(provider, external_id),
  unique(place_id, provider)
);

create table if not exists public.live_place_snapshots (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  provider text not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  open_now boolean,
  hours_text text,
  business_status text,
  phone text,
  live_website text,
  provider_attribution text,
  provider_url text,
  payload_hash text,
  storage_note text,
  created_at timestamptz not null default now(),
  check (expires_at > fetched_at)
);
create index if not exists live_snapshots_place_provider_idx
on public.live_place_snapshots(place_id, provider, fetched_at desc);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  event_code text unique,
  place_id uuid references public.places(id) on delete set null,
  title text not null,
  subtitle text,
  description text,
  start_at timestamptz,
  end_at timestamptz,
  all_day boolean not null default false,
  city text,
  country_code text,
  address text,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  primary_category text,
  source_provider text not null,
  external_id text,
  source_url text,
  rights_url text,
  ticket_url text,
  status text not null default 'scheduled',
  last_synced_at timestamptz,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_provider, external_id)
);

drop trigger if exists trg_events_updated_at on public.events;
create trigger trg_events_updated_at
before update on public.events
for each row execute function public.touch_updated_at();

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  place_id uuid references public.places(id) on delete cascade,
  work_id uuid references public.works(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  asset_kind text not null default 'image',
  storage_path text,
  source_provider text,
  source_url text not null,
  original_file_url text,
  creator text,
  copyright_holder text,
  license_code text,
  license_url text,
  rights_statement text,
  attribution_text text,
  commercial_use_allowed boolean,
  derivatives_allowed boolean,
  permission_reference text,
  clearance_status text not null default 'pending'
    check (clearance_status in ('pending','cleared','rejected','expired')),
  acquired_at timestamptz,
  checked_at timestamptz,
  expires_at timestamptz,
  is_cover boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint media_assets_parent_check
    check (place_id is not null or work_id is not null or event_id is not null)
);

create table if not exists public.place_field_provenance (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  field_name text not null,
  source_provider text not null,
  source_url text,
  observed_value jsonb,
  observed_at timestamptz not null default now(),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  editorial_override boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  job_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running','success','partial','failed')),
  fetched_count integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  flagged_count integer not null default 0,
  error_message text,
  metadata jsonb
);

create table if not exists public.editorial_review_queue (
  id uuid primary key default gen_random_uuid(),
  place_id uuid references public.places(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  provider text not null,
  reason text not null,
  proposed_changes jsonb,
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  status text not null default 'open'
    check (status in ('open','accepted','rejected','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.external_place_links enable row level security;
alter table public.live_place_snapshots enable row level security;
alter table public.events enable row level security;
alter table public.media_assets enable row level security;
alter table public.place_field_provenance enable row level security;
alter table public.sync_runs enable row level security;
alter table public.editorial_review_queue enable row level security;

grant select on public.external_place_links to anon, authenticated;
grant select on public.live_place_snapshots to anon, authenticated;
grant select on public.events to anon, authenticated;
grant select on public.media_assets to anon, authenticated;

create policy "public read external links"
on public.external_place_links for select to anon, authenticated
using (status = 'active');

create policy "public read unexpired live snapshots"
on public.live_place_snapshots for select to anon, authenticated
using (expires_at > now());

create policy "public read published events"
on public.events for select to anon, authenticated
using (is_published = true);

create policy "public read cleared media assets"
on public.media_assets for select to anon, authenticated
using (clearance_status = 'cleared');

create or replace view public.current_live_place_snapshots
with (security_invoker = true)
as
select distinct on (place_id, provider)
  id, place_id, provider, fetched_at, expires_at,
  open_now, hours_text, business_status, phone, live_website,
  provider_attribution, provider_url, storage_note
from public.live_place_snapshots
where expires_at > now()
order by place_id, provider, fetched_at desc;

grant select on public.current_live_place_snapshots to anon, authenticated;

create or replace view public.cleared_media_assets
with (security_invoker = true)
as
select *
from public.media_assets
where clearance_status = 'cleared';

grant select on public.cleared_media_assets to anon, authenticated;
