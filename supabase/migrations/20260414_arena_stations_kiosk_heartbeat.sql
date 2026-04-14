alter table if exists public.arena_stations
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists kiosk_status text;

comment on column public.arena_stations.last_heartbeat_at is 'Последний heartbeat от kiosk-клиента на станции';
comment on column public.arena_stations.kiosk_status is 'Последний статус клиента: online | idle | in_game | offline | ...';
