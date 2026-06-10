-- Настройки модуля «Магазин» на уровне организации.
-- store_company_id — какая точка (company) является магазином.
-- Весь модуль /store/* скоупится на эту точку (склад, витрина, ревизия, смены).

create table if not exists public.store_settings (
  organization_id  uuid primary key references public.organizations(id) on delete cascade,
  store_company_id uuid references public.companies(id) on delete set null,
  updated_at       timestamptz not null default now()
);

-- Доступ только через service-role (admin-клиент в API). Прямого PostgREST-доступа нет.
alter table public.store_settings enable row level security;
