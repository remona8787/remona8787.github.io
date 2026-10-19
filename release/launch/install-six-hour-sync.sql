-- Deployment script; NOT applied automatically. Run AFTER backend completion and Edge deployment.
-- Vault secrets: project_url, publishable_key, media_cron_secret.
-- MEDIA_CRON_SECRET on deployed functions must equal the Vault secret.
-- Schedules use UTC; starts correspond to 00/06/12/18 KST plus the listed minute offsets.
-- Place photos: every published place is re-matched against Wikidata each run (one query); up to 60 images
-- are checked per run and unchanged files are not re-downloaded. Discovery/rights jobs stay bounded batches.
-- Nationwide/worldwide places (sync-global-places, needs migrations/20261013000000_discovered_places.sql, which
-- complete-backend.sql includes): every 6 hours the Wikidata branch queries run once for every visitor (phase
-- "places", the time left goes to photo checks); every 3 hours (30 minutes after each place run and 3 hours after
-- that) the photos due are rights-checked with a run of their own (phase "images"), so every photo is re-checked well
-- within the 24 hours its verdict is shown. The result is served by the view public_discovered_places. Both phases share one run
-- lock, and each run finishes within 130 s (Supabase answers a request still open after 150 s with 504).
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;
alter table public.places add column if not exists last_media_discovery_at timestamptz;
create index if not exists places_media_rotation on public.places(last_media_discovery_at nulls first) where is_published=true;
do $$ begin
 if (select count(distinct name) from vault.decrypted_secrets where name in ('project_url','publishable_key','media_cron_secret') and length(decrypted_secret)>0)<>3 then
   raise exception 'Configure all three Vault secrets and deploy Edge Functions first';
 end if;
 if to_regclass('public.discovered_places') is null then
   raise exception 'Apply release/launch/complete-backend.sql first (it creates public.discovered_places for sync-global-places)';
 end if;
end $$;
-- Retire old aol schedules only; leave unrelated jobs alone.
select cron.unschedule(jobid) from cron.job where jobname in
('aol-refresh-media-rights-daily','aol-refresh-cover-cache-weekly','aol-sync-place-media-weekly','aol-discover-city-candidates-daily','aol-discover-city-candidates-maintenance');

select cron.schedule('aol-discovery-6h','3 3,9,15,21 * * *', $job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/discover-city-candidates',
  headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='publishable_key'),'x-aol-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='media_cron_secret')),
  body := '{"limit_cities": 3, "candidate_limit_per_city": 80}'::jsonb, timeout_milliseconds := 20000
 );
$job$);

select cron.schedule('aol-media-discovery-6h','23 3,9,15,21 * * *', $job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/sync-place-media',
  headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='publishable_key'),'x-aol-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='media_cron_secret')),
  body := '{"limit": 60, "candidate_limit": 5}'::jsonb, timeout_milliseconds := 150000
 );
$job$);

select cron.schedule('aol-media-rights-6h','43 3,9,15,21 * * *', $job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/refresh-media-rights',
  headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='publishable_key'),'x-aol-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='media_cron_secret')),
  body := '{"limit": 100}'::jsonb, timeout_milliseconds := 20000
 );
$job$);

select cron.schedule('aol-global-places-6h','53 3,9,15,21 * * *', $job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/sync-global-places',
  headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='publishable_key'),'x-aol-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='media_cron_secret')),
  body := '{"phase": "places", "budget_ms": 130000, "image_limit": 3000}'::jsonb, timeout_milliseconds := 150000
 );
$job$);

select cron.schedule('aol-global-places-images-3h','23 1,4,7,10,13,16,19,22 * * *', $job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/sync-global-places',
  headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='publishable_key'),'x-aol-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='media_cron_secret')),
  body := '{"phase": "images", "budget_ms": 130000, "image_limit": 3000}'::jsonb, timeout_milliseconds := 150000
 );
$job$);

-- Media facade archive (v0.16; needs migrations/20261018000000_media_facade_archive.sql, which complete-backend.sql
-- includes, and the rules of release/launch/archive-seed.sql). archive-collect runs every hour at minute 17: each rule
-- keeps its own cadence and backoff, and one call runs at most 6 due rules. Link and image checks run once a day at
-- 03:20 KST. Pruning (auto-ignored candidates after 30 days, run logs after 180 days) is plain SQL.
do $$ begin
 if to_regclass('public.archive_collection_rules') is null then
   raise exception 'Apply release/launch/complete-backend.sql first (it creates the archive tables for archive-collect)';
 end if;
end $$;

select cron.schedule('aol-archive-collect-hourly','17 * * * *', $job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/archive-collect',
  headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='publishable_key'),'x-aol-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='media_cron_secret')),
  body := '{"max_rules": 6}'::jsonb, timeout_milliseconds := 150000
 );
$job$);

select cron.schedule('aol-archive-check-links-daily','20 18 * * *', $job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/archive-check-links',
  headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='publishable_key'),'x-aol-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='media_cron_secret')),
  body := '{}'::jsonb, timeout_milliseconds := 150000
 );
$job$);

select cron.schedule('aol-archive-prune-daily','47 19 * * *', $job$
 select public.archive_prune();
$job$);
commit;
-- Observe cron.job_run_details AND ingestion_jobs / sync_runs / media_sync_log
-- (sync-global-places: select job_name, status, error_message, metadata->'alerts', metadata->'images' from sync_runs
--  where job_name in ('sync-global-places','sync-global-places-images') order by started_at desc limit 8).
-- (archive: select r.started_at, k.name, r.status, r.fetched, r.new_candidates, r.matched_projects, r.errors from archive_runs r
--  left join archive_collection_rules k on k.id = r.rule_id order by r.started_at desc limit 20; then archive_run_errors.)
-- A queued HTTP request alone is not successful ingestion.
