-- ─────────────────────────────────────────────────────────────────────────
-- Health-check целостности инвентаря.
--
-- Возвращает список проблем по разным критериям:
--   1. Сумма движений по (item, location) ≠ текущему балансу
--   2. Отрицательные балансы (не должно быть, но проверим)
--   3. Расхождение catalog_total ≠ warehouse + showcase (формула)
--   4. Балансы без соответствующих движений
--   5. Движения, ссылающиеся на несуществующие локации
--
-- Используется:
--   - вручную: SELECT * FROM inventory_integrity_check();
--   - кроном: GET /api/admin/cron/inventory-integrity-check (отправит в Telegram если что-то не так)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.inventory_integrity_check()
returns table (
  severity text,
  category text,
  location_id uuid,
  location_name text,
  location_type text,
  item_id uuid,
  item_name text,
  expected_qty numeric,
  actual_qty numeric,
  diff numeric,
  detail text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ────────────────────────────────────────────────────────
  -- 1. Расхождение «сумма движений vs текущий баланс»
  --    Берём все балансы, считаем по движениям (приход − расход),
  --    сравниваем. При расхождении > 0.001 — флаг.
  -- ────────────────────────────────────────────────────────
  return query
  with movement_totals as (
    select
      coalesce(m.to_location_id, m.from_location_id) as loc_id,
      m.item_id,
      sum(case when m.to_location_id is not null and m.from_location_id is null then m.quantity
               when m.from_location_id is not null and m.to_location_id is null then -m.quantity
               when m.to_location_id is not null and m.from_location_id is not null then 0
               else 0 end) as net_qty
    from public.inventory_movements m
    group by 1, 2
  ),
  movement_in as (
    select m.to_location_id as loc_id, m.item_id, sum(m.quantity) as inflow
    from public.inventory_movements m
    where m.to_location_id is not null
    group by 1, 2
  ),
  movement_out as (
    select m.from_location_id as loc_id, m.item_id, sum(m.quantity) as outflow
    from public.inventory_movements m
    where m.from_location_id is not null
    group by 1, 2
  ),
  expected as (
    select
      coalesce(mi.loc_id, mo.loc_id) as loc_id,
      coalesce(mi.item_id, mo.item_id) as item_id,
      coalesce(mi.inflow, 0) - coalesce(mo.outflow, 0) as expected
    from movement_in mi
    full outer join movement_out mo on mi.loc_id = mo.loc_id and mi.item_id = mo.item_id
  )
  select
    'error'::text as severity,
    'balance_vs_movements'::text as category,
    b.location_id,
    l.name,
    l.location_type,
    b.item_id,
    i.name,
    coalesce(e.expected, 0) as expected_qty,
    b.quantity as actual_qty,
    b.quantity - coalesce(e.expected, 0) as diff,
    'Текущий баланс не совпадает с суммой движений'::text as detail
  from public.inventory_balances b
  left join expected e on e.loc_id = b.location_id and e.item_id = b.item_id
  left join public.inventory_locations l on l.id = b.location_id
  left join public.inventory_items i on i.id = b.item_id
  where abs(b.quantity - coalesce(e.expected, 0)) > 0.001
    -- Игнорируем баланс точно 0 без движений (стартовое состояние)
    and not (b.quantity = 0 and e.expected is null);

  -- ────────────────────────────────────────────────────────
  -- 2. Отрицательные балансы (не должно быть из-за CHECK)
  -- ────────────────────────────────────────────────────────
  return query
  select
    'critical'::text,
    'negative_balance'::text,
    b.location_id,
    l.name,
    l.location_type,
    b.item_id,
    i.name,
    0::numeric,
    b.quantity,
    b.quantity,
    'Отрицательный остаток — нарушение CHECK constraint'::text
  from public.inventory_balances b
  left join public.inventory_locations l on l.id = b.location_id
  left join public.inventory_items i on i.id = b.item_id
  where b.quantity < 0;

  -- ────────────────────────────────────────────────────────
  -- 3. Расхождение «catalog_total ≠ warehouse + max(0, catalog - warehouse)»
  --    Должно всегда выполняться: catalog_total ≥ warehouse
  --    Если warehouse > catalog_total — модель сломана
  -- ────────────────────────────────────────────────────────
  return query
  with company_locs as (
    select
      l.company_id,
      max(case when l.location_type = 'warehouse' then l.id end) as wh_id,
      max(case when l.location_type = 'catalog_total' then l.id end) as ct_id
    from public.inventory_locations l
    where l.company_id is not null and l.is_active
    group by l.company_id
  ),
  pairs as (
    select cl.company_id, cl.wh_id, cl.ct_id, b.item_id,
           coalesce(bw.quantity, 0) as wh_qty,
           coalesce(bc.quantity, 0) as ct_qty
    from company_locs cl
    cross join lateral (
      select distinct item_id from public.inventory_balances
      where location_id = cl.wh_id or location_id = cl.ct_id
    ) b
    left join public.inventory_balances bw on bw.location_id = cl.wh_id and bw.item_id = b.item_id
    left join public.inventory_balances bc on bc.location_id = cl.ct_id and bc.item_id = b.item_id
    where cl.wh_id is not null and cl.ct_id is not null
  )
  select
    'warning'::text,
    'warehouse_exceeds_catalog'::text,
    p.wh_id,
    (select name from public.inventory_locations where id = p.wh_id),
    'warehouse'::text,
    p.item_id,
    (select name from public.inventory_items where id = p.item_id),
    p.ct_qty,
    p.wh_qty,
    p.wh_qty - p.ct_qty,
    'Подсобка превышает каталог — формула витрины уйдёт в 0'::text
  from pairs p
  where p.wh_qty > p.ct_qty + 0.001;

  -- ────────────────────────────────────────────────────────
  -- 4. Движения, ссылающиеся на несуществующие локации
  --    (defensive — внешний ключ должен это ловить, но проверим)
  -- ────────────────────────────────────────────────────────
  return query
  select
    'critical'::text,
    'orphan_movement'::text,
    coalesce(m.from_location_id, m.to_location_id),
    'СИРОТА'::text,
    'unknown'::text,
    m.item_id,
    (select name from public.inventory_items where id = m.item_id),
    0::numeric,
    m.quantity,
    m.quantity,
    ('Движение ссылается на несуществующую локацию: ' || coalesce(m.movement_type, '?'))::text
  from public.inventory_movements m
  where (m.from_location_id is not null and not exists (select 1 from public.inventory_locations where id = m.from_location_id))
     or (m.to_location_id is not null and not exists (select 1 from public.inventory_locations where id = m.to_location_id));

  return;
end;
$$;

comment on function public.inventory_integrity_check() is
  'Проверка целостности инвентаря: возвращает список расхождений (балансы vs движения, отрицательные балансы, нарушения формулы catalog ≥ warehouse). Запускать кроном раз в сутки или по требованию.';
