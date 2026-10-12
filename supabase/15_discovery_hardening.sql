-- 빛의 건축 v0.10 — Discovery hardening
-- Re-apply corrected functions if v0.9 was already installed.

create or replace function public.assign_duplicate_cluster(
  p_candidate_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_key text;
  v_cluster_id uuid;
begin
  select * into c
  from public.external_candidates
  where id = p_candidate_id;

  if not found then
    raise exception 'Candidate not found: %', p_candidate_id;
  end if;

  v_key := public.normalize_candidate_key(c.name, c.lat, c.lng);

  insert into public.duplicate_clusters (city_id, normalized_key, member_count)
  values (c.city_id, v_key, 0)
  on conflict (city_id, normalized_key) do update
    set updated_at = now()
  returning id into v_cluster_id;

  if c.duplicate_cluster_id is distinct from v_cluster_id then
    update public.external_candidates
    set duplicate_cluster_id = v_cluster_id,
        updated_at = now()
    where id = p_candidate_id;
  end if;

  update public.duplicate_clusters dc
  set member_count = (
    select count(*) from public.external_candidates ec
    where ec.duplicate_cluster_id = dc.id
  ),
  updated_at = now()
  where dc.id = v_cluster_id;

  return v_cluster_id;
end;
$$;

create or replace view public.global_candidates_admin as
select
  ec.id,
  ec.name,
  ec.name_local,
  c.city_code,
  c.name_en as city_name_en,
  co.iso2 as country_iso2,
  co.name_en as country_name_en,
  ec.candidate_type,
  ec.category_tags,
  ec.lat,
  ec.lng,
  ec.website_url,
  ec.discovery_stage,
  ec.publishing_status,
  ec.relevance_score,
  ec.confidence_score,
  ec.auto_publish_eligible,
  ec.primary_provider,
  ec.external_primary_id,
  ec.image_candidate_count,
  ec.duplicate_cluster_id,
  ec.matched_place_id,
  ec.last_seen_at,
  ec.reviewed_at,
  ec.rejected_reason
from public.external_candidates ec
left join public.cities c on c.id = ec.city_id
left join public.countries co on co.id = c.country_id;

revoke all on public.global_candidates_admin from anon, authenticated;

create or replace function public.promote_candidate_to_place(
  p_candidate_id uuid,
  p_place_code text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_place_id uuid;
  v_place_code text;
  v_category text;
  v_city_name text;
begin
  select ec.*, ci.name_en as city_name
  into c
  from public.external_candidates ec
  left join public.cities ci on ci.id = ec.city_id
  where ec.id = p_candidate_id;

  if not found then
    raise exception 'Candidate not found';
  end if;

  if c.matched_place_id is not null then
    return c.matched_place_id;
  end if;

  v_place_code := coalesce(
    nullif(trim(p_place_code),''),
    'AUTO-' || upper(substr(replace(c.id::text,'-',''),1,10))
  );

  v_category := case
    when c.candidate_type in ('Media Facade','Media Art','Immersive','Light Art','Architecture')
      then c.candidate_type
    else 'Architecture'
  end;

  v_city_name := coalesce(c.city_name, 'Global');

  insert into public.places (
    place_code,
    name_kr,
    name_en,
    primary_category,
    secondary_categories,
    short_description,
    description,
    expert_description,
    why_it_matters,
    address,
    district,
    latitude,
    longitude,
    status,
    operational_mode,
    website,
    source_url,
    source_publisher,
    verification_status,
    mvp_priority,
    geocode_status,
    is_published
  ) values (
    v_place_code,
    coalesce(nullif(c.name_local,''), c.name),
    c.name,
    v_category,
    coalesce(c.category_tags, array[]::text[]),
    coalesce(c.short_description, c.name),
    coalesce(c.short_description, c.name),
    'Global Discovery Engine에서 자동 수집된 후보입니다. 편집 검토 후 전문가 해설을 보강하세요.',
    '자동 탐색 후보를 canonical place로 승격했습니다. 공개 전 편집 검토가 필요합니다.',
    c.address_text,
    v_city_name,
    c.lat,
    c.lng,
    'verify_current_program',
    'global-discovery',
    c.website_url,
    c.website_url,
    c.primary_provider::text,
    'low',
    'C',
    case when c.lat is not null and c.lng is not null then 'verified' else 'needs_geocoding' end,
    false
  )
  returning id into v_place_id;

  update public.external_candidates
  set matched_place_id = v_place_id,
      discovery_stage = 'published',
      publishing_status = 'published',
      reviewed_at = now(),
      reviewed_by = current_user,
      updated_at = now()
  where id = p_candidate_id;

  return v_place_id;
end;
$$;

grant execute on function public.promote_candidate_to_place(uuid, text) to authenticated;

-- Admin SQL (13) subsequently revokes direct promotion access from normal authenticated users.
