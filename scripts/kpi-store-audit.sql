-- Фаза 0 модуля «Эффективность продавцов (магазин)» — аудит данных.
--
-- Зачем: перед тем как строить перцентили, бонусные пороги и attach rate,
-- нужно знать, ЕСТЬ ЛИ на чём их считать. Если чеки пробиваются одной суммой
-- за смену или позиции без категорий — половина метрик из промпта нереализуема,
-- и модуль надо резать до «выручка смены vs ожидание по слоту».
--
-- Как запускать: Supabase SQL Editor, блоки по одному, вывод — в чат.
-- Период правится в первой строке каждого блока (по умолчанию — весь 2026).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Какие вообще точки есть и как они помечены (нужно, чтобы связать
--    магазин с клубом: выручка клуба будет прокси потока вместо SENET).
-- ─────────────────────────────────────────────────────────────────────────────
select c.id,
       c.name,
       c.code,
       c.store_enabled,
       o.name as organization
  from public.companies c
  left join public.organizations o on o.id = c.organization_id
 order by o.name nulls first, c.name;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Объём продаж магазина по точкам: сколько чеков, за какой период,
--    у скольких чеков не проставлен кассир (без кассира KPI по человеку не будет).
-- ─────────────────────────────────────────────────────────────────────────────
select c.name                                            as point,
       count(*)                                          as receipts,
       min(s.sale_date)                                  as first_date,
       max(s.sale_date)                                  as last_date,
       count(distinct s.sale_date)                       as days_with_sales,
       count(*) filter (where s.operator_id is null)     as receipts_without_cashier,
       round(avg(s.total_amount))                        as avg_ticket,
       count(distinct s.source)                          as sources
  from public.point_sales s
  join public.companies c on c.id = s.company_id
 where s.sale_date >= '2026-01-01'
 group by 1
 order by 2 desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. КЛЮЧЕВОЙ ВОПРОС: чеки — это реальные чеки с позициями или «сумма за смену»?
--    Если receipts_without_items велик или avg_items_per_receipt ≈ 1 при большом
--    среднем чеке — items/receipt и attach rate строить не на чем.
-- ─────────────────────────────────────────────────────────────────────────────
select c.name                                                     as point,
       count(*)                                                   as receipts,
       count(*) filter (where it.lines is null)                    as receipts_without_items,
       round(avg(coalesce(it.lines, 0))::numeric, 2)               as avg_lines_per_receipt,
       round(avg(coalesce(it.qty, 0))::numeric, 2)                 as avg_items_per_receipt,
       count(*) filter (where coalesce(it.lines, 0) >= 2)          as receipts_2plus_lines
  from public.point_sales s
  join public.companies c on c.id = s.company_id
  left join lateral (
        select count(*) as lines, sum(pi.quantity) as qty
          from public.point_sale_items pi
         where pi.sale_id = s.id
       ) it on true
 where s.sale_date >= '2026-01-01'
 group by 1
 order by 2 desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Размер выборки по сегментам (день недели × смена).
--    Порог из промпта — minimum_sample_size = 8. Смотрим, где его нет:
--    там придётся падать по лестнице fallback до «сезон + смена».
-- ─────────────────────────────────────────────────────────────────────────────
with per_shift as (
  select s.company_id,
         s.sale_date,
         s.shift,
         sum(s.total_amount) as revenue,
         count(*)            as receipts
    from public.point_sales s
   where s.sale_date >= '2026-01-01'
   group by 1, 2, 3
)
select c.name                                                    as point,
       to_char(p.sale_date, 'Dy')                                as weekday,
       p.shift,
       count(*)                                                  as shifts_observed,
       round(percentile_cont(0.5) within group (order by p.revenue)) as p50_revenue,
       round(percentile_cont(0.9) within group (order by p.revenue)) as p90_revenue,
       round(avg(p.receipts)::numeric, 1)                         as avg_receipts
  from per_shift p
  join public.companies c on c.id = p.company_id
 group by 1, 2, 3, extract(dow from p.sale_date)
 order by 1, extract(dow from p.sale_date), 3;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Сезонность: помесячно, отдельно академический сезон и лето.
--    Проверяем гипотезу промпта (сентябрь–май vs июнь–август) на своих данных.
-- ─────────────────────────────────────────────────────────────────────────────
select c.name                                as point,
       to_char(s.sale_date, 'YYYY-MM')       as month,
       count(distinct s.sale_date)           as days,
       count(*)                              as receipts,
       round(sum(s.total_amount))            as revenue,
       round(avg(s.total_amount))            as avg_ticket
  from public.point_sales s
  join public.companies c on c.id = s.company_id
 where s.sale_date >= '2026-01-01'
 group by 1, 2
 order by 1, 2;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Прокси потока: есть ли выручка клуба (incomes) на те же даты и смены.
--    SENET нам данных не даёт, поэтому «поток» = выручка клуба за смену.
--    Внимание: клуб и магазин — РАЗНЫЕ company_id, поэтому здесь просто
--    смотрим покрытие по организации, а связку «магазин → клуб» задаст настройка.
-- ─────────────────────────────────────────────────────────────────────────────
select c.name                                            as point,
       to_char(i.date, 'YYYY-MM')                        as month,
       count(*)                                          as income_rows,
       count(*) filter (where i.shift is null)           as rows_without_shift,
       count(distinct i.date)                            as days,
       round(sum(coalesce(i.cash_amount,0) + coalesce(i.kaspi_amount,0)
               + coalesce(i.card_amount,0) + coalesce(i.online_amount,0))) as club_revenue
  from public.incomes i
  join public.companies c on c.id = i.company_id
 where i.date >= '2026-01-01'
 group by 1, 2
 order by 1, 2;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Категории товаров: без них не будет attach rate (ramen → drink и т.п.).
-- ─────────────────────────────────────────────────────────────────────────────
select c.name                                                   as point,
       count(*)                                                 as sold_lines,
       count(*) filter (where ii.category_id is null)            as lines_without_category,
       count(distinct ii.category_id)                            as categories_used,
       count(distinct pi.item_id)                                as skus_sold
  from public.point_sale_items pi
  join public.point_sales s   on s.id = pi.sale_id
  join public.companies c     on c.id = s.company_id
  join public.inventory_items ii on ii.id = pi.item_id
 where s.sale_date >= '2026-01-01'
 group by 1
 order by 2 desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Кассиры: сколько смен у каждого и связаны ли операторы с сотрудниками
--    (point_sales.operator_id → operators, point_shifts.operator_id → staff;
--     без operator_staff_links KPI по человеку не сшивается).
-- ─────────────────────────────────────────────────────────────────────────────
select op.name                                          as cashier,
       count(distinct (s.company_id, s.sale_date, s.shift)) as shifts_with_sales,
       count(*)                                          as receipts,
       round(sum(s.total_amount))                        as revenue,
       (osl.staff_id is not null)                        as linked_to_staff
  from public.point_sales s
  join public.operators op on op.id = s.operator_id
  left join public.operator_staff_links osl on osl.operator_id = op.id
 where s.sale_date >= '2026-01-01'
 group by 1, 5
 order by 2 desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Возвраты и аномалии (промпт, п. 69): смены с выручкой без чеков,
--    аномальная доля возвратов.
-- ─────────────────────────────────────────────────────────────────────────────
select c.name                                  as point,
       to_char(r.return_date, 'YYYY-MM')       as month,
       count(*)                                as returns,
       round(sum(r.total_amount))              as returned_amount
  from public.point_returns r
  join public.companies c on c.id = r.company_id
 where r.return_date >= '2026-01-01'
 group by 1, 2
 order by 1, 2;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Смены как объект: сколько закрытых смен и проставлен ли тип day/night.
-- ─────────────────────────────────────────────────────────────────────────────
select c.name                                                as point,
       ps.status,
       ps.shift_type,
       count(*)                                              as shifts,
       min(ps.opened_at::date)                               as first_shift,
       max(ps.opened_at::date)                               as last_shift,
       count(*) filter (where ps.operator_id is null)         as shifts_without_staff
  from public.point_shifts ps
  join public.companies c on c.id = ps.company_id
 where ps.opened_at >= '2026-01-01'
 group by 1, 2, 3
 order by 1, 2, 3;
