create table if not exists public.arena_games_catalog (
  id uuid primary key default gen_random_uuid(),
  point_project_id uuid not null references public.point_projects(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete set null,
  title text not null,
  logo_url text null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.arena_station_games (
  id uuid primary key default gen_random_uuid(),
  point_project_id uuid not null references public.point_projects(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete set null,
  station_id uuid not null references public.arena_stations(id) on delete cascade,
  game_id uuid not null references public.arena_games_catalog(id) on delete cascade,
  exe_path text not null,
  launch_args text null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (station_id, game_id)
);

create index if not exists idx_arena_games_catalog_project
  on public.arena_games_catalog(point_project_id, sort_order, title);

create index if not exists idx_arena_station_games_station
  on public.arena_station_games(station_id, sort_order);
