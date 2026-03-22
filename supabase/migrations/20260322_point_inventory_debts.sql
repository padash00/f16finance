alter table public.point_debt_items
  add column if not exists inventory_item_id uuid null references public.inventory_items(id) on delete set null,
  add column if not exists inventory_location_id uuid null references public.inventory_locations(id) on delete set null;

create index if not exists idx_point_debt_items_inventory_item
  on public.point_debt_items(inventory_item_id, inventory_location_id);

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
  p_local_ref text
)
returns table (
  debt_item_id uuid,
  inventory_item_id uuid
)
language plpgsql
as $$
declare
  v_inventory_item_id uuid;
  v_debt_item_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'inventory-debt-quantity-invalid';
  end if;

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

  if v_inventory_item_id is null then
    raise exception 'inventory-debt-item-not-found';
  end if;

  perform public.inventory_apply_balance_delta(p_location_id, v_inventory_item_id, -p_quantity);

  insert into public.point_debt_items (
    company_id,
    operator_id,
    point_device_id,
    client_name,
    item_name,
    quantity,
    unit_price,
    total_amount,
    comment,
    week_start,
    source,
    local_ref,
    status,
    inventory_item_id,
    inventory_location_id
  )
  values (
    p_company_id,
    p_operator_id,
    p_point_device_id,
    p_client_name,
    p_item_name,
    p_quantity,
    p_unit_price,
    p_total_amount,
    nullif(trim(coalesce(p_comment, '')), ''),
    p_week_start,
    coalesce(nullif(trim(coalesce(p_source, '')), ''), 'point-client'),
    nullif(trim(coalesce(p_local_ref, '')), ''),
    'active',
    v_inventory_item_id,
    p_location_id
  )
  returning id into v_debt_item_id;

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
    'debt',
    p_location_id,
    p_quantity,
    p_total_amount,
    'point_debt_item',
    v_debt_item_id,
    nullif(trim(coalesce(p_comment, '')), ''),
    p_operator_id
  );

  return query
  select v_debt_item_id, v_inventory_item_id;
end;
$$;

create or replace function public.inventory_delete_point_debt(
  p_debt_item_id uuid
)
returns uuid
language plpgsql
as $$
declare
  v_item public.point_debt_items%rowtype;
begin
  select *
  into v_item
  from public.point_debt_items
  where id = p_debt_item_id
  for update;

  if v_item.id is null then
    raise exception 'debt-item-not-found';
  end if;

  if v_item.status <> 'active' then
    raise exception 'debt-item-already-deleted';
  end if;

  if v_item.inventory_item_id is not null and v_item.inventory_location_id is not null then
    perform public.inventory_apply_balance_delta(v_item.inventory_location_id, v_item.inventory_item_id, v_item.quantity);

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
      v_item.inventory_item_id,
      'return',
      v_item.inventory_location_id,
      v_item.quantity,
      v_item.total_amount,
      'point_debt_delete',
      v_item.id,
      '[Удаление долга] ' || coalesce(v_item.comment, v_item.item_name),
      v_item.operator_id
    );
  end if;

  update public.point_debt_items
  set
    status = 'deleted',
    deleted_at = timezone('utc', now())
  where id = v_item.id;

  return v_item.id;
end;
$$;
