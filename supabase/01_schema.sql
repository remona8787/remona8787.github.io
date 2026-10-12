-- 빛의 건축 v0.1 / Architecture of Light
-- Supabase PostgreSQL schema
-- Generated: 2026-09-21
-- Recommended execution order:
--   01_schema.sql -> 02_seed_seoul50.sql -> 03_storage.sql
--
-- Design principles:
-- 1) Public discovery data is readable without login.
-- 2) Personal data (saved/visited/collections/profile) is private to auth.uid().
-- 3) Internal UUID primary keys are used, while human-readable codes (SEOUL001 etc.) are retained.
-- 4) RLS is enabled on every public table exposed through Supabase Data API.

create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  place_code text not null unique,
  name_kr text not null,
  name_en text,
  primary_category text not null
    check (primary_category in ('Media Facade','Media Art','Immersive','Light Art','Architecture')),
  secondary_categories text[] not null default array[]::text[],
  short_description text,
  description text,
  expert_description text,
  why_it_matters text,
  address text,
  district text,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  indoor boolean,
  free boolean,
  permanent boolean,
  status text not null default 'verify_current_program',
  operational_mode text,
  current_program text,
  program_start date,
  program_end date,
  typical_hours text,
  recommended_time text,
  website text,
  source_url text,
  source_publisher text,
  verified_at date,
  verification_status text check (verification_status in ('high','medium','low')),
  mvp_priority text check (mvp_priority in ('A','B','C')),
  geocode_status text not null default 'needs_geocoding',
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists places_primary_category_idx on public.places(primary_category);
create index if not exists places_status_idx on public.places(status);
create index if not exists places_district_idx on public.places(district);
create index if not exists places_priority_idx on public.places(mvp_priority);
create index if not exists places_program_dates_idx on public.places(program_start, program_end);

drop trigger if exists trg_places_updated_at on public.places;
create trigger trg_places_updated_at
before update on public.places
for each row execute function public.touch_updated_at();

create table if not exists public.works (
  id uuid primary key default gen_random_uuid(),
  work_code text not null unique,
  place_id uuid not null references public.places(id) on delete cascade,
  title text not null,
  artist text,
  studio text,
  year integer,
  media text,
  start_date date,
  end_date date,
  description text,
  official_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists works_place_idx on public.works(place_id);
drop trigger if exists trg_works_updated_at on public.works;
create trigger trg_works_updated_at
before update on public.works
for each row execute function public.touch_updated_at();

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  schedule_code text not null unique,
  place_id uuid not null references public.places(id) on delete cascade,
  day_of_week text,
  open_time text,
  close_time text,
  show_interval text,
  last_entry text,
  price_krw integer check (price_krw is null or price_krw >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists schedules_place_idx on public.schedules(place_id);
drop trigger if exists trg_schedules_updated_at on public.schedules;
create trigger trg_schedules_updated_at
before update on public.schedules
for each row execute function public.touch_updated_at();

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  created_at timestamptz not null default now()
);

create table if not exists public.place_tags (
  place_id uuid not null references public.places(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (place_id, tag_id)
);
create index if not exists place_tags_tag_idx on public.place_tags(tag_id);

create table if not exists public.curations (
  id uuid primary key default gen_random_uuid(),
  curation_code text not null unique,
  title text not null,
  subtitle text,
  description text,
  editor text,
  theme text,
  city text,
  estimated_time text,
  cover_image_url text,
  published_at timestamptz,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists curations_published_idx on public.curations(published_at desc);
drop trigger if exists trg_curations_updated_at on public.curations;
create trigger trg_curations_updated_at
before update on public.curations
for each row execute function public.touch_updated_at();

create table if not exists public.curation_places (
  curation_id uuid not null references public.curations(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  sort_order integer not null default 0,
  editor_comment text,
  primary key (curation_id, place_id)
);
create index if not exists curation_places_sort_idx on public.curation_places(curation_id, sort_order);

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  place_id uuid references public.places(id) on delete cascade,
  work_id uuid references public.works(id) on delete cascade,
  image_url text not null,
  caption text,
  copyright_holder text,
  photographer text,
  source_url text,
  display_order integer not null default 0,
  is_cover boolean not null default false,
  created_at timestamptz not null default now(),
  constraint media_parent_check check (place_id is not null or work_id is not null)
);
create index if not exists media_place_idx on public.media(place_id, display_order);
create index if not exists media_work_idx on public.media(work_id, display_order);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  source_code text not null unique,
  place_id uuid references public.places(id) on delete cascade,
  work_id uuid references public.works(id) on delete cascade,
  source_type text,
  title text,
  publisher text,
  url text not null,
  published_date date,
  checked_date date,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists sources_place_idx on public.sources(place_id);
create index if not exists sources_work_idx on public.sources(work_id);

-- FlutterFlow + Supabase Auth companion table.
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nickname text,
  profile_image text,
  home_city text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
before update on public.users
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, nickname)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nickname', split_part(coalesce(new.email,''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create table if not exists public.saved_places (
  user_id uuid not null references public.users(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
create index if not exists saved_places_user_idx on public.saved_places(user_id, saved_at desc);

create table if not exists public.visited_places (
  user_id uuid not null references public.users(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  first_visited_at timestamptz not null default now(),
  last_visited_at timestamptz not null default now(),
  visit_count integer not null default 1 check (visit_count >= 1),
  rating smallint check (rating is null or rating between 1 and 5),
  comment text,
  primary key (user_id, place_id)
);
create index if not exists visited_places_user_idx on public.visited_places(user_id, last_visited_at desc);

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.collection_places (
  collection_id uuid not null references public.collections(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, place_id)
);

-- -------------------------
-- RLS / grants
-- -------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'places','works','schedules','tags','place_tags',
    'curations','curation_places','media','sources',
    'users','saved_places','visited_places','collections','collection_places'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Public discovery tables: read-only from the client.
revoke all on table public.places, public.works, public.schedules, public.tags,
  public.place_tags, public.curations, public.curation_places, public.media,
  public.sources from anon, authenticated;

grant select on table public.places, public.works, public.schedules, public.tags,
  public.place_tags, public.curations, public.curation_places, public.media,
  public.sources to anon, authenticated;

create policy "public read places" on public.places
for select to anon, authenticated using (is_published = true);

create policy "public read works" on public.works
for select to anon, authenticated using (true);

create policy "public read schedules" on public.schedules
for select to anon, authenticated using (true);

create policy "public read tags" on public.tags
for select to anon, authenticated using (true);

create policy "public read place tags" on public.place_tags
for select to anon, authenticated using (true);

create policy "public read curations" on public.curations
for select to anon, authenticated using (is_published = true);

create policy "public read curation places" on public.curation_places
for select to anon, authenticated using (true);

create policy "public read media" on public.media
for select to anon, authenticated using (true);

create policy "public read sources" on public.sources
for select to anon, authenticated using (true);

-- User-owned data.
revoke all on table public.users, public.saved_places, public.visited_places,
  public.collections, public.collection_places from anon, authenticated;

grant select, update on table public.users to authenticated;
grant select, insert, delete on table public.saved_places to authenticated;
grant select, insert, update, delete on table public.visited_places to authenticated;
grant select, insert, update, delete on table public.collections to authenticated;
grant select, insert, delete on table public.collection_places to authenticated;

create policy "users read own profile" on public.users
for select to authenticated
using ((select auth.uid()) = id);

create policy "users update own profile" on public.users
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "saved read own" on public.saved_places
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "saved insert own" on public.saved_places
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "saved delete own" on public.saved_places
for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "visited read own" on public.visited_places
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "visited insert own" on public.visited_places
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "visited update own" on public.visited_places
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "visited delete own" on public.visited_places
for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "collections read own" on public.collections
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "collections insert own" on public.collections
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "collections update own" on public.collections
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "collections delete own" on public.collections
for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "collection places read own" on public.collection_places
for select to authenticated
using (
  exists (
    select 1 from public.collections c
    where c.id = collection_id
      and c.user_id = (select auth.uid())
  )
);

create policy "collection places insert own" on public.collection_places
for insert to authenticated
with check (
  exists (
    select 1 from public.collections c
    where c.id = collection_id
      and c.user_id = (select auth.uid())
  )
);

create policy "collection places delete own" on public.collection_places
for delete to authenticated
using (
  exists (
    select 1 from public.collections c
    where c.id = collection_id
      and c.user_id = (select auth.uid())
  )
);
