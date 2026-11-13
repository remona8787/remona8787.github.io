-- v2.0 platform schedules (docs/PLATFORM.md section 6). Run AFTER release/launch/platform-v2.sql and after the
-- moderate-queue Edge Function is deployed with its MODERATION_CRON_SECRET. Safe to run again (same-name jobs are
-- replaced). The platform workflow (.github/workflows/platform.yml, action apply) runs it; or the SQL editor.
-- Vault secrets (names only here; values never in this file):
--   project_url             https://<project ref>.supabase.co (already there if install-six-hour-sync.sql ran)
--   publishable_key         the public client key (same)
--   moderation_cron_secret  must equal the moderate-queue function secret MODERATION_CRON_SECRET
-- Schedules (UTC):
--   aol-moderate-queue     every 5 minutes: rules (and the context classifier when its key is set) on pending items;
--                          nothing is published by it unless platform_settings.auto_approve_text is on (off by default)
--   aol-platform-expire    daily 18:37 (03:37 KST): researcher approvals and grants past their date, old drafts
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;
do $$ begin
 if to_regprocedure('public.platform_expire()') is null then
   raise exception 'Apply release/launch/platform-v2.sql first (it creates public.platform_expire and the moderation queue)';
 end if;
 if (select count(distinct name) from vault.decrypted_secrets where name in ('project_url','publishable_key','moderation_cron_secret') and length(decrypted_secret)>0)<>3 then
   raise exception 'Create the Vault secrets project_url, publishable_key and moderation_cron_secret first';
 end if;
end $$;

select cron.schedule('aol-moderate-queue','*/5 * * * *', $job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/moderate-queue',
  headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='publishable_key'),'x-aol-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='moderation_cron_secret')),
  body := '{}'::jsonb, timeout_milliseconds := 150000
 );
$job$);

select cron.schedule('aol-platform-expire','37 18 * * *', $job$
 select public.platform_expire();
$job$);
commit;
-- Observe: select jobname, status, return_message, start_time from cron.job_run_details d join cron.job j using (jobid)
--  where jobname like 'aol-%' order by start_time desc limit 10;
-- and the function's answers: select status_code, left(content, 200), created from net._http_response order by created desc limit 5;
-- A scheduled request alone is not a successful check: moderation_events (or the console's 회원 활동 검수 tab) shows the result.
