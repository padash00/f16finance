alter table if exists public.arena_stations
  add column if not exists device_ip text,
  add column if not exists device_mac text;

create index if not exists idx_arena_stations_device_ip
  on public.arena_stations(device_ip)
  where device_ip is not null;

create index if not exists idx_arena_stations_device_mac
  on public.arena_stations(device_mac)
  where device_mac is not null;

create unique index if not exists uq_arena_stations_project_device_ip
  on public.arena_stations(point_project_id, lower(device_ip))
  where device_ip is not null and btrim(device_ip) <> '';

create unique index if not exists uq_arena_stations_project_device_mac
  on public.arena_stations(point_project_id, replace(upper(device_mac), '-', ':'))
  where device_mac is not null and btrim(device_mac) <> '';
