-- Arena visual map: grid positions for zones, stations, and decorative elements.
-- Grid is 20×20 cells. Null positions mean the item is not placed on the map.

alter table public.arena_stations
  add column if not exists grid_x integer null,
  add column if not exists grid_y integer null;

alter table public.arena_zones
  add column if not exists grid_x integer null,
  add column if not exists grid_y integer null,
  add column if not exists grid_w integer not null default 4,
  add column if not exists grid_h integer not null default 4,
  add column if not exists color text null;

create table if not exists public.arena_map_decorations (
  id          uuid        primary key default gen_random_uuid(),
  point_project_id uuid   not null references public.point_projects(id) on delete cascade,
  type        text        not null default 'label',  -- 'label', 'sofa', 'wall', 'entrance', 'arrow'
  grid_x      integer     not null default 0,
  grid_y      integer     not null default 0,
  grid_w      integer     not null default 1,
  grid_h      integer     not null default 1,
  label       text        null,
  rotation    integer     not null default 0,        -- 0, 90, 180, 270
  created_at  timestamptz not null default now()
);

create index if not exists idx_arena_map_decorations_project
  on public.arena_map_decorations(point_project_id);
