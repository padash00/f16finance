-- Add company_id to all arena tables for per-company isolation within a project

alter table public.arena_zones         add column if not exists company_id uuid null;
alter table public.arena_stations      add column if not exists company_id uuid null;
alter table public.arena_tariffs       add column if not exists company_id uuid null;
alter table public.arena_sessions      add column if not exists company_id uuid null;
alter table public.arena_map_decorations add column if not exists company_id uuid null;

create index if not exists arena_zones_company_id_idx          on public.arena_zones(company_id);
create index if not exists arena_stations_company_id_idx       on public.arena_stations(company_id);
create index if not exists arena_tariffs_company_id_idx        on public.arena_tariffs(company_id);
create index if not exists arena_sessions_company_id_idx       on public.arena_sessions(company_id);
create index if not exists arena_map_decorations_company_id_idx on public.arena_map_decorations(company_id);
