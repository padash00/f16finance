-- Fix receive order after v7 overapproval/legacy-safe function.
--
-- Invariant on inventory_balances:
--   quantity_reserved <= quantity
--
-- When receiving a request we must remove reservation before decreasing the
-- physical warehouse quantity. Otherwise a valid row like quantity=5,
-- reserved=3 becomes quantity=2, reserved=3 for a moment and the CHECK fails.

create or replace function public.inventory_receive_request(
  p_request_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
as $fn_receive$
declare
  v_request public.inventory_requests%rowtype;
  v_item record;
  v_quantity numeric;
  v_reserved numeric;
  v_skip_balance_move boolean;
begin
  select ir.* into v_request
  from public.inventory_requests ir
  where ir.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'inventory-request-not-found';
  end if;

  if v_request.status not in ('approved_full', 'approved_partial', 'issued') then
    raise exception 'inventory-request-not-receivable';
  end if;

  if v_request.received_by is not null then
    raise exception 'inventory-request-already-received';
  end if;

  for v_item in
    select iri.item_id, coalesce(iri.approved_qty, 0) as approved_qty
    from public.inventory_request_items iri
    where iri.request_id = p_request_id
      and coalesce(iri.approved_qty, 0) > 0
  loop
    select coalesce(quantity, 0), coalesce(quantity_reserved, 0)
    into v_quantity, v_reserved
    from public.inventory_balances
    where location_id = v_request.source_location_id
      and item_id = v_item.item_id
    for update;

    v_skip_balance_move := coalesce(v_reserved, 0) < v_item.approved_qty;

    if not v_skip_balance_move then
      -- Correct order: release reserve first, then move physical stock.
      perform public.inventory_apply_reserved_delta(
        v_request.source_location_id, v_item.item_id, -v_item.approved_qty
      );
      perform public.inventory_apply_balance_delta(
        v_request.source_location_id, v_item.item_id, -v_item.approved_qty
      );
      perform public.inventory_apply_balance_delta(
        v_request.target_location_id, v_item.item_id, v_item.approved_qty
      );

      insert into public.inventory_movements (
        item_id, movement_type, from_location_id, to_location_id,
        quantity, reference_type, reference_id, comment, actor_user_id
      )
      values (
        v_item.item_id, 'transfer_warehouse_to_showcase',
        v_request.source_location_id, v_request.target_location_id,
        v_item.approved_qty,
        'inventory_request_received', p_request_id,
        'Получение заявки точкой', p_actor_user_id
      );
    else
      insert into public.inventory_movements (
        item_id, movement_type, from_location_id, to_location_id,
        quantity, reference_type, reference_id, comment, actor_user_id
      )
      values (
        v_item.item_id, 'transfer_warehouse_to_showcase',
        v_request.source_location_id, v_request.target_location_id,
        v_item.approved_qty,
        'inventory_request_received', p_request_id,
        'Получение заявки (legacy: товар был списан при одобрении)', p_actor_user_id
      );
    end if;
  end loop;

  update public.inventory_requests ir
  set status = 'received',
      received_at = timezone('utc', now()),
      received_by = p_actor_user_id,
      updated_at = timezone('utc', now())
  where ir.id = p_request_id;
end;
$fn_receive$;

comment on function public.inventory_receive_request is
  'v7 + legacy-safe: при получении сначала снимает резерв, потом двигает физический остаток склад→витрина.';

notify pgrst, 'reload schema';
