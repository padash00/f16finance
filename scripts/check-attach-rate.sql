-- ─────────────────────────────────────────────────────────────────────────
-- Проверка: допродажа считается ВНУТРИ одного чека.
-- ─────────────────────────────────────────────────────────────────────────
-- Показывает по каждому чеку: сработало ли правило «взяли одно — предложи
-- другое» и был ли в ЭТОМ ЖЕ чеке второй товар.
--
-- Рамен одним чеком, напиток следующим — две строки: у первой «возможность
-- без успеха», у второй правило вообще не срабатывает. Это и есть проверка
-- того, что чеки не склеиваются.
--
-- Перед запуском подставьте свою точку и период.

with params as (
  select
    'ПОДСТАВЬТЕ_COMPANY_ID'::uuid as company_id,
    date '2026-08-01' as period_from,
    date '2026-08-31' as period_to
),
-- Один чек = одна строка: категории и товары собираются в границах чека.
sale_lines as (
  select s.id            as sale_id,
         s.sale_date,
         s.shift,
         array_remove(array_agg(distinct ii.category_id), null) as cats,
         array_remove(array_agg(distinct pi.item_id), null)     as item_ids,
         string_agg(distinct ii.name, ', ')                     as items_text
    from public.point_sales s
    join params p on true
    left join public.point_sale_items pi on pi.sale_id = s.id
    left join public.inventory_items ii  on ii.id = pi.item_id
   where s.company_id = p.company_id
     and s.sale_date between p.period_from and p.period_to
   group by s.id, s.sale_date, s.shift
),
rules as (
  select r.source_kind, r.source_ref, r.target_kind, r.target_ref, r.weight
    from public.store_kpi_cross_sell_rules r
    join params p on p.company_id = r.company_id
   where r.active
     and r.source_ref is not null
     and r.target_ref is not null
)
select sl.sale_date,
       sl.shift,
       sl.items_text                                    as "что в чеке",
       count(r.*)                                       as "правил сработало",
       sum(r.weight)                                    as "возможностей",
       sum(
         case
           when (r.target_kind = 'category' and r.target_ref = any(sl.cats))
             or (r.target_kind = 'item'     and r.target_ref = any(sl.item_ids))
           then r.weight else 0
         end
       )                                                as "успехов",
       case
         when sum(
           case
             when (r.target_kind = 'category' and r.target_ref = any(sl.cats))
               or (r.target_kind = 'item'     and r.target_ref = any(sl.item_ids))
             then r.weight else 0
           end
         ) > 0 then 'допродажа засчитана'
         else 'предложить было что, но не добрали'
       end                                              as "итог"
  from sale_lines sl
  -- join, а не left join: чеки без сработавшего правила в допродажи не идут
  -- вовсе — ни в числитель, ни в знаменатель.
  join rules r
    on (r.source_kind = 'category' and r.source_ref = any(sl.cats))
    or (r.source_kind = 'item'     and r.source_ref = any(sl.item_ids))
 group by sl.sale_id, sl.sale_date, sl.shift, sl.items_text
 order by sl.sale_date desc
 limit 100;
