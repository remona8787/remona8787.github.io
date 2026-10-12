-- 빛의 건축 v0.1 data audit
-- 관리자용. 실행 결과가 모두 0 또는 기대 개수여야 한다.

select 'places' item, count(*) value from public.places
union all select 'works', count(*) from public.works
union all select 'schedules', count(*) from public.schedules
union all select 'tags', count(*) from public.tags
union all select 'place_tags', count(*) from public.place_tags
union all select 'curations', count(*) from public.curations
union all select 'curation_places', count(*) from public.curation_places
union all select 'sources', count(*) from public.sources;

-- 예상: 50
select count(*) as places_expected_50 from public.places;

-- 예상: 6
select count(*) as curations_expected_6 from public.curations;

-- orphan checks: 모두 0이어야 함.
select count(*) as orphan_works
from public.works w left join public.places p on p.id = w.place_id
where p.id is null;

select count(*) as orphan_curation_places
from public.curation_places cp
left join public.curations c on c.id = cp.curation_id
left join public.places p on p.id = cp.place_id
where c.id is null or p.id is null;

select count(*) as orphan_sources
from public.sources s
left join public.places p on p.id = s.place_id
where s.place_id is not null and p.id is null;

-- 지도 활성화 전에 0이 되어야 함.
select count(*) as places_missing_coordinates
from public.places
where is_published = true
  and (latitude is null or longitude is null);

-- 콘텐츠 재검증 대기 목록.
select place_code, name_kr, status, verification_status, verified_at
from public.places
where verification_status <> 'high'
   or status in ('verify_schedule','verify_current_program','between_exhibitions','active_or_verify')
order by mvp_priority, name_kr;
