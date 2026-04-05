create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists inventory_categories_name_uidx
  on public.inventory_categories (lower(name));

create table if not exists public.inventory_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text null,
  phone text null,
  notes text null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists inventory_suppliers_name_uidx
  on public.inventory_suppliers (lower(name));

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  barcode text not null,
  category_id uuid null references public.inventory_categories(id) on delete set null,
  sale_price numeric(12, 2) not null default 0 check (sale_price >= 0),
  default_purchase_price numeric(12, 2) not null default 0 check (default_purchase_price >= 0),
  unit text not null default 'шт',
  notes text null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists inventory_items_barcode_uidx
  on public.inventory_items (barcode);

create index if not exists inventory_items_active_name_idx
  on public.inventory_items (is_active, name);

create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  name text not null,
  code text null,
  location_type text not null check (location_type in ('warehouse', 'point_display')),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists inventory_locations_point_company_uidx
  on public.inventory_locations (company_id, location_type)
  where location_type = 'point_display';

create unique index if not exists inventory_locations_warehouse_name_uidx
  on public.inventory_locations (lower(name), location_type)
  where location_type = 'warehouse';

create table if not exists public.inventory_balances (
  location_id uuid not null references public.inventory_locations(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  quantity numeric(14, 3) not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (location_id, item_id)
);

create index if not exists inventory_balances_item_idx
  on public.inventory_balances (item_id, location_id);

create table if not exists public.inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.inventory_locations(id) on delete restrict,
  supplier_id uuid null references public.inventory_suppliers(id) on delete set null,
  received_at date not null,
  invoice_number text null,
  comment text null,
  total_amount numeric(14, 2) not null default 0,
  status text not null default 'posted' check (status in ('posted')),
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists inventory_receipts_location_date_idx
  on public.inventory_receipts (location_id, received_at desc);

create table if not exists public.inventory_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.inventory_receipts(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  total_cost numeric(14, 2) not null check (total_cost >= 0),
  comment text null
);

create index if not exists inventory_receipt_items_receipt_idx
  on public.inventory_receipt_items (receipt_id);

create table if not exists public.inventory_requests (
  id uuid primary key default gen_random_uuid(),
  source_location_id uuid not null references public.inventory_locations(id) on delete restrict,
  target_location_id uuid not null references public.inventory_locations(id) on delete restrict,
  requesting_company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'new' check (status in ('new', 'approved_partial', 'approved_full', 'rejected')),
  comment text null,
  decision_comment text null,
  created_by uuid null,
  approved_by uuid null,
  approved_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists inventory_requests_status_idx
  on public.inventory_requests (status, created_at desc);

create table if not exists public.inventory_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.inventory_requests(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  requested_qty numeric(14, 3) not null check (requested_qty > 0),
  approved_qty numeric(14, 3) null check (approved_qty is null or approved_qty >= 0),
  comment text null
);

create index if not exists inventory_request_items_request_idx
  on public.inventory_request_items (request_id);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  movement_type text not null check (
    movement_type in (
      'receipt',
      'transfer_to_point',
      'sale',
      'debt',
      'return',
      'writeoff',
      'inventory_adjustment'
    )
  ),
  from_location_id uuid null references public.inventory_locations(id) on delete set null,
  to_location_id uuid null references public.inventory_locations(id) on delete set null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(12, 2) null check (unit_cost is null or unit_cost >= 0),
  total_amount numeric(14, 2) null,
  reference_type text not null,
  reference_id uuid null,
  comment text null,
  actor_user_id uuid null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists inventory_movements_item_created_idx
  on public.inventory_movements (item_id, created_at desc);

create index if not exists inventory_movements_locations_idx
  on public.inventory_movements (from_location_id, to_location_id, created_at desc);

create table if not exists public.inventory_stocktakes (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.inventory_locations(id) on delete cascade,
  counted_at date not null,
  comment text null,
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.inventory_stocktake_items (
  id uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null references public.inventory_stocktakes(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  expected_qty numeric(14, 3) not null default 0,
  actual_qty numeric(14, 3) not null default 0,
  delta_qty numeric(14, 3) not null default 0,
  comment text null
);

create or replace function public.inventory_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_inventory_categories_updated_at on public.inventory_categories;
create trigger trg_inventory_categories_updated_at
before update on public.inventory_categories
for each row
execute function public.inventory_set_updated_at();

drop trigger if exists trg_inventory_suppliers_updated_at on public.inventory_suppliers;
create trigger trg_inventory_suppliers_updated_at
before update on public.inventory_suppliers
for each row
execute function public.inventory_set_updated_at();

drop trigger if exists trg_inventory_items_updated_at on public.inventory_items;
create trigger trg_inventory_items_updated_at
before update on public.inventory_items
for each row
execute function public.inventory_set_updated_at();

drop trigger if exists trg_inventory_locations_updated_at on public.inventory_locations;
create trigger trg_inventory_locations_updated_at
before update on public.inventory_locations
for each row
execute function public.inventory_set_updated_at();

drop trigger if exists trg_inventory_requests_updated_at on public.inventory_requests;
create trigger trg_inventory_requests_updated_at
before update on public.inventory_requests
for each row
execute function public.inventory_set_updated_at();

create or replace function public.inventory_ensure_company_location()
returns trigger
language plpgsql
as $$
begin
  insert into public.inventory_locations (company_id, name, code, location_type)
  values (new.id, new.name, new.code, 'point_display')
  on conflict (company_id, location_type) where location_type = 'point_display'
  do update set
    name = excluded.name,
    code = excluded.code,
    is_active = true,
    updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists trg_inventory_company_location on public.companies;
create trigger trg_inventory_company_location
after insert or update of name, code on public.companies
for each row
execute function public.inventory_ensure_company_location();

insert into public.inventory_locations (name, code, location_type)
values ('Центральный склад', 'main-warehouse', 'warehouse')
on conflict (lower(name), location_type) where location_type = 'warehouse'
do nothing;

insert into public.inventory_locations (company_id, name, code, location_type)
select c.id, c.name, c.code, 'point_display'
from public.companies c
on conflict (company_id, location_type) where location_type = 'point_display'
do nothing;

insert into public.inventory_items (name, barcode, sale_price, default_purchase_price)
select distinct on (trim(pp.barcode))
  trim(pp.name),
  trim(pp.barcode),
  coalesce(pp.price, 0),
  0
from public.point_products pp
where coalesce(trim(pp.barcode), '') <> ''
  and coalesce(trim(pp.name), '') <> ''
on conflict (barcode) do update
set
  name = excluded.name,
  sale_price = case
    when public.inventory_items.sale_price = 0 then excluded.sale_price
    else public.inventory_items.sale_price
  end,
  updated_at = timezone('utc', now());

create or replace function public.inventory_apply_balance_delta(
  p_location_id uuid,
  p_item_id uuid,
  p_delta numeric
)
returns void
language plpgsql
as $$
declare
  v_next numeric;
begin
  insert into public.inventory_balances (location_id, item_id, quantity)
  values (p_location_id, p_item_id, 0)
  on conflict (location_id, item_id) do nothing;

  update public.inventory_balances
  set quantity = quantity + p_delta,
      updated_at = timezone('utc', now())
  where location_id = p_location_id
    and item_id = p_item_id
  returning quantity into v_next;

  if v_next is null then
    raise exception 'inventory-balance-row-not-found';
  end if;

  if v_next < 0 then
    raise exception 'inventory-insufficient-stock';
  end if;
end;
$$;

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
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'inventory-receipt-items-required';
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

    perform public.inventory_apply_balance_delta(p_location_id, v_item_id, v_qty);

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

create or replace function public.inventory_create_request(
  p_source_location_id uuid,
  p_target_location_id uuid,
  p_requesting_company_id uuid,
  p_comment text,
  p_created_by uuid,
  p_items jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_request_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_qty numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'inventory-request-items-required';
  end if;

  insert into public.inventory_requests (
    source_location_id,
    target_location_id,
    requesting_company_id,
    comment,
    created_by
  )
  values (
    p_source_location_id,
    p_target_location_id,
    p_requesting_company_id,
    nullif(trim(coalesce(p_comment, '')), ''),
    p_created_by
  )
  returning id into v_request_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item ->> 'item_id')::uuid;
    v_qty := coalesce((v_item ->> 'requested_qty')::numeric, 0);

    if v_item_id is null or v_qty <= 0 then
      raise exception 'inventory-request-line-invalid';
    end if;

    insert into public.inventory_request_items (
      request_id,
      item_id,
      requested_qty,
      comment
    )
    values (
      v_request_id,
      v_item_id,
      v_qty,
      nullif(trim(coalesce(v_item ->> 'comment', '')), '')
    );
  end loop;

  return v_request_id;
end;
$$;

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
  v_has_partial boolean := false;
  v_has_full boolean := false;
  v_status text;
begin
  select *
  into v_request
  from public.inventory_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'inventory-request-not-found';
  end if;

  if v_request.status <> 'new' then
    raise exception 'inventory-request-already-decided';
  end if;

  if not p_approved then
    update public.inventory_request_items
    set approved_qty = 0
    where request_id = p_request_id;

    update public.inventory_requests
    set
      status = 'rejected',
      decision_comment = nullif(trim(coalesce(p_decision_comment, '')), ''),
      approved_by = p_actor_user_id,
      approved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
    where id = p_request_id;

    return query
    select p_request_id, 'rejected'::text;
    return;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'inventory-request-decision-items-required';
  end if;

  for v_request_item in
    select *
    from public.inventory_request_items
    where request_id = p_request_id
    order by id
  loop
    select value
    into v_line
    from jsonb_array_elements(p_items)
    where value ->> 'request_item_id' = v_request_item.id::text
    limit 1;

    if v_line is null then
      v_approved_qty := 0;
    else
      v_approved_qty := coalesce((v_line ->> 'approved_qty')::numeric, 0);
    end if;

    if v_approved_qty < 0 then
      raise exception 'inventory-request-approved-qty-invalid';
    end if;

    if v_approved_qty > v_request_item.requested_qty then
      raise exception 'inventory-request-approved-qty-exceeds-requested';
    end if;

    update public.inventory_request_items
    set approved_qty = v_approved_qty
    where id = v_request_item.id;

    if v_approved_qty > 0 then
      perform public.inventory_apply_balance_delta(v_request.source_location_id, v_request_item.item_id, -v_approved_qty);
      perform public.inventory_apply_balance_delta(v_request.target_location_id, v_request_item.item_id, v_approved_qty);

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
        v_request_item.item_id,
        'transfer_to_point',
        v_request.source_location_id,
        v_request.target_location_id,
        v_approved_qty,
        'inventory_request',
        p_request_id,
        nullif(trim(coalesce(p_decision_comment, '')), ''),
        p_actor_user_id
      );
    end if;

    if v_approved_qty = v_request_item.requested_qty and v_request_item.requested_qty > 0 then
      v_has_full := true;
    elsif v_approved_qty > 0 then
      v_has_partial := true;
    elsif v_request_item.requested_qty > 0 then
      v_has_partial := true;
    end if;
  end loop;

  if exists (
    select 1
    from public.inventory_request_items
    where request_id = p_request_id
      and coalesce(approved_qty, 0) > 0
      and approved_qty < requested_qty
  ) or exists (
    select 1
    from public.inventory_request_items
    where request_id = p_request_id
      and requested_qty > 0
      and coalesce(approved_qty, 0) = 0
  ) then
    v_status := 'approved_partial';
  else
    v_status := 'approved_full';
  end if;

  update public.inventory_requests
  set
    status = v_status,
    decision_comment = nullif(trim(coalesce(p_decision_comment, '')), ''),
    approved_by = p_actor_user_id,
    approved_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where id = p_request_id;

  return query
  select p_request_id, v_status;
end;
$$;
