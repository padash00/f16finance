-- arena_tech_logs: records of technical compensation given to players
create table if not exists arena_tech_logs (
  id               uuid        primary key default gen_random_uuid(),
  point_project_id uuid        not null references point_projects(id) on delete cascade,
  company_id       uuid        references companies(id) on delete set null,
  station_id       uuid        references arena_stations(id) on delete set null,
  station_name     text,
  reason           text        not null,
  amount           numeric     not null default 0,
  operator_id      uuid        references operators(id) on delete set null,
  created_at       timestamptz not null default now()
);

alter table arena_tech_logs enable row level security;

create policy "point device full access" on arena_tech_logs
  using (true)
  with check (true);

create index on arena_tech_logs (point_project_id, created_at);
