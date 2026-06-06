-- Атомарный возврат витрина → склад.
--
-- Раньше route /api/admin/store/showcase (action=returnToWarehouse) делал это
-- циклом из отдельных вызовов: -витрина, +склад, +движение — БЕЗ транзакции.
-- Если сбой происходил между списанием с витрины и зачислением на склад,
-- товар терялся (списан, но не зачислен). При нескольких товарах часть
-- проходила, часть нет.
--
-- Теперь вся операция в ОДНОЙ функции = одна транзакция: при любой ошибке
-- весь возврат откатывается целиком, остатки не теряются.

create or replace function public.inventory_return_to_warehouse(
  p_showcase_location_id uuid,
  p_warehouse_location_id uuid,
  p_items jsonb,
  p_comment text,
  p_actor_user_id uuid
)
returns integer
language plpgsql
as $$
declare
  v_item jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_showcase_qty numeric;
  v_comment text;
  v_count integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'inventory-return-items-required';
  end if;

  v_comment := nullif(trim(coalesce(p_comment, '')), '');

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(v_item ->> 'item_id', '')::uuid;
    v_qty := round(coalesce((v_item ->> 'quantity')::numeric, 0), 3);

    if v_item_id is null or v_qty <= 0 then
      continue;
    end if;

    -- Блокируем строку остатка витрины, чтобы параллельные операции не
    -- привели к гонке/уходу в минус.
    select coalesce(quantity, 0) into v_showcase_qty
    from public.inventory_balances
    where location_id = p_showcase_location_id and item_id = v_item_id
    for update;

    v_showcase_qty := coalesce(v_showcase_qty, 0);
    if v_qty > v_showcase_qty then
      raise exception 'inventory-showcase-insufficient:%:%:%', v_item_id, v_showcase_qty, v_qty;
    end if;

    perform public.inventory_apply_balance_delta(p_showcase_location_id, v_item_id, -v_qty);
    perform public.inventory_apply_balance_delta(p_warehouse_location_id, v_item_id, v_qty);

    insert into public.inventory_movements (
      item_id,
      movement_type,
      from_location_id,
      to_location_id,
      quantity,
      reference_type,
      comment,
      actor_user_id
    )
    values (
      v_item_id,
      'transfer_showcase_to_warehouse',
      p_showcase_location_id,
      p_warehouse_location_id,
      v_qty,
      'return_to_warehouse',
      v_comment,
      p_actor_user_id
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
