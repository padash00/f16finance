-- ─────────────────────────────────────────────────────────────────────────
-- Эффективность продавцов: качество данных, деловые события, деньги.
-- ─────────────────────────────────────────────────────────────────────────
-- Четыре вещи, без которых модель либо врёт, либо не доводит дело до конца.
--
-- 1. Деловые события смены (отсутствие товара, акция, смена цен, простой).
--    Кассир не виноват, что не смог продать напиток, которого нет на витрине.
--    События не меняют балл, но роняют уверенность и попадают в объяснение.
--
-- 2. Пометки смен как аномальных. Дубль, сбой кассы, тестовая смена — такие
--    данные не должны формировать норму, с которой сравнивают людей. Исходные
--    записи при этом не трогаются: помечаем, а не удаляем.
--
-- 3. Себестоимость и скидки в свёртке смен — без них нельзя ни посчитать
--    валовую прибыль, ни увидеть продавца, который «делает оборот» скидками.
--
-- 4. Начисленные бонусы. Сменные считаются из плана, а месячный назначается
--    по статусу продавца и должен где-то храниться, чтобы попасть в зарплату.
--
-- Идемпотентна.

-- ── Настройки: месячный бонус ────────────────────────────────────────────
alter table public.store_kpi_settings
  add column if not exists monthly_bonus_strong integer not null default 10000,
  add column if not exists monthly_bonus_top integer not null default 20000;

-- ── Деловые события ──────────────────────────────────────────────────────
create table if not exists public.store_kpi_business_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,

  starts_on date not null,
  ends_on date not null,
  -- null = событие затрагивает обе смены дня.
  shift text null check (shift is null or shift in ('day', 'night')),

  event_type text not null check (event_type in (
    'STOCKOUT', 'PROMOTION', 'PRICE_CHANGE', 'NEW_PRODUCT',
    'TECHNICAL_DOWNTIME', 'PARTIAL_CLOSURE', 'FULL_CLOSURE', 'CUSTOM'
  )),
  title text not null,
  notes text null,

  -- Насколько сильно событие мешало продавать: влияет на уверенность в
  -- оценке, но НЕ на его балл и не на бонусные пороги.
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),

  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint store_kpi_business_events_range check (ends_on >= starts_on)
);

create index if not exists idx_store_kpi_business_events_lookup
  on public.store_kpi_business_events (company_id, starts_on, ends_on);

-- ── Пометки смен ─────────────────────────────────────────────────────────
create table if not exists public.store_kpi_shift_flags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,

  shift_date date not null,
  shift text not null check (shift in ('day', 'night')),

  is_anomaly boolean not null default true,
  -- Исключение из базы сравнения — отдельное решение: смена может быть
  -- странной, но всё равно показательной.
  exclude_from_baseline boolean not null default false,
  reason text not null,
  -- Кто пометил: 'auto' — детектор, 'manual' — человек.
  source text not null default 'manual' check (source in ('auto', 'manual')),

  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint store_kpi_shift_flags_uniq unique (company_id, shift_date, shift),
  constraint store_kpi_shift_flags_reason check (length(btrim(reason)) >= 3)
);

create index if not exists idx_store_kpi_shift_flags_lookup
  on public.store_kpi_shift_flags (company_id, shift_date);

-- ── Начисленные бонусы ───────────────────────────────────────────────────
-- Хранятся именно начисления, а не правила: правила меняются, а то, что
-- человеку уже насчитали за конкретный период, меняться задним числом не
-- должно.
create table if not exists public.store_kpi_bonus_awards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,

  cashier_id uuid not null,
  kind text not null check (kind in ('shift', 'monthly')),
  -- Для сменного бонуса — дата смены, для месячного — первое число месяца.
  period_start date not null,
  shift text null check (shift is null or shift in ('day', 'night')),

  level text not null,
  amount integer not null check (amount >= 0),
  -- Снимок того, из чего бонус получился: балл, статус, пороги.
  details jsonb not null default '{}'::jsonb,

  model_version text not null default 'STORE_KPI_V1',
  approved_by uuid null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),

  constraint store_kpi_bonus_awards_uniq unique (company_id, cashier_id, kind, period_start, shift)
);

create index if not exists idx_store_kpi_bonus_awards_lookup
  on public.store_kpi_bonus_awards (company_id, period_start desc);

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.store_kpi_business_events enable row level security;
alter table public.store_kpi_shift_flags enable row level security;
alter table public.store_kpi_bonus_awards enable row level security;

drop policy if exists "service_role full access store_kpi_business_events" on public.store_kpi_business_events;
create policy "service_role full access store_kpi_business_events" on public.store_kpi_business_events
  to service_role using (true) with check (true);

drop policy if exists "service_role full access store_kpi_shift_flags" on public.store_kpi_shift_flags;
create policy "service_role full access store_kpi_shift_flags" on public.store_kpi_shift_flags
  to service_role using (true) with check (true);

drop policy if exists "service_role full access store_kpi_bonus_awards" on public.store_kpi_bonus_awards;
create policy "service_role full access store_kpi_bonus_awards" on public.store_kpi_bonus_awards
  to service_role using (true) with check (true);

drop trigger if exists trg_store_kpi_business_events_updated_at on public.store_kpi_business_events;
create trigger trg_store_kpi_business_events_updated_at
before update on public.store_kpi_business_events
for each row execute function public.touch_store_kpi_updated_at();

drop trigger if exists trg_store_kpi_shift_flags_updated_at on public.store_kpi_shift_flags;
create trigger trg_store_kpi_shift_flags_updated_at
before update on public.store_kpi_shift_flags
for each row execute function public.touch_store_kpi_updated_at();

-- ── Свёртка смен: себестоимость, скидки и диагностика ────────────────────
-- Себестоимость берётся из закупочной цены товара. Для позиций с техкартой
-- это приближение (настоящая себестоимость складывается из ингредиентов), но
-- для оценки «бонусы против валовой прибыли» его достаточно, и оно честнее,
-- чем считать прибыль равной выручке.
--
-- Функцию приходится удалять: набор возвращаемых колонок расширяется, а
-- `create or replace` менять его не умеет. Данных это не касается — функция
-- ничего не хранит, только читает.
drop function if exists public.store_kpi_shift_facts(uuid, date, date);

create or replace function public.store_kpi_shift_facts(
  p_company_id uuid,
  p_from date,
  p_to date
)
returns table (
  sale_date date,
  shift text,
  cashier_id uuid,
  gross_revenue numeric,
  refunds numeric,
  receipts bigint,
  items numeric,
  lines bigint,
  receipts_2plus bigint,
  receipts_3plus bigint,
  attach_opportunities numeric,
  attach_success numeric,
  cogs numeric,
  discount_amount numeric,
  discounted_receipts bigint,
  unique_skus bigint
)
language sql
stable
as $$
  with sale_lines as (
    select s.id,
           s.sale_date,
           s.shift,
           s.operator_id,
           s.total_amount,
           coalesce(s.discount_amount, 0) + coalesce(s.loyalty_discount_amount, 0) as discount_total,
           coalesce(sum(pi.quantity), 0) as qty,
           coalesce(sum(pi.quantity * coalesce(ii.default_purchase_price, 0)), 0) as line_cost,
           count(pi.id) as line_count,
           array_remove(array_agg(distinct ii.category_id), null) as cats,
           array_remove(array_agg(distinct pi.item_id), null) as item_ids
      from public.point_sales s
      left join public.point_sale_items pi on pi.sale_id = s.id
      left join public.inventory_items ii on ii.id = pi.item_id
     where s.company_id = p_company_id
       and s.sale_date between p_from and p_to
     group by s.id, s.sale_date, s.shift, s.operator_id, s.total_amount,
              s.discount_amount, s.loyalty_discount_amount
  ),
  rules as (
    select source_kind, source_ref, target_kind, target_ref, weight
      from public.store_kpi_cross_sell_rules
     where company_id = p_company_id
       and active
       and source_ref is not null
       and target_ref is not null
  ),
  attach as (
    select sl.id as sale_id,
           sum(r.weight) as opportunities,
           sum(
             case
               when (r.target_kind = 'category' and r.target_ref = any(sl.cats))
                 or (r.target_kind = 'item' and r.target_ref = any(sl.item_ids))
               then r.weight else 0
             end
           ) as success
      from sale_lines sl
      join rules r
        on (r.source_kind = 'category' and r.source_ref = any(sl.cats))
        or (r.source_kind = 'item' and r.source_ref = any(sl.item_ids))
     group by sl.id
  ),
  skus as (
    select sl.sale_date, sl.shift, sl.operator_id, count(distinct x.item_id) as unique_skus
      from sale_lines sl
      cross join lateral unnest(sl.item_ids) as x(item_id)
     group by sl.sale_date, sl.shift, sl.operator_id
  ),
  sales_agg as (
    select sl.sale_date,
           sl.shift,
           sl.operator_id,
           sum(sl.total_amount) as gross_revenue,
           count(*) as receipts,
           sum(sl.qty) as items,
           sum(sl.line_count) as lines,
           count(*) filter (where sl.line_count >= 2) as receipts_2plus,
           count(*) filter (where sl.line_count >= 3) as receipts_3plus,
           coalesce(sum(a.opportunities), 0) as attach_opportunities,
           coalesce(sum(a.success), 0) as attach_success,
           sum(sl.line_cost) as cogs,
           sum(sl.discount_total) as discount_amount,
           count(*) filter (where sl.discount_total > 0) as discounted_receipts
      from sale_lines sl
      left join attach a on a.sale_id = sl.id
     group by sl.sale_date, sl.shift, sl.operator_id
  ),
  returns_agg as (
    select r.return_date, r.shift, r.operator_id, sum(r.total_amount) as amount
      from public.point_returns r
     where r.company_id = p_company_id
       and r.return_date between p_from and p_to
     group by r.return_date, r.shift, r.operator_id
  )
  select sa.sale_date,
         sa.shift,
         sa.operator_id,
         sa.gross_revenue,
         coalesce(ra.amount, 0) as refunds,
         sa.receipts,
         sa.items,
         sa.lines,
         sa.receipts_2plus,
         sa.receipts_3plus,
         sa.attach_opportunities,
         sa.attach_success,
         sa.cogs,
         sa.discount_amount,
         sa.discounted_receipts,
         coalesce(sk.unique_skus, 0) as unique_skus
    from sales_agg sa
    left join returns_agg ra
      on ra.return_date = sa.sale_date
     and ra.shift = sa.shift
     and ra.operator_id is not distinct from sa.operator_id
    left join skus sk
      on sk.sale_date = sa.sale_date
     and sk.shift = sa.shift
     and sk.operator_id is not distinct from sa.operator_id
   order by sa.sale_date, sa.shift;
$$;
