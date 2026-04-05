alter table public.point_sales
  add column if not exists card_amount numeric(12, 2) not null default 0 check (card_amount >= 0),
  add column if not exists online_amount numeric(12, 2) not null default 0 check (online_amount >= 0);

alter table public.point_sales
  drop constraint if exists point_sales_payment_method_check;

alter table public.point_sales
  add constraint point_sales_payment_method_check
  check (payment_method in ('cash', 'kaspi', 'card', 'online', 'mixed'));

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
as $$
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

  for v_item in
    select *
    from jsonb_array_elements(p_items)
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
    company_id,
    location_id,
    point_device_id,
    operator_id,
    sale_date,
    shift,
    payment_method,
    cash_amount,
    kaspi_amount,
    kaspi_before_midnight_amount,
    kaspi_after_midnight_amount,
    card_amount,
    online_amount,
    total_amount,
    comment,
    source,
    customer_id,
    discount_id,
    discount_amount,
    loyalty_points_earned,
    loyalty_points_spent,
    loyalty_discount_amount
  )
  values (
    p_company_id,
    p_location_id,
    null,
    p_operator_id,
    p_sale_date,
    p_shift,
    p_payment_method,
    v_cash,
    v_kaspi,
    v_kaspi_before,
    v_kaspi_after,
    v_card,
    v_online,
    v_total,
    nullif(trim(coalesce(p_comment, '')), ''),
    coalesce(nullif(trim(coalesce(p_source, '')), ''), 'web-pos'),
    p_customer_id,
    p_discount_id,
    greatest(v_discount, 0),
    greatest(coalesce(p_loyalty_points_earned, 0), 0),
    greatest(coalesce(p_loyalty_points_spent, 0), 0),
    greatest(v_loyalty_discount, 0)
  )
  returning id, public.point_sales.sold_at into v_sale_id, v_sold_at;

  for v_item in
    select *
    from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(v_item ->> 'item_id', '')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);
    v_unit_price := round(coalesce((v_item ->> 'unit_price')::numeric, 0), 2);
    v_line_total := round(v_qty * v_unit_price, 2);

    insert into public.point_sale_items (
      sale_id,
      item_id,
      quantity,
      unit_price,
      total_price,
      comment
    )
    values (
      v_sale_id,
      v_item_id,
      v_qty,
      v_unit_price,
      v_line_total,
      nullif(trim(coalesce(v_item ->> 'comment', '')), '')
    );

    perform public.inventory_apply_balance_delta(p_location_id, v_item_id, -v_qty);

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
      v_item_id,
      'sale',
      p_location_id,
      v_qty,
      v_line_total,
      'point_sale',
      v_sale_id,
      nullif(trim(coalesce(v_item ->> 'comment', '')), ''),
      p_operator_id
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
$$;
