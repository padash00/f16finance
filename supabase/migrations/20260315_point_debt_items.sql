create table if not exists public.point_debt_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  operator_id uuid null references public.operators(id) on delete set null,
  point_device_id uuid not null references public.point_devices(id) on delete cascade,
  client_name text not null,
  item_name text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  total_amount numeric(12, 2) not null default 0 check (total_amount >= 0),
  comment text null,
  week_start date not null,
  source text not null default 'point-client',
  local_ref text null,
  status text not null default 'active' check (status in ('active', 'deleted')),
  created_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz null
);

create index if not exists idx_point_debt_items_company_status_created
  on public.point_debt_items(company_id, status, created_at desc);

create index if not exists idx_point_debt_items_operator_week
  on public.point_debt_items(operator_id, week_start);

create unique index if not exists idx_point_debt_items_device_local_ref
  on public.point_debt_items(point_device_id, local_ref)
  where local_ref is not null;
