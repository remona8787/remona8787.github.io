-- v0.15 server-side nationwide/worldwide place sync (Edge Function sync-global-places: places every 6 hours, photo
-- checks every 3 hours). The Wikidata branch queries run ONCE per run on the server instead of in every visitor's
-- browser; the app reads the result from public.public_discovered_places (one REST request) and falls back to its own
-- browser sync when the server has no rows. Re-runnable, also over the first released version of this file: apply
-- after the legacy SQL 01..18 and 20261010160920 (also part of release/launch/complete-backend.sql).
--
-- Access: RLS is on and there is no policy for anon/authenticated, and they hold no privilege on the table: clients read
-- only through the view, which hides rows the sync has not seen for 72 hours and photo verdicts older than 24 hours
-- (the same limits as the browser sync). Only service_role (the Edge Function) writes, through the functions below.
-- The view deliberately runs with its owner's rights (security_invoker = false) so that it is the only way in; the
-- Supabase Security Advisor lists it as a "security definer view" for that reason (see release/launch/LAUNCH.md).
--
-- Editorial overrides (lasting; the sync never sets or clears them), set in the SQL Editor:
--   place_block: the place is not in the view at all.
--   image_block: the place's photo is shown as blocked ('editorial_block'), whatever file Wikidata names now or later;
--     its verdicts are neither re-checked nor replaced by the sync.
-- A row with either is never deleted by prune_discovered_places, so the override survives the place dropping out of
-- Wikidata and coming back.
begin;
create table if not exists public.discovered_places(
 qid text primary key check(qid ~ '^Q[0-9]+$'),
 scope text not null check(scope in ('korea','world')),
 -- The app's compact place record (compactPlaces in edge-functions/_shared/global-places.mjs): a positional array whose
 -- first element is the QID. Branch indexes inside it are only valid for the same code version: "branches" is the
 -- authoritative list.
 record jsonb not null check(jsonb_typeof(record)='array' and record->>0=qid),
 primary_category text not null check(primary_category in ('Media Facade','Light Art','Media Art','Festival','Exhibition','Architectural Lighting','Public Art','Nightscape')),
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 sitelinks integer not null default 0 check(sitelinks>=0),
 branches text[] not null default '{}',
 -- Wikidata P18 file name (Commons), NULL when the item has none.
 image_file text check(image_file is null or length(image_file) between 1 and 240),
 image_status text not null default 'none' check(image_status in ('none','pending','cleared','blocked')),
 image_reasons text[] not null default '{}',
 -- Rights-cleared, attributed rows (live-media.mjs toMediaRow shape); empty unless image_status is 'cleared'.
 media jsonb not null default '[]' check(jsonb_typeof(media)='array'),
 media_checked_at timestamptz,
 -- MEDIA_KR_FOP_DISPLAY policy the verdict was made under (a changed policy makes the photo due again).
 media_kr_fop boolean,
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 synced_at timestamptz not null default now(),
 check((image_status='none')=(image_file is null)),
 check(image_status='cleared' or media='[]'::jsonb),
 check(image_status<>'cleared' or jsonb_array_length(media)>0)
);
-- The editorial overrides: the reason (e.g. "rights complaint 2026-10-17, ticket 12"); NULL = none. The reason itself is
-- never shown to visitors.
alter table public.discovered_places add column if not exists place_block text check(place_block is null or length(btrim(place_block)) between 1 and 500);
alter table public.discovered_places add column if not exists image_block text check(image_block is null or length(btrim(image_block)) between 1 and 500);
create index if not exists discovered_places_last_seen on public.discovered_places(last_seen_at);
create index if not exists discovered_places_media_due on public.discovered_places(media_checked_at nulls first) where image_file is not null;
alter table public.discovered_places enable row level security;
revoke all on public.discovered_places from public,anon,authenticated;
grant all on public.discovered_places to service_role;

-- One sync run at a time (both phases take job 'sync-global-places'): see claim_discovered_sync.
create table if not exists public.discovered_sync_locks(
 job_name text primary key check(length(job_name) between 1 and 100),
 owner text not null check(length(owner) between 1 and 100),
 locked_at timestamptz not null default now(),
 expires_at timestamptz not null
);
alter table public.discovered_sync_locks enable row level security;
revoke all on public.discovered_sync_locks from public,anon,authenticated;
grant all on public.discovered_sync_locks to service_role;

create or replace view public.public_discovered_places with (security_invoker=false) as
select d.qid,d.scope,d.record,d.branches,d.primary_category,d.latitude,d.longitude,d.sitelinks,d.image_file,
 case when d.image_file is null then 'none'
      when d.image_block is not null then 'blocked'
      when d.image_status in ('cleared','blocked') and d.media_checked_at>now()-interval '24 hours' then d.image_status
      else 'pending' end as image_status,
 case when d.image_file is null then '{}'::text[]
      when d.image_block is not null then array['editorial_block']
      when d.image_status='blocked' and d.media_checked_at>now()-interval '24 hours' then d.image_reasons
      else '{}'::text[] end as image_reasons,
 case when d.image_block is null and d.image_status='cleared' and d.media_checked_at>now()-interval '24 hours' then d.media else '[]'::jsonb end as media,
 -- An editorial block is a current verdict at every read, so it also replaces a verdict a browser still holds.
 case when d.image_file is not null and d.image_block is not null then now() else d.media_checked_at end as media_checked_at,
 d.first_seen_at,d.last_seen_at,d.synced_at
from public.discovered_places d
where d.last_seen_at>now()-interval '72 hours' and d.place_block is null;
-- Supabase grants new views to anon/authenticated by default; a view with its owner's rights must be read-only for them.
revoke all on public.public_discovered_places from public,anon,authenticated;
grant select on public.public_discovered_places to anon,authenticated,service_role;

-- Takes the run lock p_job for p_lease_seconds (at most an hour) unless another run holds one that has not expired;
-- p_force takes it anyway. Returns {"ok": true, "owner"} or {"ok": false, "owner", "locked_at", "expires_at"} (the
-- holder). Atomic: concurrent claims serialize on the primary key, so exactly one of them gets a free lock. (A session
-- advisory lock would not hold: every PostgREST request runs in its own transaction on a pooled connection.)
create or replace function public.claim_discovered_sync(p_job text,p_owner text,p_lease_seconds integer,p_force boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare got text; held record;
begin
 if coalesce(length(p_job),0) not between 1 and 100 or coalesce(length(p_owner),0) not between 1 and 100 then
  raise exception 'p_job and p_owner are required';
 end if;
 insert into public.discovered_sync_locks as l(job_name,owner,locked_at,expires_at)
 values(p_job,p_owner,now(),now()+make_interval(secs=>greatest(1,least(coalesce(p_lease_seconds,0),3600))))
 on conflict(job_name) do update set owner=excluded.owner,locked_at=excluded.locked_at,expires_at=excluded.expires_at
  where l.expires_at<=now() or l.owner=excluded.owner or coalesce(p_force,false)
 returning l.owner into got;
 if got is not null then return jsonb_build_object('ok',true,'owner',got); end if;
 select x.owner,x.locked_at,x.expires_at into held from public.discovered_sync_locks x where x.job_name=p_job;
 return jsonb_build_object('ok',false,'owner',held.owner,'locked_at',held.locked_at,'expires_at',held.expires_at);
end $$;

-- Gives the lock back; only its owner can (a run whose lock a forced run took releases nothing).
create or replace function public.release_discovered_sync(p_job text,p_owner text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 delete from public.discovered_sync_locks where job_name=p_job and owner=p_owner;
 return found;
end $$;

-- Upserts one batch of places seen by a run. A changed P18 file resets the photo verdict to 'pending'; an unchanged
-- one keeps its verdict. first_seen_at and the editorial overrides are never changed. A row a newer run already wrote
-- (later last_seen_at) is left alone, so a slower, older run that overlaps it cannot put back older data.
create or replace function public.apply_discovered_places(p_rows jsonb,p_seen_at timestamptz)
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'p_rows must be a JSON array'; end if;
 insert into public.discovered_places as d(qid,scope,record,primary_category,latitude,longitude,sitelinks,branches,image_file,image_status,first_seen_at,last_seen_at,synced_at)
 select distinct on (r.qid) r.qid,r.scope,r.record,r.primary_category,r.latitude,r.longitude,coalesce(r.sitelinks,0),coalesce(r.branches,'{}'),
  nullif(r.image_file,''),case when nullif(r.image_file,'') is null then 'none' else 'pending' end,p_seen_at,p_seen_at,now()
 from jsonb_to_recordset(p_rows) as r(qid text,scope text,record jsonb,primary_category text,latitude double precision,longitude double precision,sitelinks integer,branches text[],image_file text)
 order by r.qid
 on conflict(qid) do update set
  scope=excluded.scope,record=excluded.record,primary_category=excluded.primary_category,latitude=excluded.latitude,longitude=excluded.longitude,
  sitelinks=excluded.sitelinks,branches=excluded.branches,last_seen_at=excluded.last_seen_at,synced_at=now(),
  image_file=excluded.image_file,
  image_status=case when excluded.image_file is not distinct from d.image_file then d.image_status else excluded.image_status end,
  image_reasons=case when excluded.image_file is not distinct from d.image_file then d.image_reasons else '{}'::text[] end,
  media=case when excluded.image_file is not distinct from d.image_file then d.media else '[]'::jsonb end,
  media_checked_at=case when excluded.image_file is not distinct from d.image_file then d.media_checked_at end,
  media_kr_fop=case when excluded.image_file is not distinct from d.image_file then d.media_kr_fop end
 where d.last_seen_at<=excluded.last_seen_at;
 get diagnostics n=row_count;
 return n;
end $$;

-- After a run: removes the places it did not see, except those a failed branch may have returned (they stay until
-- that branch answers again; the view hides them after 72 hours) and those with an editorial override. Anything else
-- unseen for 30 days goes regardless.
create or replace function public.prune_discovered_places(p_seen_at timestamptz,p_failed_branches text[] default '{}')
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 delete from public.discovered_places d
 where d.last_seen_at<p_seen_at and d.place_block is null and d.image_block is null
  and (not (d.branches && coalesce(p_failed_branches,'{}'::text[])) or d.last_seen_at<p_seen_at-interval '30 days');
 get diagnostics n=row_count;
 return n;
end $$;

-- Places stored per branch id ({"korea:classes": 44, …}), over the rows seen in the 72 hours before p_seen_at (the
-- rows the view still shows). A place run reads it before it writes: a branch that answers with less than half of its
-- count is treated as failed for pruning (global-places-server.mjs droppedBranches). Rows unseen for 72 hours no
-- longer count, so a real, lasting drop is accepted by the first run after that.
create or replace function public.discovered_branch_counts(p_seen_at timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(x.branch,x.n),'{}'::jsonb)
 from (
  select b.branch,count(*)::integer n
  from public.discovered_places d cross join lateral unnest(d.branches) as b(branch)
  where d.last_seen_at>p_seen_at-interval '72 hours'
  group by b.branch
 ) x
$$;

-- Photos to rights-check next, as one JSON array [{qid, image_file}]: never checked first, then those checked under
-- another FoP policy, then the oldest verdicts (more-linked places first). Only places the view still shows, never a
-- place or photo with an editorial override.
create or replace function public.discovered_images_due(p_limit integer,p_checked_before timestamptz,p_kr_fop boolean)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('qid',q.qid,'image_file',q.image_file) order by q.ord,q.checked nulls first,q.sitelinks desc,q.qid),'[]'::jsonb)
 from (
  select d.qid,d.image_file,d.media_checked_at checked,d.sitelinks,
   case when d.media_checked_at is null then 0 when d.media_kr_fop is distinct from p_kr_fop then 1 else 2 end ord
  from public.discovered_places d
  where d.image_file is not null and d.last_seen_at>now()-interval '72 hours'
   and d.place_block is null and d.image_block is null
   and (d.media_checked_at is null or d.media_checked_at<p_checked_before or d.media_kr_fop is distinct from p_kr_fop)
  order by ord,checked nulls first,d.sitelinks desc,d.qid
  limit greatest(0,least(coalesce(p_limit,0),20000))
 ) q
$$;

-- Stores rights verdicts [{qid, image_file, status: 'cleared'|'blocked', reasons, media}] made at p_checked_at.
-- Ignored: a verdict for a file the place no longer uses, for a place or photo with an editorial override, or one
-- older than the verdict already stored (an older, overlapping run).
create or replace function public.set_discovered_media(p_rows jsonb,p_checked_at timestamptz,p_kr_fop boolean)
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'p_rows must be a JSON array'; end if;
 update public.discovered_places d set
  image_status=r.status,
  image_reasons=case when r.status='blocked' then coalesce(r.reasons,'{}') else '{}'::text[] end,
  media=case when r.status='cleared' then r.media else '[]'::jsonb end,
  media_checked_at=p_checked_at,media_kr_fop=p_kr_fop,synced_at=now()
 from (select distinct on (x.qid) x.* from jsonb_to_recordset(p_rows) as x(qid text,image_file text,status text,reasons text[],media jsonb) order by x.qid) r
 where d.qid=r.qid and d.image_file=r.image_file and r.status in ('cleared','blocked')
  and d.place_block is null and d.image_block is null
  and (d.media_checked_at is null or d.media_checked_at<=p_checked_at)
  and (r.status='blocked' or (jsonb_typeof(r.media)='array' and jsonb_array_length(r.media)>0));
 get diagnostics n=row_count;
 return n;
end $$;

revoke all on function public.apply_discovered_places(jsonb,timestamptz),public.prune_discovered_places(timestamptz,text[]),
 public.discovered_images_due(integer,timestamptz,boolean),public.set_discovered_media(jsonb,timestamptz,boolean),
 public.discovered_branch_counts(timestamptz),public.claim_discovered_sync(text,text,integer,boolean),public.release_discovered_sync(text,text) from public,anon,authenticated;
grant execute on function public.apply_discovered_places(jsonb,timestamptz),public.prune_discovered_places(timestamptz,text[]),
 public.discovered_images_due(integer,timestamptz,boolean),public.set_discovered_media(jsonb,timestamptz,boolean),
 public.discovered_branch_counts(timestamptz),public.claim_discovered_sync(text,text,integer,boolean),public.release_discovered_sync(text,text) to service_role;
commit;
