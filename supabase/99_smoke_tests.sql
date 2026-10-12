-- 빛의 건축 v0.1 smoke test checklist
-- Supabase SQL Editor에서 관리자 권한으로 실행하는 데이터 확인용.
-- 실제 RLS 격리 테스트는 서로 다른 두 Auth 계정으로 클라이언트에서 검증한다.

-- 공개 콘텐츠가 존재하는가
select place_code, name_kr, primary_category
from public.places
where is_published = true
order by case mvp_priority when 'A' then 1 when 'B' then 2 else 3 end, name_kr
limit 10;

-- 검색 RPC
select place_code, name_kr, district
from public.search_places('광화');

-- 큐레이션 목록
select curation_code, title, published_at
from public.curations
where is_published = true
order by published_at desc;

-- 좌표가 채워진 뒤 지도 ready 체크
select count(*) filter (where latitude is not null and longitude is not null) as geocoded,
       count(*) as total
from public.places
where is_published = true;

-- Authenticated-only tests:
-- select * from public.get_my_light_stats();
-- select public.toggle_saved_place('<place uuid>');
-- select * from public.mark_visited_place('<place uuid>', null, null);
