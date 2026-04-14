alter table if exists public.arena_stations
  add column if not exists station_code text,
  add column if not exists provisioning_key_hash text,
  add column if not exists device_token_hash text,
  add column if not exists client_secret_hash text,
  add column if not exists registered_at timestamptz;

create unique index if not exists uq_arena_stations_project_station_code
  on public.arena_stations(point_project_id, lower(station_code))
  where station_code is not null and btrim(station_code) <> '';
