-- Entitlement-фундамент (по deep-research плану): каталог фич + company_features.
-- Полностью аддитивно, без destructive-изменений.
--
-- Ключевое: LEGACY-ГРАНТЫ F16 — страховка миграции. Каждой точке F16 выдаётся
-- грант на все фичи (source_type='legacy'). Пока он активен, при включении
-- enforcement у F16 ничего не пропадёт.

-- ── Каталог фич ──
create table if not exists public.features (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- finance.pnl, ai.cfo, restaurant.recipes_lite
  name text not null,
  category text not null check (category in ('core', 'package', 'addon', 'metered')),
  scope text not null default 'organization' check (scope in ('organization', 'company', 'location', 'device')),
  billing_mode text not null default 'subscription' check (billing_mode in ('included', 'subscription', 'metered', 'manual')),
  dependency_codes text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now())
);

-- ── Гранты фич на уровне точки (company) ──
create table if not exists public.company_features (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  feature_id uuid not null references public.features(id) on delete cascade,
  source_type text not null check (source_type in ('plan', 'addon', 'manual', 'trial', 'legacy')),
  source_ref uuid,                            -- ссылка на подписку/addon/grandfathering
  enabled boolean not null default true,
  limit_value numeric,
  starts_at timestamptz not null default timezone('utc', now()),
  ends_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists company_features_company_idx on public.company_features (company_id);
create index if not exists company_features_feature_idx on public.company_features (feature_id);
create unique index if not exists company_features_unique_idx
  on public.company_features (
    company_id, feature_id, source_type,
    coalesce(source_ref, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ── Стартовый каталог фич ──
insert into public.features (code, name, category, scope, billing_mode) values
  ('dashboard.owner', 'Owner dashboard', 'core', 'organization', 'included'),
  ('finance.base', 'Доходы и расходы', 'core', 'organization', 'included'),
  ('finance.pnl', 'P&L и cashflow', 'package', 'organization', 'subscription'),
  ('club.pos', 'Club: POS, смены, операторы', 'package', 'company', 'subscription'),
  ('shop.catalog', 'Shop: каталог, склад, приёмка', 'package', 'company', 'subscription'),
  ('restaurant.recipes_lite', 'Restaurant: техкарты lite', 'package', 'company', 'subscription'),
  ('service.jobs', 'Service: заказы и работы', 'package', 'company', 'subscription'),
  ('ai.cfo', 'AI CFO', 'addon', 'organization', 'subscription'),
  ('telegram.reports', 'Telegram Reports', 'addon', 'organization', 'subscription'),
  ('hr.pro', 'HR Pro', 'addon', 'company', 'subscription'),
  ('stock.pro', 'Stock Pro', 'addon', 'company', 'subscription'),
  ('recipes.pro', 'Recipes Pro', 'addon', 'company', 'subscription'),
  ('loyalty.crm', 'Loyalty CRM', 'addon', 'organization', 'subscription'),
  ('open.api', 'Open API и Webhooks', 'addon', 'organization', 'subscription'),
  ('ai.analysis', 'AI-анализы (metered)', 'metered', 'organization', 'metered'),
  ('ocr.page', 'OCR страниц (metered)', 'metered', 'organization', 'metered')
on conflict (code) do nothing;

-- ── LEGACY-ГРАНТЫ F16: каждой точке F16 — все фичи (идемпотентно) ──
insert into public.company_features (company_id, feature_id, source_type, enabled)
select c.id, f.id, 'legacy', true
from public.companies c
join public.organizations o on o.id = c.organization_id and o.slug = 'f16'
cross join public.features f
where not exists (
  select 1 from public.company_features cf
  where cf.company_id = c.id and cf.feature_id = f.id and cf.source_type = 'legacy'
);

-- ── RLS (using(true); доступ через server/admin-клиент — как у остальных таблиц) ──
alter table public.features enable row level security;
drop policy if exists features_select on public.features;
create policy features_select on public.features for select using (true);

alter table public.company_features enable row level security;
drop policy if exists company_features_all on public.company_features;
create policy company_features_all on public.company_features for all using (true) with check (true);

notify pgrst, 'reload schema';
