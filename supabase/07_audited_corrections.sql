-- 빛의 건축 v0.2 — definite audited corrections

-- Galleria WEST official address correction (WEST=343; EAST=407).
update public.places
set address = '서울특별시 강남구 압구정로 343',
    verified_at = date '2026-09-22',
    updated_at = now()
where place_code = 'SEOUL009';

-- Ground Seesaw Seochon has a current provider conflict; hold from launch pending operator confirmation.
update public.places
set is_published = false,
    verified_at = date '2026-09-22',
    updated_at = now()
where place_code = 'SEOUL042';

-- Lotte Town Light remains upcoming.
update public.places
set status = 'upcoming',
    verified_at = date '2026-09-22',
    updated_at = now()
where place_code = 'SEOUL019';

-- DDP Autumn main event ended; keep place as seasonal.
update public.places
set status = 'seasonal',
    verified_at = date '2026-09-22',
    updated_at = now()
where place_code = 'SEOUL006';
