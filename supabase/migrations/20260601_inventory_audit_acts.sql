-- ─────────────────────────────────────────────────────────────────────────────
-- Инвентаризационный аудит-акт (Этап 1)
-- Открытый/закрытый документ ревизии: владелец открывает акт, назначает
-- операторов на секции (категории), операторы считают ВСЛЕПУЮ (не видят
-- системный остаток), владелец закрывает — раскрывается расхождение.
--
-- Снимок ожидаемых остатков фиксируется на момент ОТКРЫТИЯ (inventory_audit_snapshot).
-- Расхождение аудита = counted − snapshot. Итоговый остаток при закрытии
-- считается с учётом продаж за время акта (через стандартный inventory_post_stocktake).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.inventory_audit_acts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete set null,
  location_id uuid not null references public.inventory_locations(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  comment text null,
  opened_at timestamptz not null default timezone('utc', now()),
  opened_by uuid null,
  closed_at timestamptz null,
  closed_by uuid null,
  stocktake_id uuid null,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists inventory_audit_acts_location_idx on public.inventory_audit_acts (location_id, status);
create index if not exists inventory_audit_acts_company_idx on public.inventory_audit_acts (company_id, opened_at desc);

create table if not exists public.inventory_audit_assignments (
  id uuid primary key default gen_random_uuid(),
  act_id uuid not null references public.inventory_audit_acts(id) on delete cascade,
  operator_id uuid not null,
  category_id uuid null references public.inventory_categories(id) on delete set null,
  label text null,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists inventory_audit_assignments_act_idx on public.inventory_audit_assignments (act_id);
create index if not exists inventory_audit_assignments_operator_idx on public.inventory_audit_assignments (operator_id);

create table if not exists public.inventory_audit_snapshot (
  act_id uuid not null references public.inventory_audit_acts(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  expected_qty numeric(14, 3) not null default 0,
  primary key (act_id, item_id)
);

create table if not exists public.inventory_audit_counts (
  id uuid primary key default gen_random_uuid(),
  act_id uuid not null references public.inventory_audit_acts(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  counted_qty numeric(14, 3) not null default 0 check (counted_qty >= 0),
  counted_by uuid null,
  counted_at timestamptz not null default timezone('utc', now()),
  unique (act_id, item_id)
);
create index if not exists inventory_audit_counts_act_idx on public.inventory_audit_counts (act_id);

-- RLS: доступ только через server API (service role обходит RLS).
-- Политик нет — по умолчанию запрещено для anon/authenticated.
alter table public.inventory_audit_acts enable row level security;
alter table public.inventory_audit_assignments enable row level security;
alter table public.inventory_audit_snapshot enable row level security;
alter table public.inventory_audit_counts enable row level security;

notify pgrst, 'reload schema';
