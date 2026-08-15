-- ─────────────────────────────────────────────────────────────────────────
-- Эффективность продавцов: смена как объект, а не как пара «дата + день/ночь».
-- ─────────────────────────────────────────────────────────────────────────
-- Раньше свёртка группировала продажи по (дата, смена, кассир). Это давало
-- три ошибки:
--
--   1. Смена, где кассиры менялись или админ пробил пару чеков, разрезалась
--      на две «смены». У каждой половинки меньше чеков — а число чеков у нас
--      мера спроса, и норма съезжала вниз для всей команды.
--
--   2. Длительность смены была неизвестна. Смена на шесть часов вместо
--      двенадцати даёт вдвое меньше покупателей, и модель читала это как
--      «спрос упал», хотя точка просто работала меньше.
--
--   3. Отменённые смены (status = 'voided') попадали в норму наравне с
--      обычными.
--
-- Теперь ключ группировки — сам объект смены (`point_sales.shift_id`), а для
-- исторических продаж без привязки остаётся прежний ключ. Кассир берётся
-- из смены, а если там пусто — самый частый оператор её продаж; та же
-- цепочка, что и в Z-отчёте (`lib/server/shift-report.ts`).
--
-- Функцию приходится удалять: набор колонок расширяется, а `create or replace`
-- менять его не умеет.

drop function if exists public.store_kpi_shift_facts(uuid, date, date);

create or replace function public.store_kpi_shift_facts(
  p_company_id uuid,
  p_from date,
  p_to date
)
returns table (
  shift_id uuid,
  sale_date date,
  shift text,
  cashier_id uuid,
  opened_at timestamptz,
  closed_at timestamptz,
  duration_minutes integer,
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
  with voided as (
    select id from public.point_shifts
     where company_id = p_company_id and status = 'voided'
  ),
  sale_lines as (
    select s.id,
           s.sale_date,
           s.shift,
           s.operator_id,
           s.shift_id,
           -- Ключ смены: объект, если он есть; иначе прежняя тройка.
           coalesce(
             s.shift_id::text,
             s.sale_date::text || '|' || s.shift || '|' || coalesce(s.operator_id::text, 'none')
           ) as gkey,
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
       -- Отменённая смена не должна формировать норму для остальных.
       and (s.shift_id is null or s.shift_id not in (select id from voided))
     group by s.id, s.sale_date, s.shift, s.operator_id, s.shift_id, s.total_amount,
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
  -- Кассир смены: самый частый оператор её продаж. Пригодится, когда в самой
  -- смене оператор не проставлен.
  top_operator as (
    select gkey, operator_id,
           row_number() over (partition by gkey order by count(*) desc, operator_id) as rn
      from sale_lines
     where operator_id is not null
     group by gkey, operator_id
  ),
  skus as (
    select sl.gkey, count(distinct x.item_id) as unique_skus
      from sale_lines sl
      cross join lateral unnest(sl.item_ids) as x(item_id)
     group by sl.gkey
  ),
  sales_agg as (
    select sl.gkey,
           -- min(uuid) в Postgres не существует: сравниваем как текст и
           -- приводим обратно. Внутри группы shift_id и так одинаковый.
           (min(sl.shift_id::text))::uuid as shift_id,
           min(sl.sale_date) as sale_date,
           min(sl.shift) as shift,
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
     group by sl.gkey
  ),
  -- Возвраты цепляются к смене тем же ключом.
  returns_agg as (
    select coalesce(
             r.shift_id::text,
             r.return_date::text || '|' || r.shift || '|' || coalesce(r.operator_id::text, 'none')
           ) as gkey,
           sum(r.total_amount) as amount
      from public.point_returns r
     where r.company_id = p_company_id
       and r.return_date between p_from and p_to
       and (r.shift_id is null or r.shift_id not in (select id from voided))
     group by 1
  )
  select sa.shift_id,
         sa.sale_date,
         sa.shift,
         -- Кассир смены важнее самого активного продавца: смену ведёт человек,
         -- а не тот, кто пробил больше чеков.
         coalesce(ps.operator_id, top.operator_id) as cashier_id,
         ps.opened_at,
         ps.closed_at,
         case
           when ps.opened_at is not null and ps.closed_at is not null
           then greatest(0, (extract(epoch from (ps.closed_at - ps.opened_at)) / 60)::integer)
           else null
         end as duration_minutes,
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
    left join returns_agg ra on ra.gkey = sa.gkey
    left join skus sk on sk.gkey = sa.gkey
    left join top_operator top on top.gkey = sa.gkey and top.rn = 1
    left join public.point_shifts ps on ps.id = sa.shift_id
   order by sa.sale_date, sa.shift;
$$;
