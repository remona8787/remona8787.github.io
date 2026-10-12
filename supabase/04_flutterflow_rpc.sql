-- 빛의 건축 v0.1
-- FlutterFlow에서 클라이언트 Action을 단순화하기 위한 helper RPC.
-- 01_schema.sql, 02_seed_seoul50.sql 이후 실행.

-- 1) public place search
create or replace function public.search_places(p_query text)
returns setof public.places
language sql
stable
security invoker
set search_path = public
as $$
  select p.*
  from public.places p
  where p.is_published = true
    and (
      coalesce(trim(p_query),'') = ''
      or p.name_kr ilike '%' || trim(p_query) || '%'
      or p.name_en ilike '%' || trim(p_query) || '%'
      or p.district ilike '%' || trim(p_query) || '%'
      or p.primary_category ilike '%' || trim(p_query) || '%'
      or p.short_description ilike '%' || trim(p_query) || '%'
    )
  order by
    case p.mvp_priority when 'A' then 1 when 'B' then 2 else 3 end,
    p.name_kr;
$$;

grant execute on function public.search_places(text) to anon, authenticated;


-- 2) save toggle
create or replace function public.toggle_saved_place(p_place_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_exists boolean;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select exists(
    select 1
    from public.saved_places
    where user_id = v_uid and place_id = p_place_id
  ) into v_exists;

  if v_exists then
    delete from public.saved_places
    where user_id = v_uid and place_id = p_place_id;
    return false;
  else
    insert into public.saved_places(user_id, place_id)
    values (v_uid, p_place_id)
    on conflict (user_id, place_id) do nothing;
    return true;
  end if;
end;
$$;

grant execute on function public.toggle_saved_place(uuid) to authenticated;


-- 3) mark visited / increment visit count
create or replace function public.mark_visited_place(
  p_place_id uuid,
  p_rating smallint default null,
  p_comment text default null
)
returns public.visited_places
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.visited_places;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    raise exception 'rating must be between 1 and 5';
  end if;

  insert into public.visited_places(
    user_id, place_id, first_visited_at, last_visited_at,
    visit_count, rating, comment
  )
  values (
    v_uid, p_place_id, now(), now(), 1, p_rating, p_comment
  )
  on conflict (user_id, place_id)
  do update set
    last_visited_at = now(),
    visit_count = public.visited_places.visit_count + 1,
    rating = coalesce(excluded.rating, public.visited_places.rating),
    comment = coalesce(excluded.comment, public.visited_places.comment)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.mark_visited_place(uuid, smallint, text) to authenticated;


-- 4) My Light Map KPI
create or replace function public.get_my_light_stats()
returns table(
  saved_count bigint,
  visited_place_count bigint,
  district_count bigint,
  total_visit_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with
  s as (
    select count(*)::bigint c
    from public.saved_places
    where user_id = auth.uid()
  ),
  v as (
    select
      count(*)::bigint place_count,
      coalesce(sum(visit_count),0)::bigint total_count
    from public.visited_places
    where user_id = auth.uid()
  ),
  d as (
    select count(distinct p.district)::bigint c
    from public.visited_places vp
    join public.places p on p.id = vp.place_id
    where vp.user_id = auth.uid()
  )
  select s.c, v.place_count, d.c, v.total_count
  from s, v, d;
$$;

grant execute on function public.get_my_light_stats() to authenticated;


-- 5) ordered curation content
create or replace function public.get_curation_places(p_curation_id uuid)
returns table(
  sort_order integer,
  editor_comment text,
  place_id uuid,
  place_code text,
  name_kr text,
  name_en text,
  primary_category text,
  district text,
  short_description text,
  free boolean,
  typical_hours text,
  latitude double precision,
  longitude double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    cp.sort_order, cp.editor_comment,
    p.id, p.place_code, p.name_kr, p.name_en,
    p.primary_category, p.district, p.short_description,
    p.free, p.typical_hours, p.latitude, p.longitude
  from public.curation_places cp
  join public.places p on p.id = cp.place_id
  where cp.curation_id = p_curation_id
    and p.is_published = true
  order by cp.sort_order, p.name_kr;
$$;

grant execute on function public.get_curation_places(uuid) to anon, authenticated;
