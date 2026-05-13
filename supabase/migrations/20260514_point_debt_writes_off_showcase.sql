-- Долг при создании списывает товар с витрины (point_display).
--
-- До этой миграции inventory_create_point_debt был «accounting-only»:
-- записывал долг, но физический остаток на витрине не менял. В результате
-- на ревизии возникала недостача равная сумме всех неоплаченных долгов.
--
-- Теперь:
--   - Создание долга минусует quantity со склада-витрины компании (если айтем
--     сопоставлен по barcode/имени) и сохраняет inventory_location_id в
--     point_debt_items для зеркальной операции при удалении долга.
--   - Если на витрине не хватает — raise inventory-debt-insufficient-stock.
--   - Если айтем не сопоставился с каталогом (нет barcode и имя не совпало) —
--     долг ведётся только как сумма, остатки не трогаем.
--   - inventory_delete_point_debt (без правок) уже возвращает на ту же
--     inventory_location_id.

create or replace function public.inventory_create_point_debt(
  p_company_id uuid,
  p_location_id uuid,
  p_point_device_id uuid,
  p_operator_id uuid,
  p_client_name text,
  p_item_name text,
  p_barcode text,
  p_quantity integer,
  p_unit_price numeric,
  p_total_amount numeric,
  p_comment text,
  p_week_start date,
  p_source text,
  p_local_ref text,
  p_created_by_operator_id uuid default null
)
returns table (
  debt_item_id uuid,
  inventory_item_id uuid
)
language plpgsql
as $fn_create_debt$
declare
  v_inventory_item_id uuid;
  v_debt_item_id uuid;
  v_showcase_loc_id uuid;
  v_showcase_qty numeric;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'inventory-debt-quantity-invalid';
  end if;

  -- Найти товар по штрихкоду или имени (как в предыдущей версии)
  select ii.id
  into v_inventory_item_id
  from public.inventory_items ii
  where (
    nullif(trim(coalesce(p_barcode, '')), '') is not null
    and ii.barcode = trim(p_barcode)
  )
  or (
    nullif(trim(coalesce(p_barcode, '')), '') is null
    and lower(ii.name) = lower(trim(coalesce(p_item_name, '')))
  )
  limit 1;

  -- Витрина точки (point_display)
  select id into v_showcase_loc_id
  from public.inventory_locations
  where company_id = p_company_id
    and location_type = 'point_display'
    and is_active = true
  limit 1;

  -- Проверяем остаток на витрине, если айтем найден и витрина существует
  if v_inventory_item_id is not null and v_showcase_loc_id is not null then
    select coalesce(quantity, 0) into v_showcase_qty
    from public.inventory_balances
    where location_id = v_showcase_loc_id and item_id = v_inventory_item_id;

    v_showcase_qty := coalesce(v_showcase_qty, 0);

    if v_showcase_qty + 0.0001 < p_quantity then
      raise exception 'inventory-debt-insufficient-stock: % (showcase: %, requested: %)',
        p_item_name, v_showcase_qty, p_quantity;
    end if;
  end if;

  insert into public.point_debt_items (
    company_id,
    operator_id,
    point_device_id,
    client_name,
    item_name,
    barcode,
    quantity,
    unit_price,
    total_amount,
    comment,
    week_start,
    source,
    local_ref,
    status,
    inventory_item_id,
    inventory_location_id,
    created_by_operator_id
  )
  values (
    p_company_id,
    p_operator_id,
    p_point_device_id,
    p_client_name,
    p_item_name,
    nullif(trim(coalesce(p_barcode, '')), ''),
    p_quantity,
    p_unit_price,
    p_total_amount,
    nullif(trim(coalesce(p_comment, '')), ''),
    p_week_start,
    coalesce(nullif(trim(coalesce(p_source, '')), ''), 'point-client'),
    nullif(trim(coalesce(p_local_ref, '')), ''),
    'active',
    v_inventory_item_id,
    case when v_inventory_item_id is not null then v_showcase_loc_id else null end,
    p_created_by_operator_id
  )
  returning id into v_debt_item_id;

  -- Списываем с витрины + пишем movement, если айтем сопоставлен.
  if v_inventory_item_id is not null and v_showcase_loc_id is not null then
    perform public.inventory_apply_balance_delta(
      v_showcase_loc_id, v_inventory_item_id, -p_quantity
    );

    insert into public.inventory_movements (
      item_id,
      movement_type,
      from_location_id,
      quantity,
      total_amount,
      reference_type,
      reference_id,
      comment,
      actor_user_id
    )
    values (
      v_inventory_item_id,
      'point_debt_taken',
      v_showcase_loc_id,
      p_quantity,
      p_total_amount,
      'point_debt_create',
      v_debt_item_id,
      coalesce(nullif(trim(coalesce(p_comment, '')), ''), p_item_name),
      p_operator_id
    );
  end if;

  return query
  select v_debt_item_id, v_inventory_item_id;
end;
$fn_create_debt$;

comment on function public.inventory_create_point_debt is
  'v9: при создании долга списывает количество с витрины (point_display) и сохраняет inventory_location_id; ошибка inventory-debt-insufficient-stock если не хватает остатка.';

notify pgrst, 'reload schema';
