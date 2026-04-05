create table if not exists public.point_returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid not null references public.inventory_locations(id) on delete restrict,
  point_device_id uuid null references public.point_devices(id) on delete set null,
  operator_id uuid null references public.operators(id) on delete set null,
  return_date date not null,
  shift text not null check (shift in ('day', 'night')),
  payment_method text not null check (payment_method in ('cash', 'kaspi', 'mixed')),
  cash_amount numeric(12, 2) not null default 0 check (cash_amount >= 0),
  kaspi_amount numeric(12, 2) not null default 0 check (kaspi_amount >= 0),
  kaspi_before_midnight_amount numeric(12, 2) not null default 0 check (kaspi_before_midnight_amount >= 0),
  kaspi_after_midnight_amount numeric(12, 2) not null default 0 check (kaspi_after_midnight_amount >= 0),
  total_amount numeric(14, 2) not null default 0 check (total_amount >= 0),
  comment text null,
  source text not null default 'point-client',
  local_ref text null,
  returned_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists point_returns_device_local_ref_uidx
  on public.point_returns (point_device_id, local_ref)
  where local_ref is not null;

create index if not exists point_returns_location_shift_idx
  on public.point_returns (location_id, return_date desc, shift, returned_at desc);

create table if not exists public.point_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.point_returns(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  total_price numeric(14, 2) not null check (total_price >= 0),
  comment text null
);

create index if not exists point_return_items_return_idx
  on public.point_return_items (return_id);

create or replace function public.inventory_create_point_return(
  p_company_id uuid,
  p_location_id uuid,
  p_point_device_id uuid,
  p_operator_id uuid,
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
as $$
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
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'point-return-items-required';
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

  insert into public.point_returns (
    company_id,
    location_id,
    point_device_id,
    operator_id,
    return_date,
    shift,
    payment_method,
    cash_amount,
    kaspi_amount,
    kaspi_before_midnight_amount,
    kaspi_after_midnight_amount,
    comment,
    source,
    local_ref
  )
  values (
    p_company_id,
    p_location_id,
    p_point_device_id,
    p_operator_id,
    p_return_date,
    p_shift,
    p_payment_method,
    v_cash,
    v_kaspi,
    v_kaspi_before,
    v_kaspi_after,
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

    v_line_total := round(v_qty * v_unit_price, 2);
    v_total := v_total + v_line_total;

    insert into public.point_return_items (
      return_id,
      item_id,
      quantity,
      unit_price,
      total_price,
      comment
    )
    values (
      v_return_id,
      v_item_id,
      v_qty,
      v_unit_price,
      v_line_total,
      nullif(trim(coalesce(v_item ->> 'comment', '')), '')
    );

    perform public.inventory_apply_balance_delta(p_location_id, v_item_id, v_qty);

    insert into public.inventory_movements (
      item_id,
      movement_type,
      to_location_id,
      quantity,
      total_amount,
      reference_type,
      reference_id,
      comment,
      actor_user_id
    )
    values (
      v_item_id,
      'return',
      p_location_id,
      v_qty,
      v_line_total,
      'point_return',
      v_return_id,
      nullif(trim(coalesce(v_item ->> 'comment', '')), ''),
      null
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
$$;
