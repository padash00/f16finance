-- Этап 2 фичи «поставщики»: умный порог.
--
-- Чтобы понять «когда пора заказывать», считаем скорость расхода товара —
-- сколько единиц в среднем уходит в день за последние 30 дней.
-- Расход = продажи + списания + долги (всё, что уменьшает общий остаток;
-- перемещения склад→витрина НЕ считаются — они не уменьшают суммарный запас).
--
-- Умный порог (считается в приложении) = avg_daily_consumption
--   × lead_time_days поставщика × 1.5 (страховой запас).
-- Если у товара задан low_stock_threshold вручную — он в приоритете.

create or replace view public.inventory_consumption_rates as
select
  item_id,
  sum(quantity)::numeric as consumed_30d,
  round((sum(quantity) / 30.0)::numeric, 4) as avg_daily_consumption
from public.inventory_movements
where movement_type in ('sale', 'writeoff', 'debt')
  and created_at >= (timezone('utc', now()) - interval '30 days')
group by item_id;

comment on view public.inventory_consumption_rates is
  'Скорость расхода товара за 30 дней (продажи+списания+долги). Для умного порога перезаказа.';

notify pgrst, 'reload schema';
