-- ─────────────────────────────────────────────────────────────────────────
-- Шаг 6 рефактора: переключение записи на новую модель.
-- Склад и витрина — независимые балансы.
--
-- Изменения по операциям:
--   - Касса (POS, operator) бьёт ТОЛЬКО point_display. Автотрансфера нет.
--     Если на витрине пусто — продажа отклоняется. Оператор должен сделать
--     заявку склад→витрина.
--   - Приёмка, списание, ревизия, возврат — больше не синхронизируют catalog_total.
--   - catalog_total остаётся «замороженной» — никто туда не пишет, никто не читает.
--   - Заявки (decide/undecide) уже правильные: меняют source и target.
--
-- catalog_total НЕ удаляется — это будет шаг 8. Сейчас просто отключаем запись.
-- ─────────────────────────────────────────────────────────────────────────


-- ───────────────────────────────────────────────────────────────────────
-- 1. inventory_post_receipt — только основная локация (warehouse), без catalog sync
-- ───────────────────────────────────────────────────────────────────────

create or replace function public.inventory_post_receipt(
  p_location_id uuid,
  p_received_at date,
  p_supplier_id uuid,
  p_invoice_number text,
  p_invoice_file_url text,
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
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'inventory-receipt-items-required';
  end if;

  if nullif(trim(coalesce(p_invoice_file_url, '')), '') is null then
    raise exception 'inventory-receipt-invoice-required';
  end if;

  select location_type into v_loc_type
  from public.inventory_locations
  where id = p_location_id;

  if v_loc_type is null then
    raise exception 'inventory-receipt-location-not-found';
  end if;

  -- v6: приёмка только на склад или витрину (для оприходования). catalog_total отдельно не трогается.

  insert into public.inventory_receipts (
    location_id, supplier_id, received_at, invoice_number, invoice_file_url, comment, created_by
  )
  values (
    p_location_id, p_supplier_id, p_received_at,
    nullif(trim(coalesce(p_invoice_number, '')), ''),
    nullif(trim(coalesce(p_invoice_file_url, '')), ''),
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
      receipt_id, item_id, quantity, unit_cost, total_cost, comment
    )
    values (
      v_receipt_id, v_item_id, v_qty, v_unit_cost, v_line_total,
      nullif(trim(coalesce(v_item ->> 'comment', '')), '')
    );

    -- Только основная локация. Никакой catalog_total синхронизации.
    perform public.inventory_apply_balance_delta(p_location_id, v_item_id, v_qty);

    insert into public.inventory_movements (
      item_id, movement_type, to_location_id, quantity,
      unit_cost, total_amount, reference_type, reference_id, comment, actor_user_id
    )
    values (
      v_item_id, 'receipt', p_location_id, v_qty, v_unit_cost, v_line_total,
      'inventory_receipt', v_receipt_id,
      nullif(trim(coalesce(v_item ->> 'comment', '')), ''),
      p_created_by
    );
  end loop;

  update public.inventory_receipts
  set total_amount = round(v_total, 2)
  where id = v_receipt_id;

  return query select v_receipt_id, round(v_total, 2);
end;
$$;


-- ───────────────────────────────────────────────────────────────────────
-- 2. inventory_post_writeoff — только основная локация
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
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'inventory-writeoff-items-required';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'inventory-writeoff-reason-required';
  end if;

  select location_type into v_loc_type
  from public.inventory_locations
  where id = p_location_id;

  if v_loc_type is null then
    raise exception 'inventory-writeoff-location-not-found';
  end if;

  if v_loc_type not in ('warehouse', 'point_display') then
    raise exception 'inventory-writeoff-location-type-not-allowed';
  end if;

  insert into public.inventory_writeoffs (
    location_id, written_at, reason, comment, created_by
  )
  values (
    p_location_id, p_written_at, trim(p_reason),
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

    select coalesce(default_purchase_price, 0) into v_unit_cost
    from public.inventory_items where id = v_item_id;

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

    -- Только основная локация
    perform public.inventory_apply_balance_delta(p_location_id, v_item_id, -v_qty);

    insert into public.inventory_movements (
      item_id, movement_type, from_location_id, quantity,
      unit_cost, total_amount, reference_type, reference_id, comment, actor_user_id
    )
    values (
      v_item_id, 'writeoff', p_location_id, v_qty, v_unit_cost, v_line_total,
      'inventory_writeoff', v_writeoff_id,
      coalesce(nullif(trim(coalesce(v_item ->> 'comment', '')), ''), nullif(trim(coalesce(p_comment, '')), '')),
      p_created_by
    );
  end loop;

  update public.inventory_writeoffs
  set total_amount = round(v_total, 2)
  where id = v_writeoff_id;

  return query select v_writeoff_id, round(v_total, 2);
end;
$$;


-- ───────────────────────────────────────────────────────────────────────
-- 3. inventory_post_stocktake — только основная локация
--    counted_showcase больше не имеет смысла: ревизия одной локации меняет одну локацию.
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
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'inventory-stocktake-items-required';
  end if;

  select location_type into v_loc_type
  from public.inventory_locations
  where id = p_location_id;

  if v_loc_type is null then
    raise exception 'inventory-stocktake-location-not-found';
  end if;

  if v_loc_type not in ('warehouse', 'point_display') then
    raise exception 'inventory-stocktake-location-type-not-allowed';
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

    select coalesce(quantity, 0) into v_expected_qty
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
  end loop;

  return query select v_stocktake_id, v_changed_count;
end;
$$;


-- ───────────────────────────────────────────────────────────────────────
-- 4. inventory_create_point_sale (operator) — только point_display, без автотрансфера
--    Если на витрине нет товара, продажа отклоняется. Оператор должен сделать заявку.
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
  v_pd_loc_id uuid;
  v_pd_qty numeric;
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

  -- v6: касса бьёт только point_display
  select id into v_pd_loc_id
  from public.inventory_locations
  where company_id = p_company_id and location_type = 'point_display' and is_active = true
  limit 1;

  if v_pd_loc_id is null then
    raise exception 'point-sale-showcase-location-missing';
  end if;

  -- Валидация: на витрине должно хватить
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

    select coalesce(quantity, 0) into v_pd_qty
    from public.inventory_balances
    where location_id = v_pd_loc_id and item_id = v_item_id;
    v_pd_qty := coalesce(v_pd_qty, 0);

    if v_qty > v_pd_qty + 0.0001 then
      select name into v_item_name from public.inventory_items where id = v_item_id;
      raise exception 'point-sale-showcase-insufficient: % (showcase: %, requested: %)',
        coalesce(v_item_name, v_item_id::text), v_pd_qty, v_qty;
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

    -- Только point_display списание. Никакого catalog_total. Никакого автотрансфера.
    perform public.inventory_apply_balance_delta(v_pd_loc_id, v_item_id, -v_qty);

    insert into public.inventory_movements (
      item_id, movement_type, from_location_id, quantity, total_amount,
      reference_type, reference_id, comment, actor_user_id
    )
    values (
      v_item_id, 'sale', v_pd_loc_id, v_qty, v_line_total,
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

  return query select v_sale_id, v_total;
end;
$fn_point_sale$;


-- ───────────────────────────────────────────────────────────────────────
-- 5. inventory_create_pos_sale (web POS) — только point_display
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
    select c.loyalty_points into v_customer_points
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

    -- Только point_display. Никакого catalog_total.
    perform public.inventory_apply_balance_delta(v_showcase_loc_id, v_item_id, -v_qty);

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

  return query select v_sale_id, v_total, v_sold_at;
end;
$fn_pos_sale$;


-- ───────────────────────────────────────────────────────────────────────
-- 6. inventory_create_point_return — только point_display
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

    -- Только point_display
    perform public.inventory_apply_balance_delta(v_showcase_loc_id, v_item_id, v_qty);

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

  return query select v_return_id, v_total;
end;
$fn_point_return$;


-- ───────────────────────────────────────────────────────────────────────
-- 7. inventory_cancel_receipt — только основная локация, без catalog отката
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

  for v_item in
    select iri.item_id, iri.quantity, iri.unit_cost, iri.total_cost
    from public.inventory_receipt_items iri
    where iri.receipt_id = p_receipt_id
  loop
    -- Только основная локация
    perform public.inventory_apply_balance_delta(
      v_receipt.location_id, v_item.item_id, -v_item.quantity
    );

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

-- inventory_decide_request и inventory_undecide_request оставлены без изменений
-- (они уже правильные после step 4: меняют source и target напрямую).
