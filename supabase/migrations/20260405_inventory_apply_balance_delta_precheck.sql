-- Avoid CHECK (quantity >= 0) firing before PL/pgSQL can raise a stable error code.
-- Also lock the balance row so concurrent sales/debts serialize correctly.

create or replace function public.inventory_apply_balance_delta(
  p_location_id uuid,
  p_item_id uuid,
  p_delta numeric
)
returns void
language plpgsql
as $$
declare
  v_current numeric;
  v_next numeric;
begin
  if p_delta = 0 then
    return;
  end if;

  insert into public.inventory_balances (location_id, item_id, quantity)
  values (p_location_id, p_item_id, 0)
  on conflict (location_id, item_id) do nothing;

  select b.quantity
  into v_current
  from public.inventory_balances b
  where b.location_id = p_location_id
    and b.item_id = p_item_id
  for update;

  if not found then
    raise exception 'inventory-balance-row-not-found';
  end if;

  v_next := v_current + p_delta;

  if v_next < 0 then
    raise exception 'inventory-insufficient-stock';
  end if;

  update public.inventory_balances b
  set quantity = v_next,
      updated_at = timezone('utc', now())
  where b.location_id = p_location_id
    and b.item_id = p_item_id;
end;
$$;
