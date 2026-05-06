-- Фикс порядка операций в inventory_receive_request.
--
-- Баг: при получении заявки кассой функция делала:
--   1. quantity -= approved_qty   → quantity_reserved МОЖЕТ стать > quantity
--   2. quantity_reserved -= approved_qty
-- Между шагами 1 и 2 срабатывал CHECK constraint
-- inventory_balances_reserved_le_quantity (quantity_reserved <= quantity)
-- и операция падала с:
--   new row for relation "inventory_balances" violates check constraint
--
-- Пример: quantity=5, reserved=3, approved=3
--   Шаг 1: quantity 5→2, reserved=3  → reserved (3) > quantity (2) — FAIL
--
-- Фикс: сначала уменьшаем reserved, потом quantity:
--   Шаг 1: reserved 3→0, quantity=5  → 0 <= 5 ✓
--   Шаг 2: quantity 5→2, reserved=0  → 0 <= 2 ✓

create or replace function public.inventory_receive_request(
  p_request_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
as $$
declare
  v_request public.inventory_requests%rowtype;
  v_item record;
begin
  select ir.* into v_request
  from public.inventory_requests ir
  where ir.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'inventory-request-not-found';
  end if;

  if v_request.status not in ('approved_full', 'approved_partial', 'issued') then
    raise exception 'inventory-request-not-receivable';
  end if;

  if v_request.received_by is not null then
    raise exception 'inventory-request-already-received';
  end if;

  for v_item in
    select iri.item_id, coalesce(iri.approved_qty, 0) as approved_qty
    from public.inventory_request_items iri
    where iri.request_id = p_request_id
      and coalesce(iri.approved_qty, 0) > 0
  loop
    -- ВАЖНО: сначала снимаем резерв (reserved -= approved), затем списываем
    -- физический остаток (quantity -= approved). Иначе после первого шага
    -- reserved может стать больше quantity и сработает CHECK constraint
    -- inventory_balances_reserved_le_quantity.
    perform public.inventory_apply_reserved_delta(
      v_request.source_location_id, v_item.item_id, -v_item.approved_qty
    );
    perform public.inventory_apply_balance_delta(
      v_request.source_location_id, v_item.item_id, -v_item.approved_qty
    );
    -- Зачисляем на витрину
    perform public.inventory_apply_balance_delta(
      v_request.target_location_id, v_item.item_id, v_item.approved_qty
    );

    insert into public.inventory_movements (
      item_id, movement_type, from_location_id, to_location_id,
      quantity, reference_type, reference_id, comment, actor_user_id
    )
    values (
      v_item.item_id, 'transfer_warehouse_to_showcase',
      v_request.source_location_id, v_request.target_location_id,
      v_item.approved_qty,
      'inventory_request_received', p_request_id,
      'Получение заявки точкой', p_actor_user_id
    );
  end loop;

  update public.inventory_requests ir
  set status = 'received',
      received_at = timezone('utc', now()),
      received_by = p_actor_user_id,
      updated_at = timezone('utc', now())
  where ir.id = p_request_id;
end;
$$;

notify pgrst, 'reload schema';
