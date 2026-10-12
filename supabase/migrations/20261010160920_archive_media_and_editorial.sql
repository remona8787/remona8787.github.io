-- v0.13 extension; apply only AFTER legacy SQL 01..18. Not executed remotely.
begin;
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
commit;
