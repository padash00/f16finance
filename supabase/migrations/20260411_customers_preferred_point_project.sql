-- Customer self-registration can specify company + point project (station-enabled point).

alter table public.customers
  add column if not exists preferred_point_project_id uuid null references public.point_projects(id) on delete set null;

create index if not exists customers_preferred_point_project_idx
  on public.customers(preferred_point_project_id);
