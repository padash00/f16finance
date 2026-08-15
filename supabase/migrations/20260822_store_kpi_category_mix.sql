-- ─────────────────────────────────────────────────────────────────────────
-- Эффективность продавцов: структура продаж по категориям.
-- ─────────────────────────────────────────────────────────────────────────
-- Последняя диагностическая метрика из ТЗ. Она не входит в балл, но часто
-- объясняет его: «средний чек просел» и «продавали в основном напитки вместо
-- горячего» — это одно и то же наблюдение с разных сторон.
--
-- Отдаётся сразу в разрезе кассира, потому что интересен не столько общий
-- набор точки, сколько отклонение конкретного человека от него: если у
-- одного продавца доля дорогой категории вдвое ниже, чем у остальных, это
-- уже разговор по существу, а не «работай лучше».
--
-- Отменённые смены исключаются — как и везде в модуле.

create or replace function public.store_kpi_category_mix(
  p_company_id uuid,
  p_from date,
  p_to date
)
returns table (
  category_id uuid,
  category_name text,
  cashier_id uuid,
  revenue numeric,
  quantity numeric,
  lines bigint
)
language sql
stable
as $$
  with voided as (
    select id from public.point_shifts
     where company_id = p_company_id and status = 'voided'
  )
  select ii.category_id,
         coalesce(ic.name, 'Без категории') as category_name,
         s.operator_id as cashier_id,
         sum(pi.total_price) as revenue,
         sum(pi.quantity) as quantity,
         count(*) as lines
    from public.point_sales s
    join public.point_sale_items pi on pi.sale_id = s.id
    join public.inventory_items ii on ii.id = pi.item_id
    left join public.inventory_categories ic on ic.id = ii.category_id
   where s.company_id = p_company_id
     and s.sale_date between p_from and p_to
     and (s.shift_id is null or s.shift_id not in (select id from voided))
   group by ii.category_id, ic.name, s.operator_id
   order by sum(pi.total_price) desc;
$$;
