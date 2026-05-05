-- ─────────────────────────────────────────────────────────────────────────
-- Сверка истории: для каждой пары (локация, товар), где
-- текущий баланс ≠ сумме движений, дописываем одно компенсирующее
-- движение типа 'migration_initial' с reference_type = 'integrity_reconciliation'.
--
-- Балансы НЕ трогаются — они считаются физической правдой.
-- Только дополняется история, чтобы health-check видел согласованность.
--
-- Идемпотентно: повторный запуск ничего не сделает (защита через idempotency_key).
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  rec record;
  v_diff numeric;
  v_key text;
  v_count integer := 0;
begin
  for rec in
    with movement_in as (
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
      b.location_id,
      b.item_id,
      b.quantity as actual_qty,
      coalesce(e.expected, 0) as expected_qty,
      b.quantity - coalesce(e.expected, 0) as diff_qty
    from public.inventory_balances b
    left join expected e on e.loc_id = b.location_id and e.item_id = b.item_id
    where abs(b.quantity - coalesce(e.expected, 0)) > 0.001
      and not (b.quantity = 0 and e.expected is null)
  loop
    v_diff := rec.diff_qty;
    v_key := 'integrity_recon:' || rec.location_id::text || ':' || rec.item_id::text;

    insert into public.inventory_movements (
      item_id,
      movement_type,
      from_location_id,
      to_location_id,
      quantity,
      reference_type,
      reference_id,
      comment,
      actor_user_id,
      idempotency_key
    ) values (
      rec.item_id,
      'migration_initial',
      case when v_diff < 0 then rec.location_id else null end,
      case when v_diff > 0 then rec.location_id else null end,
      abs(v_diff),
      'integrity_reconciliation',
      null,
      'Сверка истории v2: компенсация исторического расхождения баланса и движений ('
        || rec.expected_qty::text || ' → ' || rec.actual_qty::text || ')',
      null,
      v_key
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing;

    v_count := v_count + 1;
  end loop;

  raise notice 'Сверка истории: дописано % компенсирующих движений', v_count;
end $$;
