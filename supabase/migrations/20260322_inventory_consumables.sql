-- 1. Добавить item_type в inventory_items
alter table public.inventory_items
  add column if not exists item_type text not null default 'product'
  check (item_type in ('product', 'consumable'));

-- 2. Нормы потребления
create table if not exists public.inventory_consumption_norms (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  location_id uuid not null references public.inventory_locations(id) on delete cascade,
  monthly_qty numeric(14,3) not null check (monthly_qty > 0),
  alert_days integer not null default 14,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(item_id, location_id)
);

-- 3. Лимиты по точкам
create table if not exists public.inventory_point_limits (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  monthly_limit_qty numeric(14,3) not null check (monthly_limit_qty > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(item_id, company_id)
);

-- 4. Расширить статусы и поля inventory_requests
alter table public.inventory_requests
  add column if not exists request_type text not null default 'stock'
    check (request_type in ('stock', 'consumable')),
  add column if not exists issued_at timestamptz null,
  add column if not exists issued_by uuid null,
  add column if not exists received_at timestamptz null,
  add column if not exists received_qty_confirmed numeric(14,3) null,
  add column if not exists received_photo_url text null;

alter table public.inventory_requests
  drop constraint if exists inventory_requests_status_check;

alter table public.inventory_requests
  add constraint inventory_requests_status_check
  check (status in ('new','approved_full','approved_partial','rejected','issued','received','disputed'));
