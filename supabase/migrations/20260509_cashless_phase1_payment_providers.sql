-- ════════════════════════════════════════════════════════════════════════════
-- Phase 1: Payment providers + cashless aliases
-- ════════════════════════════════════════════════════════════════════════════
-- Цель: подготовка SaaS-системы к мульти-провайдерам (Kaspi/Halyk/Сбер/...).
-- Делаем ДОБАВОЧНО (additive only) — старые kaspi_* колонки остаются работать,
-- параллельно появляются cashless_* как single-source-of-truth.
-- Code migrate в последующих фазах. Старые колонки удалим в Phase 3.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Глобальный список провайдеров платежей (Kaspi, Halyk, generic, ...)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.payment_providers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,           -- 'kaspi', 'halyk', 'sber', 'generic'
  name text not null,                  -- 'Kaspi Bank', 'Halyk Bank', ...
  country_code text null,              -- 'KZ', 'RU', ...
  is_active boolean not null default true,
  -- Поддерживает ли разделение по 00:00 (Kaspi-фича сверки)
  supports_midnight_split boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.payment_providers enable row level security;
drop policy if exists payment_providers_read on public.payment_providers;
create policy payment_providers_read on public.payment_providers for select using (true);

-- Сидим основных провайдеров
insert into public.payment_providers (code, name, country_code, supports_midnight_split)
values
  ('kaspi',   'Kaspi Bank',  'KZ', true),
  ('halyk',   'Halyk Bank',  'KZ', false),
  ('sber',    'Сбербанк',    'RU', false),
  ('generic', 'Универсальный', null, false)
on conflict (code) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Продукты провайдера (Kaspi Gold, Kaspi Red, Kaspi Kredit, Kaspi QR, ...)
-- ────────────────────────────────────────────────────────────────────────────
-- Каждый провайдер имеет свой набор продуктов с дефолтными комиссиями.
-- Компания может переопределить комиссию через company_payment_product_overrides.
create table if not exists public.payment_provider_products (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.payment_providers(id) on delete cascade,
  code text not null,                  -- 'pos', 'online', 'qr', 'gold', 'red', 'kredit'
  name text not null,                  -- 'POS-терминал', 'Online перевод', 'QR', 'Gold', ...
  default_commission_pct numeric(6,3) not null default 0,  -- 0.000 — 999.999
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  unique(provider_id, code)
);

alter table public.payment_provider_products enable row level security;
drop policy if exists payment_provider_products_read on public.payment_provider_products;
create policy payment_provider_products_read on public.payment_provider_products for select using (true);

-- Сидим Kaspi-продукты на основе текущих колонок (kaspi_qr_rate, kaspi_gold_rate, ...)
do $$
declare
  kaspi_id uuid;
begin
  select id into kaspi_id from public.payment_providers where code = 'kaspi';
  if kaspi_id is not null then
    insert into public.payment_provider_products (provider_id, code, name, display_order)
    values
      (kaspi_id, 'pos',     'POS-терминал',     1),
      (kaspi_id, 'online',  'Online перевод',   2),
      (kaspi_id, 'qr',      'QR-оплата',        3),
      (kaspi_id, 'gold',    'Gold карта',       4),
      (kaspi_id, 'red',     'Red карта',        5),
      (kaspi_id, 'kredit',  'Kredit',           6)
    on conflict (provider_id, code) do nothing;
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Привязка компании к провайдеру
-- ────────────────────────────────────────────────────────────────────────────
alter table public.companies
  add column if not exists payment_provider_id uuid references public.payment_providers(id) on delete set null;

comment on column public.companies.payment_provider_id is 'Какой банк/провайдер использует компания (Kaspi, Halyk, ...). Управляет какие продукты и лейблы показывать.';

-- Бэкфилл: все существующие компании = Kaspi (т.к. сейчас у всех пользователей Kaspi)
update public.companies c
set payment_provider_id = (select id from public.payment_providers where code = 'kaspi')
where c.payment_provider_id is null;

create index if not exists companies_payment_provider_id_idx on public.companies(payment_provider_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Per-company overrides комиссий продуктов
-- ────────────────────────────────────────────────────────────────────────────
-- Если у компании отличается комиссия от дефолта провайдера — пишем сюда.
create table if not exists public.company_payment_product_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.payment_provider_products(id) on delete cascade,
  commission_pct numeric(6,3) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(company_id, product_id)
);

alter table public.company_payment_product_rates enable row level security;
drop policy if exists company_payment_product_rates_all on public.company_payment_product_rates;
create policy company_payment_product_rates_all on public.company_payment_product_rates for all using (true) with check (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Бэкфилл per-company комиссий из текущих kaspi_*_rate колонок
-- ────────────────────────────────────────────────────────────────────────────
-- В таблицах есть колонки kaspi_qr_rate, kaspi_gold_rate, kaspi_kredit_rate,
-- kaspi_red_rate. Ищем эти колонки на companies (если есть) и переносим в
-- company_payment_product_rates.
do $$
declare
  kaspi_id uuid;
  qr_id uuid; gold_id uuid; red_id uuid; kredit_id uuid;
  has_qr_col boolean;
  has_gold_col boolean;
  has_red_col boolean;
  has_kredit_col boolean;
begin
  select id into kaspi_id from public.payment_providers where code = 'kaspi';
  if kaspi_id is null then return; end if;

  select id into qr_id     from public.payment_provider_products where provider_id = kaspi_id and code = 'qr';
  select id into gold_id   from public.payment_provider_products where provider_id = kaspi_id and code = 'gold';
  select id into red_id    from public.payment_provider_products where provider_id = kaspi_id and code = 'red';
  select id into kredit_id from public.payment_provider_products where provider_id = kaspi_id and code = 'kredit';

  -- Чек-листы для существующих колонок на companies
  select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'kaspi_qr_rate')     into has_qr_col;
  select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'kaspi_gold_rate')   into has_gold_col;
  select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'kaspi_red_rate')    into has_red_col;
  select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'kaspi_kredit_rate') into has_kredit_col;

  -- Динамические INSERT по существующим колонкам — каждая в отдельном блоке
  if has_qr_col and qr_id is not null then
    execute 'insert into public.company_payment_product_rates (company_id, product_id, commission_pct)
             select id, $1, coalesce(kaspi_qr_rate, 0) from public.companies where kaspi_qr_rate is not null
             on conflict (company_id, product_id) do nothing'
      using qr_id;
  end if;
  if has_gold_col and gold_id is not null then
    execute 'insert into public.company_payment_product_rates (company_id, product_id, commission_pct)
             select id, $1, coalesce(kaspi_gold_rate, 0) from public.companies where kaspi_gold_rate is not null
             on conflict (company_id, product_id) do nothing'
      using gold_id;
  end if;
  if has_red_col and red_id is not null then
    execute 'insert into public.company_payment_product_rates (company_id, product_id, commission_pct)
             select id, $1, coalesce(kaspi_red_rate, 0) from public.companies where kaspi_red_rate is not null
             on conflict (company_id, product_id) do nothing'
      using red_id;
  end if;
  if has_kredit_col and kredit_id is not null then
    execute 'insert into public.company_payment_product_rates (company_id, product_id, commission_pct)
             select id, $1, coalesce(kaspi_kredit_rate, 0) from public.companies where kaspi_kredit_rate is not null
             on conflict (company_id, product_id) do nothing'
      using kredit_id;
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Reload schema cache
-- ────────────────────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';
