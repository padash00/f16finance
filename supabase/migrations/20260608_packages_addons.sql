-- Коммерческий конструктор (по deep-research плану): отраслевые пакеты + add-ons.
-- Пакет = именованный набор фич под нишу (Finance/Club/Restaurant/Shop/Service).
-- Add-on = отдельно продаваемый модуль (AI CFO, Telegram, HR Pro, ...).
-- Привязка к организации хранится в organization_packages / organization_addons.
-- Аддитивно; enforcement пока нет (всё в shadow).

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- finance, club, restaurant, shop, service
  name text not null,
  vertical text not null,
  description text null,
  feature_codes text[] not null default '{}',
  price_kzt integer not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.addons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- ai_cfo, telegram, hr_pro, ...
  name text not null,
  description text null,
  feature_codes text[] not null default '{}',
  price_kzt integer not null default 0,
  billing_unit text not null default 'organization' check (billing_unit in ('organization', 'company', 'device')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.organization_packages (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  package_code text not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.organization_addons (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  addon_code text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (organization_id, addon_code)
);

-- ── Стартовый каталог пакетов ──
insert into public.packages (code, name, vertical, description, feature_codes, price_kzt) values
  ('finance', 'Orda Finance', 'finance', 'Контроль владельца поверх любой кассы', array['dashboard.owner','finance.base','finance.pnl'], 9900),
  ('club', 'Orda Club', 'club', 'Клубы и игровые точки', array['dashboard.owner','finance.base','club.pos'], 19900),
  ('restaurant', 'Orda Restaurant', 'restaurant', 'Кафе, бар, пиццерия, dark kitchen', array['dashboard.owner','finance.base','restaurant.recipes_lite'], 24900),
  ('shop', 'Orda Shop', 'shop', 'Магазины и небольшие сети', array['dashboard.owner','finance.base','shop.catalog'], 19900),
  ('service', 'Orda Service', 'service', 'СТО, автомойки, ремонт, сервис', array['dashboard.owner','finance.base','service.jobs'], 16900)
on conflict (code) do nothing;

-- ── Стартовый каталог add-ons ──
insert into public.addons (code, name, description, feature_codes, price_kzt, billing_unit) values
  ('ai_cfo', 'AI CFO', 'Ежедневные разборы, прогнозы, root-cause', array['ai.cfo'], 9900, 'organization'),
  ('telegram', 'Telegram Reports', 'Отчёты и алерты в Telegram', array['telegram.reports'], 3900, 'organization'),
  ('hr_pro', 'HR Pro', 'Формулы зарплат, KPI, labor-cost', array['hr.pro'], 6900, 'company'),
  ('stock_pro', 'Stock Pro', 'Reorder points, ABC/XYZ, supplier variance', array['stock.pro'], 7900, 'company'),
  ('recipes_pro', 'Recipes Pro', 'Полуфабрикаты, batch, yield/waste', array['recipes.pro'], 7900, 'company'),
  ('loyalty', 'Loyalty CRM', 'Бонусы, сегменты, акции', array['loyalty.crm'], 5900, 'organization'),
  ('open_api', 'Open API & Webhooks', 'Интеграции и автоматизация', array['open.api'], 7900, 'organization')
on conflict (code) do nothing;

-- ── RLS (using(true); доступ через server/admin-клиент) ──
alter table public.packages enable row level security;
drop policy if exists packages_all on public.packages;
create policy packages_all on public.packages for all using (true) with check (true);

alter table public.addons enable row level security;
drop policy if exists addons_all on public.addons;
create policy addons_all on public.addons for all using (true) with check (true);

alter table public.organization_packages enable row level security;
drop policy if exists organization_packages_all on public.organization_packages;
create policy organization_packages_all on public.organization_packages for all using (true) with check (true);

alter table public.organization_addons enable row level security;
drop policy if exists organization_addons_all on public.organization_addons;
create policy organization_addons_all on public.organization_addons for all using (true) with check (true);

notify pgrst, 'reload schema';
