-- Optional but recommended after the Supabase project exists.
-- Creates the public read-only MVP bucket. Initial uploads should be made from the Dashboard,
-- not from the end-user app.

insert into storage.buckets (id, name, public)
values ('place-images', 'place-images', true)
on conflict (id) do update set public = excluded.public;

-- Public read/list through the client for this bucket.
drop policy if exists "public read place-images" on storage.objects;
create policy "public read place-images"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'place-images');

-- No client-side INSERT/UPDATE/DELETE policy is intentionally created in v0.1.
-- Upload curated images through the Supabase Dashboard or trusted backend/service role only.
