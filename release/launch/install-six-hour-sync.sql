-- Deployment script; NOT applied automatically. Run AFTER backend completion and Edge deployment.
-- Vault secrets: project_url, publishable_key, media_cron_secret.
-- MEDIA_CRON_SECRET on deployed functions must equal the Vault secret.
-- Schedules use UTC; starts correspond to 00/06/12/18 KST plus the listed minute offsets.
-- Bounded rolling batches; 6-hour invocation is not a promise that the whole world is refreshed.
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
  body := '{"limit": 10}'::jsonb, timeout_milliseconds := 20000
 );
$job$);

select cron.schedule('aol-media-rights-6h','43 3,9,15,21 * * *', $job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/refresh-media-rights',
  headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='publishable_key'),'x-aol-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='media_cron_secret')),
  body := '{"limit": 100}'::jsonb, timeout_milliseconds := 20000
 );
$job$);
commit;
-- Observe cron.job_run_details AND ingestion_jobs / sync_runs / media_sync_log.
-- A queued HTTP request alone is not successful ingestion.
