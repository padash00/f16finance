alter table if exists public.inventory_suppliers
  add column if not exists bin_iin text null,
  add column if not exists organization_name text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_suppliers_bin_iin_format_chk'
  ) then
    alter table public.inventory_suppliers
      add constraint inventory_suppliers_bin_iin_format_chk
      check (bin_iin is null or bin_iin ~ '^[0-9]{12}$');
  end if;
end $$;

create unique index if not exists inventory_suppliers_org_bin_iin_uidx
  on public.inventory_suppliers (organization_id, bin_iin)
  where bin_iin is not null;

update public.inventory_suppliers
set organization_name = coalesce(nullif(trim(organization_name), ''), name)
where organization_name is null or trim(organization_name) = '';

alter table if exists public.inventory_receipts
  add column if not exists invoice_file_url text null;

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
  v_company_id uuid;
  v_catalog_loc_id uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'inventory-receipt-items-required';
  end if;

  if nullif(trim(coalesce(p_invoice_file_url, '')), '') is null then
    raise exception 'inventory-receipt-invoice-required';
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
    invoice_file_url,
    comment,
    created_by
  )
  values (
    p_location_id,
    p_supplier_id,
    p_received_at,
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

    perform public.inventory_apply_balance_delta(p_location_id, v_item_id, v_qty);

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
