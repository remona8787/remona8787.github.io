-- 빛의 건축 v0.10 — Bootstrap audit rows
-- This does NOT perform the HTTP discovery itself.
-- It documents intended initial city order and makes bootstrap scope visible.

insert into public.ingestion_jobs (
  provider, job_name, scope_type, scope_city_id, status, requested_by, metadata
)
select
  'osm_overpass'::public.discovery_provider,
  'bootstrap-planned-' || lower(c.city_code),
  'city',
  c.id,
  'queued',
  'v0.10-bootstrap',
  jsonb_build_object(
    'city_code',c.city_code,
    'run_order',c.discovery_priority,
    'candidate_limit',case c.city_code when 'SEOUL' then 100 when 'TOKYO' then 120 else 120 end,
    'note','Run via discover-city-candidates Edge Function; this row is a bootstrap marker.'
  )
from public.cities c
where c.city_code in ('SEOUL','TOKYO','NEWYORK')
  and not exists (
    select 1 from public.ingestion_jobs j
    where j.job_name = 'bootstrap-planned-' || lower(c.city_code)
  );
