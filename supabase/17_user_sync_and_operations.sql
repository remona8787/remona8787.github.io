-- v0.12 additive migration. Apply after 01..16 (cron templates are optional).
-- Existing relational user tables are preserved. Workspace JSON preserves v0.11 IDs.
begin;
create table if not exists public.user_workspaces (
 user_id uuid primary key references auth.users(id) on delete cascade,
 document jsonb not null default '{"schema":1,"saved":[],"visits":[],"routes":[],"candidates":[],"legacyVisits":{},"preferences":{}}'::jsonb,
 revision bigint not null default 1 check(revision>0),
 updated_at timestamptz not null default now(),
 constraint workspace_size check (octet_length(document::text)<=5242880),
 constraint workspace_shape check (document->>'schema'='1' and jsonb_typeof(document->'saved')='array' and jsonb_typeof(document->'visits')='array' and jsonb_typeof(document->'routes')='array' and jsonb_typeof(document->'candidates')='array')
);
alter table public.user_workspaces enable row level security;
revoke all on public.user_workspaces from anon,authenticated;
grant select on public.user_workspaces to authenticated;
drop policy if exists workspace_owner_read on public.user_workspaces;
create policy workspace_owner_read on public.user_workspaces for select to authenticated using(user_id=(select auth.uid()));
create or replace function public.save_workspace(p_document jsonb,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_row public.user_workspaces; v_key text;
begin
 if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
 if p_expected_revision<0 or p_expected_revision is null then raise exception 'invalid_revision'; end if;
 if p_document is null then raise exception 'invalid_document'; end if;
 if octet_length(p_document::text)>5242880 or p_document->>'schema' is distinct from '1' then raise exception 'invalid_document'; end if;
 foreach v_key in array array['saved','visits','routes','candidates'] loop
  if jsonb_typeof(p_document->v_key) is distinct from 'array' then raise exception 'invalid_array'; end if;
  if jsonb_array_length(p_document->v_key)>5000 then raise exception 'array_too_large'; end if;
 end loop;
 if p_expected_revision=0 then
  insert into public.user_workspaces(user_id,document) values(v_user,p_document) on conflict(user_id) do nothing returning * into v_row;
 else
  update public.user_workspaces set document=p_document,revision=revision+1,updated_at=now()
  where user_id=v_user and revision=p_expected_revision returning * into v_row;
 end if;
 if v_row.user_id is null then return jsonb_build_object('ok',false,'conflict',true); end if;
 return jsonb_build_object('ok',true,'revision',v_row.revision,'updated_at',v_row.updated_at);
end;$$;
revoke all on function public.save_workspace(jsonb,bigint) from public,anon;
grant execute on function public.save_workspace(jsonb,bigint) to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='user_workspaces') then alter publication supabase_realtime add table public.user_workspaces; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='places') then alter publication supabase_realtime add table public.places; end if;
end $$;
alter table public.places add column if not exists city_id uuid references public.cities(id) on delete set null,
 add column if not exists coordinate_source_url text,
 add column if not exists coordinate_review_status text not null default 'unverified',
 add column if not exists coordinate_checked_at timestamptz;
create index if not exists places_city_public on public.places(city_id,is_published);
create table if not exists public.place_submissions(
 id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete cascade,
 title text not null check(length(title) between 1 and 200),source_url text not null check(source_url ~ '^https://'),
 note text not null default '' check(length(note)<=2000),status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now()
);
alter table public.place_submissions enable row level security;
grant select,insert on public.place_submissions to authenticated;
drop policy if exists submissions_owner_read on public.place_submissions;
create policy submissions_owner_read on public.place_submissions for select to authenticated using(user_id=auth.uid());
drop policy if exists submissions_owner_insert on public.place_submissions;
create policy submissions_owner_insert on public.place_submissions for insert to authenticated with check(user_id=auth.uid() and status='pending');
create table if not exists public.admin_change_log(
 id bigint generated always as identity primary key,actor uuid references auth.users(id) on delete set null,
 operation text not null,entity_id text,details jsonb not null default '{}',created_at timestamptz not null default now()
);
alter table public.admin_change_log enable row level security;
revoke all on public.admin_change_log from anon,authenticated;
create or replace function public.admin_set_place(p_id uuid,p_patch jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_app_admin() then raise exception 'admin_required' using errcode='42501'; end if;
 if exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('name_kr','name_en','short_description','expert_description','is_published','verified_at','coordinate_review_status')) then raise exception 'unsupported_field'; end if;
 update public.places set name_kr=coalesce(p_patch->>'name_kr',name_kr),name_en=coalesce(p_patch->>'name_en',name_en),short_description=coalesce(p_patch->>'short_description',short_description),expert_description=coalesce(p_patch->>'expert_description',expert_description),is_published=coalesce((p_patch->>'is_published')::boolean,is_published),verified_at=coalesce((p_patch->>'verified_at')::date,verified_at),coordinate_review_status=coalesce(p_patch->>'coordinate_review_status',coordinate_review_status) where id=p_id;
 if not found then raise exception 'place_not_found'; end if;
 insert into public.admin_change_log(actor,operation,entity_id,details) values(auth.uid(),'place_edit',p_id::text,p_patch);
end;$$;
revoke all on function public.admin_set_place(uuid,jsonb) from public,anon;
grant execute on function public.admin_set_place(uuid,jsonb) to authenticated;
create or replace function public.admin_operations() returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not public.is_app_admin() then raise exception 'admin_required' using errcode='42501'; end if;
 return jsonb_build_object('submissions',(select coalesce(jsonb_agg(t),'[]') from(select * from public.place_submissions order by created_at desc limit 100)t),'changes',(select coalesce(jsonb_agg(t),'[]') from(select * from public.admin_change_log order by created_at desc limit 100)t),'places',(select coalesce(jsonb_agg(t),'[]') from(select id,place_code,name_kr,is_published,verified_at,coordinate_review_status from public.places order by updated_at desc limit 200)t));
end;$$;
revoke all on function public.admin_operations() from public,anon;
grant execute on function public.admin_operations() to authenticated;
commit;
