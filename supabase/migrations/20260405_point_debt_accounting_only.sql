-- Point debts: record amounts for the site (point_debt_items + weekly aggregate) without
-- touching inventory_balances or inventory_movements. Deletion stays consistent (no restore
-- when inventory_item_id / inventory_location_id are null).

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
    null,
    p_created_by_operator_id
  )
  returning id into v_debt_item_id;

  return query
  select v_debt_item_id, v_inventory_item_id;
end;
$$;
