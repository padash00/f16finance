-- ─────────────────────────────────────────────────────────────────────────
-- Анализ регулярной недостачи: товары с систематической недостачей
-- по результатам ревизий за последние N дней.
--
-- Возвращает товары, у которых за период было 3+ ревизий с недостачей
-- (delta < 0). Результат — кандидаты для расследования возможного воровства.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.inventory_recurring_shortages(
  p_days integer default 30,
  p_min_count integer default 3
)
returns table (
  item_id uuid,
  item_name text,
  item_barcode text,
  shortage_count integer,
  total_shortage_qty numeric,
  total_shortage_cost numeric,
  last_shortage_at timestamptz,
  affected_locations text[]
)
language sql
stable
as $$
  with shortages as (
    select
      isi.item_id,
      isi.delta_qty,
      isi.expected_qty,
      isi.actual_qty,
      ist.counted_at,
      ist.location_id,
      il.name as location_name
    from public.inventory_stocktake_items isi
    join public.inventory_stocktakes ist on ist.id = isi.stocktake_id
    left join public.inventory_locations il on il.id = ist.location_id
    where ist.counted_at >= current_date - p_days
      and isi.delta_qty < 0
  )
  select
    s.item_id,
    coalesce(ii.name, '?') as item_name,
    coalesce(ii.barcode, '') as item_barcode,
    count(*)::integer as shortage_count,
    sum(abs(s.delta_qty))::numeric as total_shortage_qty,
    sum(abs(s.delta_qty) * coalesce(ii.default_purchase_price, 0))::numeric as total_shortage_cost,
    max(s.counted_at::timestamptz) as last_shortage_at,
    array_agg(distinct s.location_name order by s.location_name) as affected_locations
  from shortages s
  left join public.inventory_items ii on ii.id = s.item_id
  group by s.item_id, ii.name, ii.barcode, ii.default_purchase_price
  having count(*) >= p_min_count
  order by count(*) desc, sum(abs(s.delta_qty)) desc;
$$;

comment on function public.inventory_recurring_shortages is
  'Товары с регулярной недостачей: ≥ p_min_count ревизий с недостачей за последние p_days дней. Кандидаты для расследования возможного воровства.';
