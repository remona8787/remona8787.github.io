-- 빛의 건축 v0.10
-- Initial country/city bootstrap: Seoul / Tokyo / New York City
-- Bounding boxes are operational discovery bounds, not legal administrative boundary geometry.

insert into public.countries (
  iso2, iso3, name_en, name_local, continent,
  wikidata_id, centroid_lat, centroid_lng, default_language,
  is_active, metadata
) values
  ('KR','KOR','South Korea','대한민국','Asia','Q884',36.5000000,127.8000000,'ko',true,
   '{"bootstrap":"v0.10","scope":"global-discovery"}'::jsonb),
  ('JP','JPN','Japan','日本','Asia','Q17',36.2048240,138.2529240,'ja',true,
   '{"bootstrap":"v0.10","scope":"global-discovery"}'::jsonb),
  ('US','USA','United States','United States','North America','Q30',39.8283000,-98.5795000,'en',true,
   '{"bootstrap":"v0.10","scope":"global-discovery"}'::jsonb)
on conflict (iso2) do update set
  iso3 = excluded.iso3,
  name_en = excluded.name_en,
  name_local = excluded.name_local,
  continent = excluded.continent,
  wikidata_id = excluded.wikidata_id,
  centroid_lat = excluded.centroid_lat,
  centroid_lng = excluded.centroid_lng,
  default_language = excluded.default_language,
  is_active = excluded.is_active,
  metadata = public.countries.metadata || excluded.metadata,
  updated_at = now();

insert into public.cities (
  country_id, city_code, name_en, name_local, admin_level,
  wikidata_id, timezone,
  centroid_lat, centroid_lng,
  bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng,
  discovery_priority, is_active, metadata
)
select
  co.id, v.city_code, v.name_en, v.name_local, v.admin_level,
  v.wikidata_id, v.timezone,
  v.centroid_lat, v.centroid_lng,
  v.bbox_min_lat, v.bbox_min_lng, v.bbox_max_lat, v.bbox_max_lng,
  v.discovery_priority, true,
  jsonb_build_object(
    'bootstrap','v0.10',
    'bbox_purpose','operational discovery envelope',
    'notes',v.notes
  )
from public.countries co
join (
  values
    (
      'KR','SEOUL','Seoul','서울','special city','Q8684','Asia/Seoul',
      37.5665000::numeric,126.9780000::numeric,
      37.4132940::numeric,126.7340860::numeric,37.7151330::numeric,127.2693110::numeric,
      1,
      'Initial curated market; existing Seoul seed can be matched against discoveries.'
    ),
    (
      'JP','TOKYO','Tokyo','東京','metropolis / core urban discovery area','Q1490','Asia/Tokyo',
      35.6762000::numeric,139.6503000::numeric,
      35.5289840::numeric,139.5621030::numeric,35.8984030::numeric,139.9183910::numeric,
      2,
      'Operational bbox focuses on the central Tokyo urban area for initial validation.'
    ),
    (
      'US','NEWYORK','New York City','New York City','city','Q60','America/New_York',
      40.7128000::numeric,-74.0060000::numeric,
      40.4773990::numeric,-74.2590900::numeric,40.9175770::numeric,-73.7002720::numeric,
      3,
      'Operational bbox covers the five-borough New York City area.'
    )
) as v(
  iso2,city_code,name_en,name_local,admin_level,wikidata_id,timezone,
  centroid_lat,centroid_lng,
  bbox_min_lat,bbox_min_lng,bbox_max_lat,bbox_max_lng,
  discovery_priority,notes
)
  on co.iso2 = v.iso2
on conflict (city_code) do update set
  country_id = excluded.country_id,
  name_en = excluded.name_en,
  name_local = excluded.name_local,
  admin_level = excluded.admin_level,
  wikidata_id = excluded.wikidata_id,
  timezone = excluded.timezone,
  centroid_lat = excluded.centroid_lat,
  centroid_lng = excluded.centroid_lng,
  bbox_min_lat = excluded.bbox_min_lat,
  bbox_min_lng = excluded.bbox_min_lng,
  bbox_max_lat = excluded.bbox_max_lat,
  bbox_max_lng = excluded.bbox_max_lng,
  discovery_priority = excluded.discovery_priority,
  is_active = excluded.is_active,
  metadata = public.cities.metadata || excluded.metadata,
  updated_at = now();

-- Sanity
select
  c.city_code,
  c.name_en,
  co.iso2,
  c.timezone,
  c.discovery_priority,
  c.bbox_min_lat,
  c.bbox_min_lng,
  c.bbox_max_lat,
  c.bbox_max_lng
from public.cities c
join public.countries co on co.id = c.country_id
where c.city_code in ('SEOUL','TOKYO','NEWYORK')
order by c.discovery_priority;
