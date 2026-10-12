-- 빛의 건축 v0.10 — Bootstrap/Admin smoke tests

select 'countries' as check_name, count(*) as value
from public.countries
where iso2 in ('KR','JP','US');

select 'cities' as check_name, count(*) as value
from public.cities
where city_code in ('SEOUL','TOKYO','NEWYORK');

select
  c.city_code,
  count(ec.id) as candidate_count,
  count(ec.id) filter (where ec.publishing_status='ready') as ready_count,
  round(avg(ec.relevance_score),1) as avg_relevance
from public.cities c
left join public.external_candidates ec on ec.city_id=c.id
where c.city_code in ('SEOUL','TOKYO','NEWYORK')
group by c.city_code
order by c.discovery_priority;

select
  job_name,status,fetched_count,inserted_count,flagged_count,created_at
from public.ingestion_jobs
order by created_at desc
limit 20;

select
  count(*) filter (where matched_place_id is not null) as promoted_candidates,
  count(*) filter (where publishing_status='published') as published_candidates
from public.external_candidates;

select
  count(*) as admin_count
from public.app_admins;
