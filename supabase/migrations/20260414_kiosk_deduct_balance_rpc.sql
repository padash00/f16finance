-- Атомарное списание kiosk_balance с проверкой достаточности средств
create or replace function kiosk_deduct_balance(
  p_customer_id uuid,
  p_amount numeric
) returns numeric
language plpgsql
security definer
as $$
declare
  v_current numeric;
  v_new numeric;
begin
  -- Блокируем строку для атомарного обновления
  select kiosk_balance into v_current
  from customers
  where id = p_customer_id
  for update;

  if not found then
    raise exception 'customer-not-found';
  end if;

  if v_current < p_amount then
    raise exception 'insufficient-balance';
  end if;

  v_new := v_current - p_amount;

  update customers
  set kiosk_balance = v_new
  where id = p_customer_id;

  return v_new;
end;
$$;
