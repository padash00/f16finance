-- Optional station on guest booking (arena PC), validated in API.

alter table public.client_bookings
  add column if not exists arena_station_id uuid null references public.arena_stations(id) on delete set null;

create index if not exists idx_client_bookings_arena_station
  on public.client_bookings(arena_station_id)
  where arena_station_id is not null;
