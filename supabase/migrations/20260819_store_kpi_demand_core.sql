-- ─────────────────────────────────────────────────────────────────────────
-- Эффективность продавцов: переход на модель спроса по числу чеков.
-- ─────────────────────────────────────────────────────────────────────────
-- Что меняется по существу.
--
-- 1. Спрос больше не измеряется выручкой соседней точки-клуба. Мерой спроса
--    становится число чеков: отдельного счётчика посетителей у магазина нет,
--    но чек оставляет каждый купивший, а привести людей в помещение продавец
--    не может. Колонка club_company_id остаётся в таблице (удалять данные
--    незачем), но кодом больше не читается.
--
-- 2. Правила допродаж перестают быть «категория → категория». Теперь каждая
--    сторона правила это либо категория, либо конкретный товар: «любой
--    напиток» — категория, «фирменный соус» — товар.
--
-- 3. План смены хранит ожидаемое число чеков вместо ожидаемой выручки клуба.
--
-- Идемпотентна.

-- ── План смены: ожидание спроса вместо выручки клуба ──────────────────────
alter table public.store_kpi_shift_plans
  add column if not exists expected_receipts integer null,
  add column if not exists expected_avg_ticket integer null;

comment on column public.store_kpi_shift_plans.expected_club_revenue is
  'Устарело: спрос измеряется числом чеков (expected_receipts). Колонка оставлена ради истории.';

comment on column public.store_kpi_settings.club_company_id is
  'Устарело: модуль не использует данные клуба. Колонка оставлена ради истории.';

-- ── Правила допродаж: товар или категория с любой стороны ─────────────────
alter table public.store_kpi_cross_sell_rules
  add column if not exists source_kind text not null default 'category',
  add column if not exists target_kind text not null default 'category',
  add column if not exists source_ref uuid null,
  add column if not exists target_ref uuid null;

do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
     where table_name = 'store_kpi_cross_sell_rules'
       and constraint_name = 'store_kpi_cross_sell_rules_kinds'
  ) then
    alter table public.store_kpi_cross_sell_rules
      add constraint store_kpi_cross_sell_rules_kinds
      check (source_kind in ('category', 'item') and target_kind in ('category', 'item'));
  end if;
end $$;

-- Перенос старых правил: они все были категорийными.
update public.store_kpi_cross_sell_rules
   set source_ref = coalesce(source_ref, source_category_id),
       target_ref = coalesce(target_ref, target_category_id)
 where source_ref is null or target_ref is null;

-- Ссылки на категории/товары не могут быть пустыми у живого правила.
do $$
begin
  if exists (select 1 from public.store_kpi_cross_sell_rules where source_ref is null or target_ref is null) then
    raise notice 'Есть правила без ссылок — они пропускаются в расчёте';
  end if;
end $$;

-- Старые колонки становятся необязательными: новые правила их не заполняют.
alter table public.store_kpi_cross_sell_rules
  alter column source_category_id drop not null,
  alter column target_category_id drop not null;

-- Прежняя уникальность была по паре категорий; теперь ключ — вид и ссылка.
-- Порядок важен: индекс держится ограничением, и удалять надо сначала
-- ограничение — вместе с ним уйдёт и индекс.
alter table public.store_kpi_cross_sell_rules
  drop constraint if exists store_kpi_cross_sell_rules_uniq;
drop index if exists store_kpi_cross_sell_rules_uniq;
create unique index if not exists store_kpi_cross_sell_rules_ref_uniq
  on public.store_kpi_cross_sell_rules (company_id, source_kind, source_ref, target_kind, target_ref);

-- Правило «сам на себя» всегда выполнялось бы автоматически.
alter table public.store_kpi_cross_sell_rules
  drop constraint if exists store_kpi_cross_sell_rules_distinct;
do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
     where table_name = 'store_kpi_cross_sell_rules'
       and constraint_name = 'store_kpi_cross_sell_rules_distinct_ref'
  ) then
    alter table public.store_kpi_cross_sell_rules
      add constraint store_kpi_cross_sell_rules_distinct_ref
      check (not (source_kind = target_kind and source_ref = target_ref));
  end if;
end $$;

-- ── Свёртка смен: допродажи по товарам и категориям ───────────────────────
-- Ключевое отличие от прошлой версии: чек теперь несёт и список категорий,
-- и список товаров, поэтому правило может ссылаться на любую из сторон.
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
           array_remove(array_agg(distinct ii.category_id), null) as cats,
           array_remove(array_agg(distinct pi.item_id), null) as item_ids
      from public.point_sales s
      left join public.point_sale_items pi on pi.sale_id = s.id
      left join public.inventory_items ii on ii.id = pi.item_id
     where s.company_id = p_company_id
       and s.sale_date between p_from and p_to
     group by s.id, s.sale_date, s.shift, s.operator_id, s.total_amount
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
    -- Возможность допродажи = в чеке есть исходная позиция правила.
    -- Успех = рядом оказалась целевая.
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
