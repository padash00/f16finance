-- Симулятор выручки клуба: зоны и тарифы.
--
-- Идея: пользователь знает СТРУКТУРУ (зоны, кол-во устройств, тарифы и цены)
-- и общую выручку клуба (её система берёт из incomes сама). Симулятор считает
-- потенциал выручки по зонам и сравнивает с фактом.
--
-- Конфиг небольшой, правится редко — храним как обычные таблицы, скоупим по
-- организации и точке (company_id).

create table if not exists public.simulation_tariffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete cascade,
  name text not null,
  paid_hours numeric(6, 2) not null default 0 check (paid_hours >= 0),
  bonus_hours numeric(6, 2) not null default 0 check (bonus_hours >= 0),
  price numeric(12, 2) not null default 0 check (price >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists simulation_tariffs_company_idx
  on public.simulation_tariffs (company_id, sort_order);

create table if not exists public.simulation_zones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete cascade,
  name text not null,
  device_type text not null default 'pc',
  device_count integer not null default 0 check (device_count >= 0),
  assumed_occupancy_hours numeric(6, 2) not null default 0 check (assumed_occupancy_hours >= 0),
  -- Микс тарифов: [{ "tariff_id": uuid, "share_pct": number }]
  tariff_mix jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists simulation_zones_company_idx
  on public.simulation_zones (company_id, sort_order);

-- RLS: чтение — authenticated в рамках своей организации; запись — service-role
-- (admin client в API).
alter table public.simulation_tariffs enable row level security;
drop policy if exists simulation_tariffs_select_same_org on public.simulation_tariffs;
create policy simulation_tariffs_select_same_org
on public.simulation_tariffs
for select
to authenticated
using (public.can_access_organization(organization_id));

alter table public.simulation_zones enable row level security;
drop policy if exists simulation_zones_select_same_org on public.simulation_zones;
create policy simulation_zones_select_same_org
on public.simulation_zones
for select
to authenticated
using (public.can_access_organization(organization_id));

notify pgrst, 'reload schema';
