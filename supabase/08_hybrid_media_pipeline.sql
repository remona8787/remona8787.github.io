-- 빛의 건축 v0.8 — Hybrid Media Pipeline
-- Goal:
-- Commons/live discovery -> Supabase Storage cache -> canonical media_assets
-- -> scheduled rights/source refresh -> editorial_review_queue
--
-- Run after 01~07.

create extension if not exists pgcrypto;

alter table public.media_assets
  add column if not exists provider_asset_id text,
  add column if not exists source_file_name text,
  add column if not exists source_sha1 text,
  add column if not exists source_modified_at timestamptz,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb,
  add column if not exists cached_public_url text,
  add column if not exists cached_at timestamptz,
  add column if not exists last_rights_sync_at timestamptz,
  add column if not exists rights_fingerprint text,
  add column if not exists sync_status text not null default 'active',
  add column if not exists review_required boolean not null default false,
  add column if not exists relevance_score numeric(5,2),
  add column if not exists cache_version integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'media_assets_sync_status_check'
  ) then
    alter table public.media_assets
      add constraint media_assets_sync_status_check
      check (sync_status in ('active','pending_review','disabled','error'));
  end if;
end $$;

create unique index if not exists media_assets_provider_asset_uidx
  on public.media_assets(source_provider, provider_asset_id, place_id)
  where provider_asset_id is not null and place_id is not null;

create index if not exists media_assets_refresh_idx
  on public.media_assets(source_provider, last_rights_sync_at)
  where sync_status in ('active','pending_review');

-- Public bucket for cleared cached place imagery.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'place-media-cache',
  'place-media-cache',
  true,
  15728640,
  array['image/jpeg','image/png','image/webp','image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read place media cache" on storage.objects;
create policy "public read place media cache"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'place-media-cache');

-- No client INSERT/UPDATE/DELETE policy on this bucket.
-- Cache writes are server-side Edge Function operations using a secret key.

create or replace view public.public_place_media
with (security_invoker = true)
as
select
  ma.id,
  p.id as place_id,
  p.place_code,
  p.name_kr,
  ma.storage_path,
  ma.cached_public_url,
  ma.source_provider,
  ma.provider_asset_id,
  ma.source_url,
  ma.original_file_url,
  ma.creator,
  ma.copyright_holder,
  ma.license_code,
  ma.license_url,
  ma.attribution_text,
  ma.source_sha1,
  ma.source_modified_at,
  ma.cached_at,
  ma.last_rights_sync_at,
  ma.relevance_score,
  ma.is_cover,
  ma.display_order,
  ma.cache_version
from public.media_assets ma
join public.places p on p.id = ma.place_id
where p.is_published = true
  and ma.asset_kind = 'image'
  and ma.clearance_status = 'cleared'
  and ma.sync_status = 'active'
  and ma.cached_public_url is not null;

grant select on public.public_place_media to anon, authenticated;

-- Internal review view: expose through Dashboard/service role only.
create or replace view public.media_review_queue
as
select
  ma.id,
  p.place_code,
  p.name_kr,
  ma.provider_asset_id,
  ma.source_url,
  ma.original_file_url,
  ma.cached_public_url,
  ma.creator,
  ma.license_code,
  ma.license_url,
  ma.clearance_status,
  ma.sync_status,
  ma.review_required,
  ma.source_sha1,
  ma.source_modified_at,
  ma.last_rights_sync_at,
  ma.relevance_score,
  ma.source_metadata
from public.media_assets ma
join public.places p on p.id = ma.place_id
where ma.review_required = true
   or ma.clearance_status <> 'cleared'
   or ma.sync_status <> 'active';

revoke all on public.media_review_queue from anon, authenticated;

-- Returns cleared cached images by public place code.
create or replace function public.get_place_media_by_code(p_place_code text)
returns setof public.public_place_media
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from public.public_place_media
  where place_code = p_place_code
  order by is_cover desc, display_order asc, relevance_score desc nulls last;
$$;

grant execute on function public.get_place_media_by_code(text) to anon, authenticated;

-- Operational audit.
create table if not exists public.media_sync_log (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid references public.media_assets(id) on delete set null,
  place_id uuid references public.places(id) on delete set null,
  provider text not null,
  action text not null,
  result text not null,
  old_fingerprint text,
  new_fingerprint text,
  old_sha1 text,
  new_sha1 text,
  detail jsonb,
  created_at timestamptz not null default now()
);

alter table public.media_sync_log enable row level security;
revoke all on public.media_sync_log from anon, authenticated;
