-- ─────────────────────────────────────────────────────────────────────────
-- Эффективность продавцов магазина, фаза 1: настройки и правила допродаж.
-- ─────────────────────────────────────────────────────────────────────────
-- Модуль отвечает на один вопрос: касса просела из-за потока клиентов или
-- из-за продавца. Сами метрики считаются на лету из point_sales /
-- point_sale_items / point_returns (как это уже делает /performance по
-- incomes) — снапшоты смен появятся вместе с кроном в следующей фазе.
--
-- Здесь только то, что нельзя вывести из данных и что владелец обязан задать
-- руками:
--   * какая точка-клуб служит прокси потока (SENET чисел посетителей не даёт,
--     поэтому потоком считается выручка клуба за ту же смену; связать магазин
--     с клубом автоматически нельзя — это разные company_id);
--   * пороги и веса модели (их придётся калибровать по факту, а калибровать
--     правкой кода и деплоем — плохая идея);
--   * правила допродаж вида «взяли рамен — предложи напиток» (категории у
--     каждой точки свои, зашивать их в код нельзя).
--
-- Скоуп арендатора: organization_id + company_id на обеих таблицах, доступ
-- только под service_role — API сам режет по организации.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.store_kpi_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Точка-магазин, к которой относятся настройки.
  company_id uuid not null references public.companies(id) on delete cascade,

  -- Точка-клуб, чья выручка = прокси потока. null — считаем без потока:
  -- метрики «на 1000 ₸ клуба» отключаются, уверенность падает.
  club_company_id uuid null references public.companies(id) on delete set null,

  -- Летние месяцы. Остальное — учебный сезон. Массив, а не два числа: у точки
  -- в другом городе граница каникул может отличаться.
  summer_months smallint[] not null default '{6,7,8}',

  -- Меньше этого числа наблюдений в сегменте — спускаемся на уровень грубее.
  min_sample_size smallint not null default 8,
  -- Меньше этого числа смен у продавца — статус «недостаточно данных».
  min_qualifying_shifts smallint not null default 6,
  -- Меньше этого числа чеков в смене — вниз идёт уверенность, а не балл.
  min_receipts_for_full_score smallint not null default 20,

  -- Границы отношения факт/ожидание: одна аномалия не должна решать всё.
  ratio_clip_min numeric(4,2) not null default 0.70,
  ratio_clip_max numeric(4,2) not null default 1.30,

  -- Веса метрик: { "revenue_per_club": 0.25, ... }. Недоступные метрики
  -- перевзвешиваются в коде, обнулять их нельзя.
  weights jsonb not null default '{
    "revenue_per_club": 0.25,
    "receipts_per_club": 0.20,
    "avg_ticket": 0.20,
    "items_per_receipt": 0.15,
    "attach_rate": 0.15,
    "product_knowledge": 0.05
  }'::jsonb,

  -- Границы статусов продавца по баллу.
  status_needs_training_below numeric(4,2) not null default 0.90,
  status_strong_from numeric(4,2) not null default 1.05,
  status_top_from numeric(4,2) not null default 1.15,

  -- Версия модели: расчёт прошлого периода должен помнить свою формулу,
  -- иначе после правки весов история задним числом «перепишется».
  model_version text not null default 'STORE_KPI_V1',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null,

  constraint store_kpi_settings_company_uniq unique (company_id),
  constraint store_kpi_settings_clip_check check (ratio_clip_min > 0 and ratio_clip_min < ratio_clip_max),
  -- Клуб не может быть сам себе прокси потока: сравнивать выручку магазина
  -- с ней же самой бессмысленно.
  constraint store_kpi_settings_club_not_self check (club_company_id is null or club_company_id <> company_id)
);

create index if not exists idx_store_kpi_settings_org
  on public.store_kpi_settings (organization_id);

create table if not exists public.store_kpi_cross_sell_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,

  source_category_id uuid not null references public.inventory_categories(id) on delete cascade,
  target_category_id uuid not null references public.inventory_categories(id) on delete cascade,

  -- Вес правила в общем attach rate: «рамен → напиток» может быть важнее,
  -- чем «кофе → сладкое».
  weight numeric(4,2) not null default 1.00,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,

  constraint store_kpi_cross_sell_rules_uniq unique (company_id, source_category_id, target_category_id),
  -- Правило «категория к самой себе» всегда выполнялось бы автоматически
  -- и завышало бы допродажи всем подряд.
  constraint store_kpi_cross_sell_rules_distinct check (source_category_id <> target_category_id),
  constraint store_kpi_cross_sell_rules_weight check (weight > 0)
);

create index if not exists idx_store_kpi_cross_sell_company
  on public.store_kpi_cross_sell_rules (company_id) where active;

alter table public.store_kpi_settings enable row level security;
alter table public.store_kpi_cross_sell_rules enable row level security;

-- Только service_role: весь доступ идёт через API, который режет по
-- организации. Политики для authenticated намеренно нет — иначе настройки
-- KPI (и связка с точкой-клубом) стали бы видны между арендаторами.
drop policy if exists "service_role full access store_kpi_settings" on public.store_kpi_settings;
create policy "service_role full access store_kpi_settings" on public.store_kpi_settings
  to service_role
  using (true) with check (true);

drop policy if exists "service_role full access store_kpi_cross_sell_rules" on public.store_kpi_cross_sell_rules;
create policy "service_role full access store_kpi_cross_sell_rules" on public.store_kpi_cross_sell_rules
  to service_role
  using (true) with check (true);

create or replace function public.touch_store_kpi_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_store_kpi_settings_updated_at on public.store_kpi_settings;
create trigger trg_store_kpi_settings_updated_at
before update on public.store_kpi_settings
for each row execute function public.touch_store_kpi_updated_at();

drop trigger if exists trg_store_kpi_cross_sell_updated_at on public.store_kpi_cross_sell_rules;
create trigger trg_store_kpi_cross_sell_updated_at
before update on public.store_kpi_cross_sell_rules
for each row execute function public.touch_store_kpi_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Факты смен магазина одним запросом.
-- ─────────────────────────────────────────────────────────────────────────
-- Тянуть на страницу сырые позиции нельзя: год работы точки — это десятки
-- тысяч строк point_sale_items, а PostgREST к тому же режет ответ по 1000.
-- Поэтому свёртка до «одна смена — одна строка» делается в базе: год отдаётся
-- сотнями строк вместо десятков тысяч.
--
-- Ключ группировки — (дата, смена, кассир). Кассир в ключе потому, что смену
-- иногда закрывает не тот, кто её начал, и приписывать чужие чеки нельзя.
--
-- Возвраты приклеиваются по той же тройке. Возврат, оформленный без кассира
-- или в смену без продаж, в свёртку не попадёт — такие случаи единичны и
-- ловятся отдельной проверкой аномалий, а не искажением чужой смены.
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
  attach_opportunities numeric,
  attach_success numeric
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
           coalesce(sum(pi.quantity), 0) as qty,
           count(pi.id) as line_count,
           array_remove(array_agg(distinct ii.category_id), null) as cats
      from public.point_sales s
      left join public.point_sale_items pi on pi.sale_id = s.id
      left join public.inventory_items ii on ii.id = pi.item_id
     where s.company_id = p_company_id
       and s.sale_date between p_from and p_to
     group by s.id, s.sale_date, s.shift, s.operator_id, s.total_amount
  ),
  rules as (
    select source_category_id, target_category_id, weight
      from public.store_kpi_cross_sell_rules
     where company_id = p_company_id
       and active
  ),
  attach as (
    -- Возможность допродажи = в чеке есть исходная категория правила.
    -- Успех = рядом оказалась целевая.
    select sl.id as sale_id,
           sum(r.weight) as opportunities,
           sum(case when r.target_category_id = any(sl.cats) then r.weight else 0 end) as success
      from sale_lines sl
      join rules r on r.source_category_id = any(sl.cats)
     group by sl.id
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
           coalesce(sum(a.opportunities), 0) as attach_opportunities,
           coalesce(sum(a.success), 0) as attach_success
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
         sa.attach_opportunities,
         sa.attach_success
    from sales_agg sa
    left join returns_agg ra
      on ra.return_date = sa.sale_date
     and ra.shift = sa.shift
     and ra.operator_id is not distinct from sa.operator_id
   order by sa.sale_date, sa.shift;
$$;
