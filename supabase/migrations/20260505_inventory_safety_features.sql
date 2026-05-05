-- ─────────────────────────────────────────────────────────────────────────
-- Inventory safety features
--   1. Cancel posted receipts (with reverse movements)
--   2. Undecide approved transfer requests (return to warehouse)
--   3. Posting (оприходование) — receipts without a supplier
--   4. New movement types: receipt_cancel, transfer_cancel, posting, set_stock,
--      catalog_excel_import (the latter is referenced by API code already)
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Allow 'cancelled' status on receipts + cancel metadata + posting kind
alter table public.inventory_receipts
  drop constraint if exists inventory_receipts_status_check;
alter table public.inventory_receipts
  add constraint inventory_receipts_status_check
  check (status in ('posted', 'cancelled'));

alter table public.inventory_receipts
  add column if not exists cancelled_at timestamptz null,
  add column if not exists cancelled_by uuid null,
  add column if not exists cancel_reason text null,
  add column if not exists kind text not null default 'supplier';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_receipts_kind_check'
  ) then
    alter table public.inventory_receipts
      add constraint inventory_receipts_kind_check check (kind in ('supplier', 'posting'));
  end if;
end $$;

create index if not exists inventory_receipts_kind_idx
  on public.inventory_receipts (kind, received_at desc);

-- 2. Extend movement types
alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check (movement_type in (
    'receipt',
    'transfer_to_point',
    'sale',
    'debt',
    'return',
    'writeoff',
    'inventory_adjustment',
    'set_stock',
    'receipt_cancel',
    'transfer_cancel',
    'posting'
  ));

-- 3. inventory_cancel_receipt — reverse a posted receipt
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
  select ir.*
  into v_receipt
  from public.inventory_receipts ir
  where ir.id = p_receipt_id
  for update;

  if v_receipt.id is null then
    raise exception 'inventory-receipt-not-found';
  end if;

  if v_receipt.status = 'cancelled' then
    raise exception 'inventory-receipt-already-cancelled';
  end if;

  -- Pre-check: every line must have enough stock at the receipt location
  -- (received goods may have already been moved/sold; refuse rather than going negative)
  for v_item in
    select iri.item_id, iri.quantity, iri.unit_cost, iri.total_cost
    from public.inventory_receipt_items iri
    where iri.receipt_id = p_receipt_id
  loop
    select coalesce(quantity, 0)
    into v_balance
    from public.inventory_balances
    where location_id = v_receipt.location_id
      and item_id = v_item.item_id
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
    perform public.inventory_apply_balance_delta(
      v_receipt.location_id,
      v_item.item_id,
      -v_item.quantity
    );

    insert into public.inventory_movements (
      item_id,
      movement_type,
      from_location_id,
      to_location_id,
      quantity,
      unit_cost,
      total_amount,
      reference_type,
      reference_id,
      comment,
      actor_user_id
    ) values (
      v_item.item_id,
      'receipt_cancel',
      v_receipt.location_id,
      null,
      v_item.quantity,
      v_item.unit_cost,
      v_item.total_cost,
      'inventory_receipt_cancel',
      p_receipt_id,
      nullif(trim(coalesce(p_reason, '')), ''),
      p_actor_user_id
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

-- 4. inventory_undecide_request — return stock back to source, status -> 'new'
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
  select ir.*
  into v_request
  from public.inventory_requests ir
  where ir.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'inventory-request-not-found';
  end if;

  if v_request.status not in ('approved_full', 'approved_partial') then
    raise exception 'inventory-request-not-undecidable';
  end if;

  -- Block if the request was already physically received on the point
  if v_request.received_by is not null then
    raise exception 'inventory-request-already-received';
  end if;

  for v_item in
    select iri.item_id, coalesce(iri.approved_qty, 0) as approved_qty
    from public.inventory_request_items iri
    where iri.request_id = p_request_id
      and coalesce(iri.approved_qty, 0) > 0
  loop
    -- Return stock to source location (warehouse)
    perform public.inventory_apply_balance_delta(
      v_request.source_location_id,
      v_item.item_id,
      v_item.approved_qty
    );

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
    ) values (
      v_item.item_id,
      'transfer_cancel',
      v_request.target_location_id,
      v_request.source_location_id,
      v_item.approved_qty,
      'inventory_request_undecide',
      p_request_id,
      nullif(trim(coalesce(p_reason, '')), ''),
      p_actor_user_id
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

-- 5. inventory_decide_request — explicit balance-row locks for race-condition friendliness
-- Functionally equivalent to the previous version, but locks the source balance row
-- before computing/applying the delta so that concurrent approvers get serialized cleanly.
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
  select ir.*
  into v_request
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
    set
      status = 'rejected',
      decision_comment = nullif(trim(coalesce(p_decision_comment, '')), ''),
      approved_by = p_actor_user_id,
      approved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
    where ir.id = p_request_id;

    return query
    select p_request_id as request_id, 'rejected'::text as status;
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
    select value
    into v_line
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
      -- Lock the source balance row to serialize concurrent approvers cleanly.
      -- If the row doesn't exist yet, treat balance as 0 (apply_balance_delta will fail
      -- with insufficient-stock, which is correct).
      select coalesce(quantity, 0)
      into v_current_balance
      from public.inventory_balances
      where location_id = v_request.source_location_id
        and item_id = v_request_item.item_id
      for update;

      if coalesce(v_current_balance, 0) < v_approved_qty then
        raise exception 'inventory-insufficient-stock';
      end if;

      perform public.inventory_apply_balance_delta(
        v_request.source_location_id,
        v_request_item.item_id,
        -v_approved_qty
      );

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
  end loop;

  if exists (
    select 1
    from public.inventory_request_items iri
    where iri.request_id = p_request_id
      and coalesce(iri.approved_qty, 0) > 0
      and iri.approved_qty < iri.requested_qty
  ) or exists (
    select 1
    from public.inventory_request_items iri
    where iri.request_id = p_request_id
      and iri.requested_qty > 0
      and coalesce(iri.approved_qty, 0) = 0
  ) then
    v_status := 'approved_partial';
  else
    v_status := 'approved_full';
  end if;

  update public.inventory_requests ir
  set
    status = v_status,
    decision_comment = nullif(trim(coalesce(p_decision_comment, '')), ''),
    approved_by = p_actor_user_id,
    approved_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where ir.id = p_request_id;

  return query
  select p_request_id as request_id, v_status as status;
end;
$$;
