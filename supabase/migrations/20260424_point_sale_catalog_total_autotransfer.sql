-- TZ catalog model: point sale writes off from catalog_total.
-- If post-sale catalog_total would become less than warehouse, auto-transfer shortage from warehouse.

create or replace function public.inventory_create_point_sale(
  p_company_id uuid,
  p_location_id uuid,
  p_point_device_id uuid,
  p_operator_id uuid,
  p_sale_date date,
  p_shift text,
  p_payment_method text,
  p_cash_amount numeric,
  p_kaspi_amount numeric,
  p_kaspi_before_midnight_amount numeric,
  p_kaspi_after_midnight_amount numeric,
  p_comment text,
  p_source text,
  p_local_ref text,
  p_items jsonb
)
returns table (sale_id uuid, total_amount numeric)
language plpgsql
as $fn_point_sale$
declare
  v_sale_id uuid;
  v_total numeric := 0;
  v_cash numeric := round(coalesce(p_cash_amount, 0), 2);
  v_kaspi numeric := round(coalesce(p_kaspi_amount, 0), 2);
  v_kaspi_before numeric := round(coalesce(p_kaspi_before_midnight_amount, 0), 2);
  v_kaspi_after numeric := round(coalesce(p_kaspi_after_midnight_amount, 0), 2);
  v_item jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_catalog_loc_id uuid;
  v_warehouse_loc_id uuid;
  v_catalog_qty numeric;
  v_warehouse_qty numeric;
  v_shortage numeric;
  v_item_name text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'point-sale-items-required';
  end if;

  if p_shift not in ('day', 'night') then
    raise exception 'point-sale-shift-invalid';
  end if;

  if p_payment_method not in ('cash', 'kaspi', 'mixed') then
    raise exception 'point-sale-payment-method-invalid';
  end if;

  if v_cash < 0 or v_kaspi < 0 or v_kaspi_before < 0 or v_kaspi_after < 0 then
    raise exception 'point-sale-payment-invalid';
  end if;

  if abs(v_kaspi - (v_kaspi_before + v_kaspi_after)) > 0.01 then
    raise exception 'point-sale-kaspi-split-mismatch';
  end if;

  select id into v_catalog_loc_id
  from public.inventory_locations
  where company_id = p_company_id and location_type = 'catalog_total' and is_active = true
  limit 1;

  if v_catalog_loc_id is null then
    raise exception 'point-sale-catalog-location-missing';
  end if;

  select id into v_warehouse_loc_id
  from public.inventory_locations
  where company_id = p_company_id and location_type = 'warehouse' and is_active = true
  limit 1;

  -- Validate: catalog_total must be enough for each sale line.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item ->> 'item_id')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);
    v_unit_price := round(coalesce((v_item ->> 'unit_price')::numeric, 0), 2);

    if v_item_id is null or v_qty <= 0 then
      raise exception 'point-sale-line-invalid';
    end if;

    if v_unit_price < 0 then
      raise exception 'point-sale-unit-price-invalid';
    end if;

    select coalesce(quantity, 0) into v_catalog_qty
    from public.inventory_balances
    where location_id = v_catalog_loc_id and item_id = v_item_id;
    v_catalog_qty := coalesce(v_catalog_qty, 0);

    if v_qty > v_catalog_qty + 0.0001 then
      select name into v_item_name from public.inventory_items where id = v_item_id;
      raise exception 'point-sale-catalog-insufficient: % (catalog: %, requested: %)',
        coalesce(v_item_name, v_item_id::text), v_catalog_qty, v_qty;
    end if;
  end loop;

  insert into public.point_sales (
    company_id, location_id, point_device_id, operator_id, sale_date, shift,
    payment_method, cash_amount, kaspi_amount, kaspi_before_midnight_amount,
    kaspi_after_midnight_amount, comment, source, local_ref
  )
  values (
    p_company_id, p_location_id, p_point_device_id, p_operator_id, p_sale_date, p_shift,
    p_payment_method, v_cash, v_kaspi, v_kaspi_before, v_kaspi_after,
    nullif(trim(coalesce(p_comment, '')), ''),
    coalesce(nullif(trim(coalesce(p_source, '')), ''), 'point-client'),
    nullif(trim(coalesce(p_local_ref, '')), '')
  )
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item ->> 'item_id')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);
    v_unit_price := round(coalesce((v_item ->> 'unit_price')::numeric, 0), 2);
    v_line_total := round(v_qty * v_unit_price, 2);
    v_total := v_total + v_line_total;

    insert into public.point_sale_items (
      sale_id, item_id, quantity, unit_price, total_price, comment
    )
    values (
      v_sale_id, v_item_id, v_qty, v_unit_price, v_line_total,
      nullif(trim(coalesce(v_item ->> 'comment', '')), '')
    );

    -- Write-off from catalog_total.
    perform public.inventory_apply_balance_delta(v_catalog_loc_id, v_item_id, -v_qty);

    -- Auto-transfer from warehouse if warehouse > catalog after sale (keep catalog >= warehouse invariant).
    if v_warehouse_loc_id is not null then
      select coalesce(quantity, 0) into v_catalog_qty
      from public.inventory_balances
      where location_id = v_catalog_loc_id and item_id = v_item_id;

      select coalesce(quantity, 0) into v_warehouse_qty
      from public.inventory_balances
      where location_id = v_warehouse_loc_id and item_id = v_item_id;

      v_catalog_qty := coalesce(v_catalog_qty, 0);
      v_warehouse_qty := coalesce(v_warehouse_qty, 0);

      if v_warehouse_qty > v_catalog_qty + 0.0001 then
        v_shortage := v_warehouse_qty - v_catalog_qty;
        perform public.inventory_apply_balance_delta(v_warehouse_loc_id, v_item_id, -v_shortage);

        insert into public.inventory_movements (
          item_id, movement_type, from_location_id, to_location_id, quantity,
          reference_type, reference_id, comment, actor_user_id
        )
        values (
          v_item_id, 'transfer_to_point', v_warehouse_loc_id, v_catalog_loc_id, v_shortage,
          'auto_warehouse_to_showcase', v_sale_id,
          'Авто-перенос из склада при продаже', null
        );
      end if;
    end if;

    insert into public.inventory_movements (
      item_id, movement_type, from_location_id, quantity, total_amount,
      reference_type, reference_id, comment, actor_user_id
    )
    values (
      v_item_id, 'sale', v_catalog_loc_id, v_qty, v_line_total,
      'point_sale', v_sale_id,
      nullif(trim(coalesce(v_item ->> 'comment', '')), ''), null
    );
  end loop;

  v_total := round(v_total, 2);

  if abs(v_total - (v_cash + v_kaspi)) > 0.01 then
    raise exception 'point-sale-payment-total-mismatch';
  end if;

  update public.point_sales
  set total_amount = v_total
  where id = v_sale_id;

  return query
  select v_sale_id, v_total;
end;
$fn_point_sale$;
