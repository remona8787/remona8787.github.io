-- 빛의 건축 v0.2 — Cron templates
-- Enable only after Edge Functions and provider credentials exist.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Recommended schedules:
-- TourAPI + Seoul Open Data: every 2~6 hours depending on feed.
-- Ticketmaster events: every 1~6 hours for selected markets.
-- Wikidata enrichment: weekly.
-- Google Places / Foursquare: request-time or targeted refresh by external ID.
-- Cleanup expired live snapshots: daily.

-- Example after you have an authenticated Edge Function:
-- select cron.schedule(
--   'aol-sync-korea-open-data',
--   '17 */6 * * *',
--   $$ select net.http_post(
--      url := 'https://PROJECT.supabase.co/functions/v1/sync-korea-open-data',
--      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer CRON_SECRET'),
--      body := '{"mode":"incremental"}'::jsonb
--   ); $$
-- );
