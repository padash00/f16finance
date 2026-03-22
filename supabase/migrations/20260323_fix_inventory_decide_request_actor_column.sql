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
  from public.inventory_requests ir
  where ir.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'inventory-request-not-found';
  end if;

  if v_request.status <> 'new' then
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
      raise exception 'inventory-request-approved-qty-too-high';
    end if;

    update public.inventory_request_items iri
    set approved_qty = v_approved_qty
    where iri.id = v_request_item.id;

    if v_approved_qty > 0 then
      perform public.inventory_apply_balance_delta(
        v_request.source_location_id,
        v_request_item.item_id,
        -v_approved_qty
      );

      perform public.inventory_apply_balance_delta(
        v_request.target_location_id,
        v_request_item.item_id,
        v_approved_qty
      );

      insert into public.inventory_movements (
        item_id,
        movement_type,
        quantity,
        unit_cost,
        total_amount,
        from_location_id,
        to_location_id,
        reference_type,
        reference_id,
        comment,
        actor_user_id
      )
      values (
        v_request_item.item_id,
        'transfer_to_point',
        v_approved_qty,
        null,
        null,
        v_request.source_location_id,
        v_request.target_location_id,
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
