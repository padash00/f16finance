-- TZ catalog model (step 6):
-- Sync catalog_total with receipts/writeoffs/stocktakes.

-- Receipt:
--   - warehouse receipt: warehouse += qty, catalog_total += qty
--   - catalog_total receipt: catalog_total += qty
--   - point_display receipt (legacy): catalog_total += qty

create or replace function public.inventory_post_receipt(
  p_location_id uuid,
  p_received_at date,
  p_supplier_id uuid,
  p_invoice_number text,
  p_comment text,
  p_created_by uuid,
  p_items jsonb
)
returns table (receipt_id uuid, total_amount numeric)
language plpgsql
as $$
declare
  v_receipt_id uuid;
  v_total numeric := 0;
  v_item jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_unit_cost numeric;
  v_line_total numeric;
  v_loc_type text;
  v_company_id uuid;
  v_catalog_loc_id uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'inventory-receipt-items-required';
  end if;

  select location_type, company_id
    into v_loc_type, v_company_id
  from public.inventory_locations
  where id = p_location_id;

  if v_loc_type is null then
    raise exception 'inventory-receipt-location-not-found';
  end if;

  if v_company_id is not null then
    select id
      into v_catalog_loc_id
    from public.inventory_locations
    where company_id = v_company_id
      and location_type = 'catalog_total'
      and is_active = true
    limit 1;
  end if;

  insert into public.inventory_receipts (
    location_id,
    supplier_id,
    received_at,
    invoice_number,
    comment,
    created_by
  )
  values (
    p_location_id,
    p_supplier_id,
    p_received_at,
    nullif(trim(coalesce(p_invoice_number, '')), ''),
    nullif(trim(coalesce(p_comment, '')), ''),
    p_created_by
  )
  returning id into v_receipt_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item ->> 'item_id')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);
    v_unit_cost := coalesce((v_item ->> 'unit_cost')::numeric, 0);

    if v_item_id is null or v_qty <= 0 then
      raise exception 'inventory-receipt-line-invalid';
    end if;

    v_line_total := round(v_qty * v_unit_cost, 2);
    v_total := v_total + v_line_total;

    insert into public.inventory_receipt_items (
      receipt_id,
      item_id,
      quantity,
      unit_cost,
      total_cost,
      comment
    )
    values (
      v_receipt_id,
      v_item_id,
      v_qty,
      v_unit_cost,
      v_line_total,
      nullif(trim(coalesce(v_item ->> 'comment', '')), '')
    );

    -- Keep old behavior on the selected location.
    perform public.inventory_apply_balance_delta(p_location_id, v_item_id, v_qty);

    -- Ensure total stock of company grows as well.
    -- Skip duplicate write when receipt is posted directly to catalog_total.
    if v_catalog_loc_id is not null
       and (v_loc_type <> 'catalog_total' or p_location_id <> v_catalog_loc_id) then
      perform public.inventory_apply_balance_delta(v_catalog_loc_id, v_item_id, v_qty);
    end if;

    insert into public.inventory_movements (
      item_id,
      movement_type,
      to_location_id,
      quantity,
      unit_cost,
      total_amount,
      reference_type,
      reference_id,
      comment,
      actor_user_id
    )
    values (
      v_item_id,
      'receipt',
      p_location_id,
      v_qty,
      v_unit_cost,
      v_line_total,
      'inventory_receipt',
      v_receipt_id,
      nullif(trim(coalesce(v_item ->> 'comment', '')), ''),
      p_created_by
    );
  end loop;

  update public.inventory_receipts
  set total_amount = round(v_total, 2)
  where id = v_receipt_id;

  return query
  select v_receipt_id, round(v_total, 2);
end;
$$;

-- Writeoff:
--   - warehouse writeoff: warehouse -= qty, catalog_total -= qty
--   - showcase/point_display writeoff: only catalog_total -= qty
create or replace function public.inventory_post_writeoff(
  p_location_id uuid,
  p_written_at date,
  p_reason text,
  p_comment text,
  p_created_by uuid,
  p_items jsonb
)
returns table (writeoff_id uuid, total_amount numeric)
language plpgsql
as $$
declare
  v_writeoff_id uuid;
  v_total numeric := 0;
  v_item jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_unit_cost numeric;
  v_line_total numeric;
  v_loc_type text;
  v_company_id uuid;
  v_catalog_loc_id uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'inventory-writeoff-items-required';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'inventory-writeoff-reason-required';
  end if;

  select location_type, company_id
    into v_loc_type, v_company_id
  from public.inventory_locations
  where id = p_location_id;

  if v_loc_type is null then
    raise exception 'inventory-writeoff-location-not-found';
  end if;

  if v_company_id is not null then
    select id
      into v_catalog_loc_id
    from public.inventory_locations
    where company_id = v_company_id
      and location_type = 'catalog_total'
      and is_active = true
    limit 1;
  end if;

  insert into public.inventory_writeoffs (
    location_id,
    written_at,
    reason,
    comment,
    created_by
  )
  values (
    p_location_id,
    p_written_at,
    trim(p_reason),
    nullif(trim(coalesce(p_comment, '')), ''),
    p_created_by
  )
  returning id into v_writeoff_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item ->> 'item_id')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);

    if v_item_id is null or v_qty <= 0 then
      raise exception 'inventory-writeoff-line-invalid';
    end if;

    select coalesce(default_purchase_price, 0)
      into v_unit_cost
    from public.inventory_items
    where id = v_item_id;

    if v_unit_cost is null then
      raise exception 'inventory-item-not-found';
    end if;

    v_line_total := round(v_qty * v_unit_cost, 2);
    v_total := v_total + v_line_total;

    insert into public.inventory_writeoff_items (
      writeoff_id,
      item_id,
      quantity,
      unit_cost,
      total_cost,
      comment
    )
    values (
      v_writeoff_id,
      v_item_id,
      v_qty,
      v_unit_cost,
      v_line_total,
      nullif(trim(coalesce(v_item ->> 'comment', '')), '')
    );

    if v_loc_type = 'warehouse' then
      -- Warehouse writeoff affects both warehouse and catalog_total.
      perform public.inventory_apply_balance_delta(p_location_id, v_item_id, -v_qty);
      if v_catalog_loc_id is not null then
        perform public.inventory_apply_balance_delta(v_catalog_loc_id, v_item_id, -v_qty);
      end if;
    else
      -- Showcase writeoff affects only total stock.
      if v_catalog_loc_id is null then
        raise exception 'inventory-catalog-total-location-missing';
      end if;
      perform public.inventory_apply_balance_delta(v_catalog_loc_id, v_item_id, -v_qty);
    end if;

    insert into public.inventory_movements (
      item_id,
      movement_type,
      from_location_id,
      quantity,
      unit_cost,
      total_amount,
      reference_type,
      reference_id,
      comment,
      actor_user_id
    )
    values (
      v_item_id,
      'writeoff',
      case when v_loc_type = 'warehouse' then p_location_id else v_catalog_loc_id end,
      v_qty,
      v_unit_cost,
      v_line_total,
      'inventory_writeoff',
      v_writeoff_id,
      coalesce(nullif(trim(coalesce(v_item ->> 'comment', '')), ''), nullif(trim(coalesce(p_comment, '')), '')),
      p_created_by
    );
  end loop;

  update public.inventory_writeoffs
  set total_amount = round(v_total, 2)
  where id = v_writeoff_id;

  return query
  select v_writeoff_id, round(v_total, 2);
end;
$$;

-- Stocktake:
--   - warehouse recount sets warehouse
--   - catalog_total is recalculated as counted_warehouse + counted_showcase
--   - counted_showcase can be passed as item.counted_showcase; fallback to current derived showcase
create or replace function public.inventory_post_stocktake(
  p_location_id uuid,
  p_counted_at date,
  p_comment text,
  p_created_by uuid,
  p_items jsonb
)
returns table (stocktake_id uuid, changed_items integer)
language plpgsql
as $$
declare
  v_stocktake_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_actual_qty numeric;
  v_expected_qty numeric;
  v_delta_qty numeric;
  v_changed_count integer := 0;
  v_loc_type text;
  v_company_id uuid;
  v_catalog_loc_id uuid;
  v_catalog_current numeric;
  v_showcase_counted numeric;
  v_catalog_target numeric;
  v_catalog_delta numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'inventory-stocktake-items-required';
  end if;

  select location_type, company_id
    into v_loc_type, v_company_id
  from public.inventory_locations
  where id = p_location_id;

  if v_loc_type is null then
    raise exception 'inventory-stocktake-location-not-found';
  end if;

  if v_company_id is not null then
    select id
      into v_catalog_loc_id
    from public.inventory_locations
    where company_id = v_company_id
      and location_type = 'catalog_total'
      and is_active = true
    limit 1;
  end if;

  insert into public.inventory_stocktakes (
    location_id,
    counted_at,
    comment,
    created_by
  )
  values (
    p_location_id,
    p_counted_at,
    nullif(trim(coalesce(p_comment, '')), ''),
    p_created_by
  )
  returning id into v_stocktake_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item ->> 'item_id')::uuid;
    v_actual_qty := coalesce((v_item ->> 'actual_qty')::numeric, 0);

    if v_item_id is null or v_actual_qty < 0 then
      raise exception 'inventory-stocktake-line-invalid';
    end if;

    select coalesce(quantity, 0)
      into v_expected_qty
    from public.inventory_balances
    where location_id = p_location_id
      and item_id = v_item_id;

    v_expected_qty := coalesce(v_expected_qty, 0);
    v_delta_qty := v_actual_qty - v_expected_qty;

    insert into public.inventory_stocktake_items (
      stocktake_id,
      item_id,
      expected_qty,
      actual_qty,
      delta_qty,
      comment
    )
    values (
      v_stocktake_id,
      v_item_id,
      v_expected_qty,
      v_actual_qty,
      v_delta_qty,
      nullif(trim(coalesce(v_item ->> 'comment', '')), '')
    );

    if v_delta_qty <> 0 then
      v_changed_count := v_changed_count + 1;
      perform public.inventory_apply_balance_delta(p_location_id, v_item_id, v_delta_qty);

      insert into public.inventory_movements (
        item_id,
        movement_type,
        from_location_id,
        to_location_id,
        quantity,
        reference_type,
        reference_id,
        comment,
        actor_user_id
      )
      values (
        v_item_id,
        'inventory_adjustment',
        case when v_delta_qty < 0 then p_location_id else null end,
        case when v_delta_qty > 0 then p_location_id else null end,
        abs(v_delta_qty),
        'inventory_stocktake',
        v_stocktake_id,
        coalesce(nullif(trim(coalesce(v_item ->> 'comment', '')), ''), nullif(trim(coalesce(p_comment, '')), '')),
        p_created_by
      );
    end if;

    -- If stocktake is for warehouse, sync catalog_total target.
    if v_loc_type = 'warehouse' and v_catalog_loc_id is not null then
      select coalesce(quantity, 0)
        into v_catalog_current
      from public.inventory_balances
      where location_id = v_catalog_loc_id
        and item_id = v_item_id;
      v_catalog_current := coalesce(v_catalog_current, 0);

      if jsonb_typeof(v_item) = 'object' and (v_item ? 'counted_showcase') then
        v_showcase_counted := coalesce((v_item ->> 'counted_showcase')::numeric, 0);
      else
        v_showcase_counted := greatest(0, v_catalog_current - v_actual_qty);
      end if;

      if v_showcase_counted < 0 then
        v_showcase_counted := 0;
      end if;

      v_catalog_target := v_actual_qty + v_showcase_counted;
      v_catalog_delta := v_catalog_target - v_catalog_current;

      if abs(v_catalog_delta) > 0.0001 then
        perform public.inventory_apply_balance_delta(v_catalog_loc_id, v_item_id, v_catalog_delta);

        insert into public.inventory_movements (
          item_id,
          movement_type,
          from_location_id,
          to_location_id,
          quantity,
          reference_type,
          reference_id,
          comment,
          actor_user_id
        )
        values (
          v_item_id,
          'inventory_adjustment',
          case when v_catalog_delta < 0 then v_catalog_loc_id else null end,
          case when v_catalog_delta > 0 then v_catalog_loc_id else null end,
          abs(v_catalog_delta),
          'inventory_stocktake_catalog_sync',
          v_stocktake_id,
          'Синхронизация catalog_total после ревизии склада',
          p_created_by
        );
      end if;
    end if;
  end loop;

  return query
  select v_stocktake_id, v_changed_count;
end;
$$;
