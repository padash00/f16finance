create table if not exists public.inventory_writeoffs (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.inventory_locations(id) on delete cascade,
  written_at date not null,
  reason text not null,
  comment text null,
  total_amount numeric(14, 2) not null default 0,
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists inventory_writeoffs_location_date_idx
  on public.inventory_writeoffs (location_id, written_at desc);

create table if not exists public.inventory_writeoff_items (
  id uuid primary key default gen_random_uuid(),
  writeoff_id uuid not null references public.inventory_writeoffs(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(12, 2) not null default 0 check (unit_cost >= 0),
  total_cost numeric(14, 2) not null default 0 check (total_cost >= 0),
  comment text null
);

create index if not exists inventory_writeoff_items_writeoff_idx
  on public.inventory_writeoff_items (writeoff_id);

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
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'inventory-writeoff-items-required';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'inventory-writeoff-reason-required';
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

    perform public.inventory_apply_balance_delta(p_location_id, v_item_id, -v_qty);

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
      p_location_id,
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
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'inventory-stocktake-items-required';
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
  end loop;

  return query
  select v_stocktake_id, v_changed_count;
end;
$$;
