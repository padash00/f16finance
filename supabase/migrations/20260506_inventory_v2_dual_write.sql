-- ─────────────────────────────────────────────────────────────────────────
-- Шаг 4 рефактора: двойная запись.
--
-- Каждая операция инвентаря согласованно меняет ОБЕ правды:
--   - старую модель: catalog_total + warehouse (формула showcase = max(0, ct - wh))
--   - новую модель: point_display (реальный остаток витрины)
--
-- После применения этой миграции health-check должен оставаться чистым
-- (или с теми же 52 warning'ами warehouse_exceeds_catalog) после ЛЮБОЙ
-- операции в системе.
--
-- Это подготовка к шагу 5 (переключение чтения на point_display).
-- Старые места чтения формулы продолжают работать.
-- ─────────────────────────────────────────────────────────────────────────


-- ───────────────────────────────────────────────────────────────────────
-- 1. inventory_post_writeoff
--    Изменение: при writeoff с point_display списываем не только catalog_total,
--    но и сам point_display. Раньше point_display оставался прежним.
-- ───────────────────────────────────────────────────────────────────────

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
    location_id, written_at, reason, comment, created_by
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
      writeoff_id, item_id, quantity, unit_cost, total_cost, comment
    )
    values (
      v_writeoff_id, v_item_id, v_qty, v_unit_cost, v_line_total,
      nullif(trim(coalesce(v_item ->> 'comment', '')), '')
    );

    if v_loc_type = 'warehouse' then
      -- Списание со склада: меняем warehouse и catalog_total. Витрина не трогается.
      perform public.inventory_apply_balance_delta(p_location_id, v_item_id, -v_qty);
      if v_catalog_loc_id is not null then
        perform public.inventory_apply_balance_delta(v_catalog_loc_id, v_item_id, -v_qty);
      end if;
    elsif v_loc_type = 'point_display' then
      -- Списание с витрины: меняем catalog_total И point_display (двойная запись v2).
      if v_catalog_loc_id is null then
        raise exception 'inventory-catalog-total-location-missing';
      end if;
      perform public.inventory_apply_balance_delta(v_catalog_loc_id, v_item_id, -v_qty);
      perform public.inventory_apply_balance_delta(p_location_id, v_item_id, -v_qty);
    else
      -- catalog_total writeoff (legacy): списываем только catalog_total
      if v_catalog_loc_id is null then
        raise exception 'inventory-catalog-total-location-missing';
      end if;
      perform public.inventory_apply_balance_delta(v_catalog_loc_id, v_item_id, -v_qty);
    end if;

    insert into public.inventory_movements (
      item_id, movement_type, from_location_id, quantity,
      unit_cost, total_amount, reference_type, reference_id, comment, actor_user_id
    )
    values (
      v_item_id,
      'writeoff',
      case
        when v_loc_type = 'warehouse' then p_location_id
        when v_loc_type = 'point_display' then p_location_id
        else v_catalog_loc_id
      end,
      v_qty, v_unit_cost, v_line_total,
      'inventory_writeoff', v_writeoff_id,
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


-- ───────────────────────────────────────────────────────────────────────
-- 2. inventory_post_stocktake
--    Изменение: при ревизии warehouse устанавливаем point_display = counted_showcase
--    (или расчётное от формулы). При ревизии point_display параллельно меняем
--    catalog_total на ту же дельту, чтобы старая формула оставалась согласованной.
-- ───────────────────────────────────────────────────────────────────────

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
  v_pd_loc_id uuid;
  v_catalog_current numeric;
  v_pd_current numeric;
  v_showcase_counted numeric;
  v_catalog_target numeric;
  v_catalog_delta numeric;
  v_pd_delta numeric;
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
    select id into v_catalog_loc_id
    from public.inventory_locations
    where company_id = v_company_id and location_type = 'catalog_total' and is_active = true
    limit 1;

    select id into v_pd_loc_id
    from public.inventory_locations
    where company_id = v_company_id and location_type = 'point_display' and is_active = true
    limit 1;
  end if;

  insert into public.inventory_stocktakes (
    location_id, counted_at, comment, created_by
  )
  values (
    p_location_id, p_counted_at,
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
    where location_id = p_location_id and item_id = v_item_id;

    v_expected_qty := coalesce(v_expected_qty, 0);
    v_delta_qty := v_actual_qty - v_expected_qty;

    insert into public.inventory_stocktake_items (
      stocktake_id, item_id, expected_qty, actual_qty, delta_qty, comment
    )
    values (
      v_stocktake_id, v_item_id, v_expected_qty, v_actual_qty, v_delta_qty,
      nullif(trim(coalesce(v_item ->> 'comment', '')), '')
    );

    if v_delta_qty <> 0 then
      v_changed_count := v_changed_count + 1;
      perform public.inventory_apply_balance_delta(p_location_id, v_item_id, v_delta_qty);

      insert into public.inventory_movements (
        item_id, movement_type, from_location_id, to_location_id,
        quantity, reference_type, reference_id, comment, actor_user_id
      )
      values (
        v_item_id, 'inventory_adjustment',
        case when v_delta_qty < 0 then p_location_id else null end,
        case when v_delta_qty > 0 then p_location_id else null end,
        abs(v_delta_qty),
        'inventory_stocktake', v_stocktake_id,
        coalesce(nullif(trim(coalesce(v_item ->> 'comment', '')), ''), nullif(trim(coalesce(p_comment, '')), '')),
        p_created_by
      );
    end if;

    -- ── Двойная запись v2: синхронизация catalog_total и point_display ──

    if v_loc_type = 'warehouse' and v_catalog_loc_id is not null then
      -- Ревизия склада: пересчитываем catalog_total и устанавливаем point_display.
      select coalesce(quantity, 0) into v_catalog_current
      from public.inventory_balances
      where location_id = v_catalog_loc_id and item_id = v_item_id;
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
          item_id, movement_type, from_location_id, to_location_id,
          quantity, reference_type, reference_id, comment, actor_user_id
        )
        values (
          v_item_id, 'inventory_adjustment',
          case when v_catalog_delta < 0 then v_catalog_loc_id else null end,
          case when v_catalog_delta > 0 then v_catalog_loc_id else null end,
          abs(v_catalog_delta),
          'inventory_stocktake_catalog_sync', v_stocktake_id,
          'Синхронизация catalog_total после ревизии склада', p_created_by
        );
      end if;

      -- Устанавливаем point_display = v_showcase_counted (двойная запись v2)
      if v_pd_loc_id is not null then
        select coalesce(quantity, 0) into v_pd_current
        from public.inventory_balances
        where location_id = v_pd_loc_id and item_id = v_item_id;
        v_pd_current := coalesce(v_pd_current, 0);
        v_pd_delta := v_showcase_counted - v_pd_current;

        if abs(v_pd_delta) > 0.0001 then
          perform public.inventory_apply_balance_delta(v_pd_loc_id, v_item_id, v_pd_delta);

          insert into public.inventory_movements (
            item_id, movement_type, from_location_id, to_location_id,
            quantity, reference_type, reference_id, comment, actor_user_id
          )
          values (
            v_item_id, 'inventory_adjustment',
            case when v_pd_delta < 0 then v_pd_loc_id else null end,
            case when v_pd_delta > 0 then v_pd_loc_id else null end,
            abs(v_pd_delta),
            'inventory_stocktake_pd_sync', v_stocktake_id,
            'Синхронизация point_display после ревизии склада (v2)', p_created_by
          );
        end if;
      end if;

    elsif v_loc_type = 'point_display' and v_catalog_loc_id is not null and v_delta_qty <> 0 then
      -- Ревизия витрины: catalog_total меняется на ту же дельту, чтобы формула catalog - warehouse оставалась корректной.
      perform public.inventory_apply_balance_delta(v_catalog_loc_id, v_item_id, v_delta_qty);

      insert into public.inventory_movements (
        item_id, movement_type, from_location_id, to_location_id,
        quantity, reference_type, reference_id, comment, actor_user_id
      )
      values (
        v_item_id, 'inventory_adjustment',
        case when v_delta_qty < 0 then v_catalog_loc_id else null end,
        case when v_delta_qty > 0 then v_catalog_loc_id else null end,
        abs(v_delta_qty),
        'inventory_stocktake_catalog_sync', v_stocktake_id,
        'Синхронизация catalog_total после ревизии витрины (v2)', p_created_by
      );
    end if;
  end loop;

  return query
  select v_stocktake_id, v_changed_count;
end;
$$;


-- ───────────────────────────────────────────────────────────────────────
-- 3. inventory_create_point_sale (продажа из operator)
--    Изменение: дополнительно списываем point_display.
--    Старая логика catalog_total + автотрансфер сохранена для совместимости.
-- ───────────────────────────────────────────────────────────────────────

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
  v_pd_loc_id uuid;
  v_catalog_qty numeric;
  v_warehouse_qty numeric;
  v_pd_qty numeric;
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

  select id into v_pd_loc_id
  from public.inventory_locations
  where company_id = p_company_id and location_type = 'point_display' and is_active = true
  limit 1;

  -- Валидация: catalog_total должен быть достаточным
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

    -- Списание с catalog_total (legacy)
    perform public.inventory_apply_balance_delta(v_catalog_loc_id, v_item_id, -v_qty);

    -- Двойная запись v2: списываем point_display.
    -- Если point_display физически 0 (товар на складе, не на витрине), пропускаем
    -- (предполагается, что autotransfer сначала «подвинул» товар на витрину).
    if v_pd_loc_id is not null then
      select coalesce(quantity, 0) into v_pd_qty
      from public.inventory_balances
      where location_id = v_pd_loc_id and item_id = v_item_id;
      v_pd_qty := coalesce(v_pd_qty, 0);

      if v_pd_qty >= v_qty then
        perform public.inventory_apply_balance_delta(v_pd_loc_id, v_item_id, -v_qty);
      elsif v_pd_qty > 0 then
        -- Списываем то, что есть; остальное компенсируется автотрансфером (warehouse → catalog_total)
        -- и дополнительной записью в point_display.
        perform public.inventory_apply_balance_delta(v_pd_loc_id, v_item_id, -v_pd_qty);
      end if;
    end if;

    -- Автотрансфер из warehouse если warehouse > catalog после списания
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
      v_item_id, 'sale',
      coalesce(v_pd_loc_id, v_catalog_loc_id),
      v_qty, v_line_total,
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


-- ───────────────────────────────────────────────────────────────────────
-- 4. inventory_create_pos_sale (продажа в web POS)
--    Изменение: дополнительно списываем catalog_total для совместимости с формулой.
-- ───────────────────────────────────────────────────────────────────────

create or replace function public.inventory_create_pos_sale(
  p_company_id uuid,
  p_location_id uuid,
  p_operator_id uuid,
  p_sale_date date,
  p_shift text,
  p_payment_method text,
  p_cash_amount numeric,
  p_kaspi_amount numeric,
  p_kaspi_before_midnight_amount numeric,
  p_kaspi_after_midnight_amount numeric,
  p_card_amount numeric,
  p_online_amount numeric,
  p_customer_id uuid,
  p_discount_id uuid,
  p_discount_amount numeric,
  p_loyalty_points_earned integer,
  p_loyalty_points_spent integer,
  p_loyalty_discount_amount numeric,
  p_comment text,
  p_source text,
  p_items jsonb
)
returns table (sale_id uuid, total_amount numeric, sold_at timestamptz)
language plpgsql
as $fn_pos_sale$
declare
  v_sale_id uuid;
  v_sold_at timestamptz;
  v_total numeric := 0;
  v_cash numeric := round(coalesce(p_cash_amount, 0), 2);
  v_kaspi numeric := round(coalesce(p_kaspi_amount, 0), 2);
  v_kaspi_before numeric := round(coalesce(p_kaspi_before_midnight_amount, 0), 2);
  v_kaspi_after numeric := round(coalesce(p_kaspi_after_midnight_amount, 0), 2);
  v_card numeric := round(coalesce(p_card_amount, 0), 2);
  v_online numeric := round(coalesce(p_online_amount, 0), 2);
  v_discount numeric := round(coalesce(p_discount_amount, 0), 2);
  v_loyalty_discount numeric := round(coalesce(p_loyalty_discount_amount, 0), 2);
  v_payment_total numeric := 0;
  v_item jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_customer_points integer;
  v_showcase_loc_id uuid;
  v_catalog_loc_id uuid;
  v_showcase_qty numeric;
  v_item_name text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'pos-sale-items-required';
  end if;

  if p_shift not in ('day', 'night') then
    raise exception 'pos-sale-shift-invalid';
  end if;

  if p_payment_method not in ('cash', 'kaspi', 'card', 'online', 'mixed') then
    raise exception 'pos-sale-payment-method-invalid';
  end if;

  if v_cash < 0 or v_kaspi < 0 or v_kaspi_before < 0 or v_kaspi_after < 0 or v_card < 0 or v_online < 0 then
    raise exception 'pos-sale-payment-invalid';
  end if;

  if abs(v_kaspi - (v_kaspi_before + v_kaspi_after)) > 0.01 then
    raise exception 'pos-sale-kaspi-split-mismatch';
  end if;

  select id into v_showcase_loc_id
  from public.inventory_locations
  where company_id = p_company_id and location_type = 'point_display' and is_active = true
  limit 1;

  if v_showcase_loc_id is null then
    raise exception 'pos-sale-showcase-location-missing';
  end if;

  -- catalog_total для двойной записи (необязательно)
  select id into v_catalog_loc_id
  from public.inventory_locations
  where company_id = p_company_id and location_type = 'catalog_total' and is_active = true
  limit 1;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(v_item ->> 'item_id', '')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);
    v_unit_price := round(coalesce((v_item ->> 'unit_price')::numeric, 0), 2);

    if v_item_id is null or v_qty <= 0 then
      raise exception 'pos-sale-line-invalid';
    end if;

    if v_unit_price < 0 then
      raise exception 'pos-sale-unit-price-invalid';
    end if;

    select coalesce(quantity, 0) into v_showcase_qty
    from public.inventory_balances
    where location_id = v_showcase_loc_id and item_id = v_item_id;
    v_showcase_qty := coalesce(v_showcase_qty, 0);

    if v_qty > v_showcase_qty + 0.0001 then
      select name into v_item_name from public.inventory_items where id = v_item_id;
      raise exception 'pos-sale-showcase-insufficient: % (showcase: %, requested: %)',
        coalesce(v_item_name, v_item_id::text), v_showcase_qty, v_qty;
    end if;

    v_line_total := round(v_qty * v_unit_price, 2);
    v_total := round(v_total + v_line_total, 2);
  end loop;

  if v_discount < 0 or v_loyalty_discount < 0 or v_discount + v_loyalty_discount > v_total + 0.01 then
    raise exception 'pos-sale-discount-invalid';
  end if;

  v_total := round(v_total - v_discount - v_loyalty_discount, 2);
  v_payment_total := round(v_cash + v_kaspi + v_card + v_online, 2);

  if abs(v_total - v_payment_total) > 0.01 then
    raise exception 'pos-sale-payment-total-mismatch';
  end if;

  if p_customer_id is not null then
    select c.loyalty_points
    into v_customer_points
    from public.customers c
    where c.id = p_customer_id
    for update;

    if not found then
      raise exception 'pos-customer-not-found';
    end if;

    if coalesce(p_loyalty_points_spent, 0) > coalesce(v_customer_points, 0) then
      raise exception 'pos-loyalty-insufficient-points';
    end if;
  end if;

  insert into public.point_sales (
    company_id, location_id, point_device_id, operator_id, sale_date, shift,
    payment_method, cash_amount, kaspi_amount, kaspi_before_midnight_amount,
    kaspi_after_midnight_amount, card_amount, online_amount, total_amount,
    comment, source, customer_id, discount_id, discount_amount,
    loyalty_points_earned, loyalty_points_spent, loyalty_discount_amount
  )
  values (
    p_company_id, p_location_id, null, p_operator_id, p_sale_date, p_shift,
    p_payment_method, v_cash, v_kaspi, v_kaspi_before, v_kaspi_after,
    v_card, v_online, v_total,
    nullif(trim(coalesce(p_comment, '')), ''),
    coalesce(nullif(trim(coalesce(p_source, '')), ''), 'web-pos'),
    p_customer_id, p_discount_id, greatest(v_discount, 0),
    greatest(coalesce(p_loyalty_points_earned, 0), 0),
    greatest(coalesce(p_loyalty_points_spent, 0), 0),
    greatest(v_loyalty_discount, 0)
  )
  returning id, public.point_sales.sold_at into v_sale_id, v_sold_at;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(v_item ->> 'item_id', '')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);
    v_unit_price := round(coalesce((v_item ->> 'unit_price')::numeric, 0), 2);
    v_line_total := round(v_qty * v_unit_price, 2);

    insert into public.point_sale_items (
      sale_id, item_id, quantity, unit_price, total_price, comment
    )
    values (
      v_sale_id, v_item_id, v_qty, v_unit_price, v_line_total,
      nullif(trim(coalesce(v_item ->> 'comment', '')), '')
    );

    -- Списание с point_display (основное)
    perform public.inventory_apply_balance_delta(v_showcase_loc_id, v_item_id, -v_qty);

    -- Двойная запись v2: списываем catalog_total чтобы формула catalog - warehouse оставалась согласованной.
    if v_catalog_loc_id is not null then
      perform public.inventory_apply_balance_delta(v_catalog_loc_id, v_item_id, -v_qty);
    end if;

    insert into public.inventory_movements (
      item_id, movement_type, from_location_id, quantity, total_amount,
      reference_type, reference_id, comment, actor_user_id
    )
    values (
      v_item_id, 'sale', v_showcase_loc_id, v_qty, v_line_total,
      'point_sale', v_sale_id,
      nullif(trim(coalesce(v_item ->> 'comment', '')), ''), p_operator_id
    );
  end loop;

  if p_customer_id is not null then
    update public.customers
    set
      loyalty_points = greatest(
        0,
        coalesce(public.customers.loyalty_points, 0)
          - greatest(coalesce(p_loyalty_points_spent, 0), 0)
          + greatest(coalesce(p_loyalty_points_earned, 0), 0)
      ),
      total_spent = coalesce(public.customers.total_spent, 0) + v_total,
      visits_count = coalesce(public.customers.visits_count, 0) + 1
    where public.customers.id = p_customer_id;
  end if;

  if p_discount_id is not null then
    update public.discounts
    set usage_count = coalesce(public.discounts.usage_count, 0) + 1
    where public.discounts.id = p_discount_id;
  end if;

  return query
  select v_sale_id, v_total, v_sold_at;
end;
$fn_pos_sale$;


-- ───────────────────────────────────────────────────────────────────────
-- 5. inventory_create_point_return (возврат с кассы)
--    Изменение: дополнительно увеличиваем catalog_total для совместимости с формулой.
-- ───────────────────────────────────────────────────────────────────────

create or replace function public.inventory_create_point_return(
  p_company_id uuid,
  p_location_id uuid,
  p_point_device_id uuid,
  p_operator_id uuid,
  p_sale_id uuid,
  p_return_date date,
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
returns table (return_id uuid, total_amount numeric)
language plpgsql
as $fn_point_return$
declare
  v_return_id uuid;
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
  v_sold_qty numeric;
  v_returned_qty numeric;
  v_sale_item_id uuid;
  v_sale record;
  v_showcase_loc_id uuid;
  v_catalog_loc_id uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'point-return-items-required';
  end if;

  if p_sale_id is null then
    raise exception 'point-return-sale-required';
  end if;

  if p_shift not in ('day', 'night') then
    raise exception 'point-return-shift-invalid';
  end if;

  if p_payment_method not in ('cash', 'kaspi', 'mixed') then
    raise exception 'point-return-payment-method-invalid';
  end if;

  if v_cash < 0 or v_kaspi < 0 or v_kaspi_before < 0 or v_kaspi_after < 0 then
    raise exception 'point-return-payment-invalid';
  end if;

  if abs(v_kaspi - (v_kaspi_before + v_kaspi_after)) > 0.01 then
    raise exception 'point-return-kaspi-split-mismatch';
  end if;

  select ps.id, ps.company_id, ps.location_id, ps.payment_method, ps.total_amount
  into v_sale
  from public.point_sales ps
  where ps.id = p_sale_id and ps.company_id = p_company_id and ps.location_id = p_location_id;

  if v_sale.id is null then
    raise exception 'point-return-sale-not-found';
  end if;

  if v_sale.payment_method <> p_payment_method then
    raise exception 'point-return-payment-method-mismatch';
  end if;

  select id into v_showcase_loc_id
  from public.inventory_locations
  where company_id = p_company_id and location_type = 'point_display' and is_active = true
  limit 1;

  if v_showcase_loc_id is null then
    raise exception 'point-return-showcase-location-missing';
  end if;

  select id into v_catalog_loc_id
  from public.inventory_locations
  where company_id = p_company_id and location_type = 'catalog_total' and is_active = true
  limit 1;

  insert into public.point_returns (
    company_id, location_id, point_device_id, operator_id, sale_id,
    return_date, shift, payment_method, cash_amount, kaspi_amount,
    kaspi_before_midnight_amount, kaspi_after_midnight_amount,
    comment, source, local_ref
  )
  values (
    p_company_id, p_location_id, p_point_device_id, p_operator_id, p_sale_id,
    p_return_date, p_shift, p_payment_method, v_cash, v_kaspi,
    v_kaspi_before, v_kaspi_after,
    nullif(trim(coalesce(p_comment, '')), ''),
    coalesce(nullif(trim(coalesce(p_source, '')), ''), 'point-client'),
    nullif(trim(coalesce(p_local_ref, '')), '')
  )
  returning id into v_return_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item ->> 'item_id')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);
    v_unit_price := round(coalesce((v_item ->> 'unit_price')::numeric, 0), 2);

    if v_item_id is null or v_qty <= 0 then
      raise exception 'point-return-line-invalid';
    end if;

    if v_unit_price < 0 then
      raise exception 'point-return-unit-price-invalid';
    end if;

    select coalesce(sum(psi.quantity), 0) into v_sold_qty
    from public.point_sale_items psi
    where psi.sale_id = p_sale_id and psi.item_id = v_item_id
      and abs(psi.unit_price - v_unit_price) <= 0.01;

    select psi.id into v_sale_item_id
    from public.point_sale_items psi
    where psi.sale_id = p_sale_id and psi.item_id = v_item_id
      and abs(psi.unit_price - v_unit_price) <= 0.01
    order by psi.id
    limit 1;

    if coalesce(v_sold_qty, 0) <= 0 then
      raise exception 'point-return-item-not-in-sale';
    end if;

    select coalesce(sum(pri.quantity), 0) into v_returned_qty
    from public.point_return_items pri
    join public.point_returns pr on pr.id = pri.return_id
    where pr.sale_id = p_sale_id and pri.item_id = v_item_id
      and abs(pri.unit_price - v_unit_price) <= 0.01;

    if coalesce(v_returned_qty, 0) + v_qty > v_sold_qty + 0.0001 then
      raise exception 'point-return-exceeds-sold-qty';
    end if;

    v_line_total := round(v_qty * v_unit_price, 2);
    v_total := v_total + v_line_total;

    insert into public.point_return_items (
      return_id, sale_item_id, item_id, quantity, unit_price, total_price, comment
    )
    values (
      v_return_id, v_sale_item_id, v_item_id, v_qty, v_unit_price, v_line_total,
      nullif(trim(coalesce(v_item ->> 'comment', '')), '')
    );

    -- Возврат на point_display (основное)
    perform public.inventory_apply_balance_delta(v_showcase_loc_id, v_item_id, v_qty);

    -- Двойная запись v2: возвращаем и в catalog_total чтобы формула оставалась согласованной.
    if v_catalog_loc_id is not null then
      perform public.inventory_apply_balance_delta(v_catalog_loc_id, v_item_id, v_qty);
    end if;

    insert into public.inventory_movements (
      item_id, movement_type, to_location_id, quantity, total_amount,
      reference_type, reference_id, comment, actor_user_id
    )
    values (
      v_item_id, 'return', v_showcase_loc_id, v_qty, v_line_total,
      'point_return', v_return_id,
      nullif(trim(coalesce(v_item ->> 'comment', '')), ''), null
    );
  end loop;

  v_total := round(v_total, 2);

  if abs(v_total - (v_cash + v_kaspi)) > 0.01 then
    raise exception 'point-return-payment-total-mismatch';
  end if;

  update public.point_returns
  set total_amount = v_total
  where id = v_return_id;

  return query
  select v_return_id, v_total;
end;
$fn_point_return$;


-- ───────────────────────────────────────────────────────────────────────
-- 6. inventory_decide_request
--    Изменение: при одобрении дополнительно прибавляем target_location_id (point_display).
--    Раньше изменялась только source_location_id (warehouse). Теперь — обе.
-- ───────────────────────────────────────────────────────────────────────

create or replace function public.inventory_decide_request(
  p_request_id uuid,
  p_approved boolean,
  p_decision_comment text,
  p_actor_user_id uuid,
  p_items jsonb default '[]'::jsonb
)
returns table (request_id uuid, status text)
language plpgsql
as $$
declare
  v_request public.inventory_requests%rowtype;
  v_request_item record;
  v_line jsonb;
  v_approved_qty numeric;
  v_status text;
  v_current_balance numeric;
begin
  select ir.* into v_request
  from public.inventory_requests ir
  where ir.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'inventory-request-not-found';
  end if;

  if v_request.status <> 'new' and v_request.status <> 'disputed' then
    raise exception 'inventory-request-already-decided';
  end if;

  if not p_approved then
    update public.inventory_request_items iri
    set approved_qty = 0
    where iri.request_id = p_request_id;

    update public.inventory_requests ir
    set status = 'rejected',
        decision_comment = nullif(trim(coalesce(p_decision_comment, '')), ''),
        approved_by = p_actor_user_id,
        approved_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where ir.id = p_request_id;

    return query select p_request_id as request_id, 'rejected'::text as status;
    return;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'inventory-request-decision-items-required';
  end if;

  for v_request_item in
    select iri.*
    from public.inventory_request_items iri
    where iri.request_id = p_request_id
    order by iri.id
  loop
    select value into v_line
    from jsonb_array_elements(p_items)
    where value ->> 'request_item_id' = v_request_item.id::text
    limit 1;

    if v_line is null then
      raise exception 'inventory-request-decision-line-missing';
    end if;

    v_approved_qty := coalesce((v_line ->> 'approved_qty')::numeric, 0);

    if v_approved_qty < 0 then
      raise exception 'inventory-request-approved-qty-invalid';
    end if;

    if v_approved_qty > v_request_item.requested_qty then
      raise exception 'inventory-request-approved-qty-exceeds-requested';
    end if;

    update public.inventory_request_items iri
    set approved_qty = v_approved_qty
    where iri.id = v_request_item.id;

    if v_approved_qty > 0 then
      -- Лочим баланс источника
      select coalesce(quantity, 0) into v_current_balance
      from public.inventory_balances
      where location_id = v_request.source_location_id
        and item_id = v_request_item.item_id
      for update;

      if coalesce(v_current_balance, 0) < v_approved_qty then
        raise exception 'inventory-insufficient-stock';
      end if;

      -- Списываем с источника (warehouse)
      perform public.inventory_apply_balance_delta(
        v_request.source_location_id, v_request_item.item_id, -v_approved_qty
      );

      -- Двойная запись v2: прибавляем на target (point_display).
      -- Раньше формула catalog - warehouse автоматически давала +показ при -warehouse.
      -- Теперь явно увеличиваем point_display, чтобы он соответствовал.
      perform public.inventory_apply_balance_delta(
        v_request.target_location_id, v_request_item.item_id, v_approved_qty
      );

      insert into public.inventory_movements (
        item_id, movement_type, from_location_id, to_location_id,
        quantity, reference_type, reference_id, comment, actor_user_id
      )
      values (
        v_request_item.item_id, 'transfer_to_point',
        v_request.source_location_id, v_request.target_location_id,
        v_approved_qty,
        'inventory_request', p_request_id,
        nullif(trim(coalesce(p_decision_comment, '')), ''), p_actor_user_id
      );
    end if;
  end loop;

  if exists (
    select 1 from public.inventory_request_items iri
    where iri.request_id = p_request_id
      and coalesce(iri.approved_qty, 0) > 0
      and iri.approved_qty < iri.requested_qty
  ) or exists (
    select 1 from public.inventory_request_items iri
    where iri.request_id = p_request_id
      and iri.requested_qty > 0
      and coalesce(iri.approved_qty, 0) = 0
  ) then
    v_status := 'approved_partial';
  else
    v_status := 'approved_full';
  end if;

  update public.inventory_requests ir
  set status = v_status,
      decision_comment = nullif(trim(coalesce(p_decision_comment, '')), ''),
      approved_by = p_actor_user_id,
      approved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where ir.id = p_request_id;

  return query select p_request_id as request_id, v_status as status;
end;
$$;


-- ───────────────────────────────────────────────────────────────────────
-- 7. inventory_undecide_request
--    Изменение: при откате дополнительно вычитаем target_location_id (point_display).
-- ───────────────────────────────────────────────────────────────────────

create or replace function public.inventory_undecide_request(
  p_request_id uuid,
  p_reason text,
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

  if v_request.status not in ('approved_full', 'approved_partial') then
    raise exception 'inventory-request-not-undecidable';
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
    -- Возврат товара на источник (warehouse)
    perform public.inventory_apply_balance_delta(
      v_request.source_location_id, v_item.item_id, v_item.approved_qty
    );

    -- Двойная запись v2: уменьшаем target (point_display) на ту же дельту.
    perform public.inventory_apply_balance_delta(
      v_request.target_location_id, v_item.item_id, -v_item.approved_qty
    );

    insert into public.inventory_movements (
      item_id, movement_type, from_location_id, to_location_id,
      quantity, reference_type, reference_id, comment, actor_user_id
    )
    values (
      v_item.item_id, 'transfer_cancel',
      v_request.target_location_id, v_request.source_location_id,
      v_item.approved_qty,
      'inventory_request_undecide', p_request_id,
      nullif(trim(coalesce(p_reason, '')), ''), p_actor_user_id
    );
  end loop;

  update public.inventory_request_items iri
  set approved_qty = null
  where iri.request_id = p_request_id;

  update public.inventory_requests ir
  set status = 'new',
      decision_comment = nullif(trim(coalesce(p_reason, '')), ''),
      approved_by = null,
      approved_at = null,
      updated_at = timezone('utc', now())
  where ir.id = p_request_id;
end;
$$;


-- ───────────────────────────────────────────────────────────────────────
-- 8. inventory_cancel_receipt
--    Изменение: дополнительно уменьшаем catalog_total при отмене приёмки.
--    Раньше catalog_total оставался завышенным после отмены — баг.
-- ───────────────────────────────────────────────────────────────────────

create or replace function public.inventory_cancel_receipt(
  p_receipt_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns void
language plpgsql
as $$
declare
  v_receipt public.inventory_receipts%rowtype;
  v_item record;
  v_balance numeric;
  v_loc_type text;
  v_company_id uuid;
  v_catalog_loc_id uuid;
begin
  select ir.* into v_receipt
  from public.inventory_receipts ir
  where ir.id = p_receipt_id
  for update;

  if v_receipt.id is null then
    raise exception 'inventory-receipt-not-found';
  end if;

  if v_receipt.status = 'cancelled' then
    raise exception 'inventory-receipt-already-cancelled';
  end if;

  -- Получаем тип локации и catalog_total компании для двойной записи
  select location_type, company_id into v_loc_type, v_company_id
  from public.inventory_locations
  where id = v_receipt.location_id;

  if v_company_id is not null then
    select id into v_catalog_loc_id
    from public.inventory_locations
    where company_id = v_company_id and location_type = 'catalog_total' and is_active = true
    limit 1;
  end if;

  -- Pre-check: на основной локации хватает товара
  for v_item in
    select iri.item_id, iri.quantity, iri.unit_cost, iri.total_cost
    from public.inventory_receipt_items iri
    where iri.receipt_id = p_receipt_id
  loop
    select coalesce(quantity, 0) into v_balance
    from public.inventory_balances
    where location_id = v_receipt.location_id and item_id = v_item.item_id
    for update;

    if coalesce(v_balance, 0) < v_item.quantity then
      raise exception 'inventory-receipt-cancel-insufficient-stock';
    end if;
  end loop;

  -- Pre-check: и на catalog_total тоже (если он был синхронизирован при receipt)
  if v_catalog_loc_id is not null and v_loc_type <> 'catalog_total' then
    for v_item in
      select iri.item_id, iri.quantity
      from public.inventory_receipt_items iri
      where iri.receipt_id = p_receipt_id
    loop
      select coalesce(quantity, 0) into v_balance
      from public.inventory_balances
      where location_id = v_catalog_loc_id and item_id = v_item.item_id
      for update;

      if coalesce(v_balance, 0) < v_item.quantity then
        raise exception 'inventory-receipt-cancel-insufficient-catalog';
      end if;
    end loop;
  end if;

  for v_item in
    select iri.item_id, iri.quantity, iri.unit_cost, iri.total_cost
    from public.inventory_receipt_items iri
    where iri.receipt_id = p_receipt_id
  loop
    -- Откатываем основную локацию
    perform public.inventory_apply_balance_delta(
      v_receipt.location_id, v_item.item_id, -v_item.quantity
    );

    -- Двойная запись v2: откатываем catalog_total если приёмка была не туда
    if v_catalog_loc_id is not null and v_loc_type <> 'catalog_total' then
      perform public.inventory_apply_balance_delta(
        v_catalog_loc_id, v_item.item_id, -v_item.quantity
      );
    end if;

    insert into public.inventory_movements (
      item_id, movement_type, from_location_id, to_location_id,
      quantity, unit_cost, total_amount, reference_type, reference_id,
      comment, actor_user_id
    ) values (
      v_item.item_id, 'receipt_cancel',
      v_receipt.location_id, null,
      v_item.quantity, v_item.unit_cost, v_item.total_cost,
      'inventory_receipt_cancel', p_receipt_id,
      nullif(trim(coalesce(p_reason, '')), ''), p_actor_user_id
    );
  end loop;

  update public.inventory_receipts
  set status = 'cancelled',
      cancelled_at = timezone('utc', now()),
      cancelled_by = p_actor_user_id,
      cancel_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_receipt_id;
end;
$$;
