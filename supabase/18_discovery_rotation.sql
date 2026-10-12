-- Apply before deploying v0.12 discover-city-candidates.
alter table public.cities add column if not exists last_discovery_at timestamptz;
create index if not exists cities_discovery_rotation on public.cities(last_discovery_at nulls first,discovery_priority) where is_active=true;
