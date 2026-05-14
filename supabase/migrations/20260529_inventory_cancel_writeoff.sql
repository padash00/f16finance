-- Отмена списания товара.
--
-- Списание уменьшает остаток. Отмена — возвращает товар на ту же локацию
-- и помечает акт списания как cancelled. История сохраняется (движение
-- writeoff_cancel), сам акт не удаляется.

-- 1. Статус + метаданные отмены на inventory_writeoffs.
alter table public.inventory_writeoffs
  add column if not exists status text not null default 'posted',
  add column if not exists cancelled_at timestamptz null,
  add column if not exists cancelled_by uuid null,
  add column if not exists cancel_reason text null;

alter table public.inventory_writeoffs
  drop constraint if exists inventory_writeoffs_status_check;
alter table public.inventory_writeoffs
  add constraint inventory_writeoffs_status_check
  check (status in ('posted', 'cancelled'));

-- 2. Новый тип движения writeoff_cancel.
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
    'posting',
    'auto_warehouse_to_showcase',
    'transfer_warehouse_to_showcase',
    'transfer_showcase_to_warehouse',
    'reservation',
    'reservation_release',
    'migration_initial',
    'writeoff_cancel'
  ));

-- 3. RPC отмены списания.
create or replace function public.inventory_cancel_writeoff(
  p_writeoff_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns void
language plpgsql
as $$
declare
  v_writeoff public.inventory_writeoffs%rowtype;
  v_item record;
begin
  select iw.* into v_writeoff
  from public.inventory_writeoffs iw
  where iw.id = p_writeoff_id
  for update;

  if v_writeoff.id is null then
    raise exception 'inventory-writeoff-not-found';
  end if;

  if v_writeoff.status = 'cancelled' then
    raise exception 'inventory-writeoff-already-cancelled';
  end if;

  -- Возвращаем товар на ту же локацию + движение writeoff_cancel.
  for v_item in
    select iwi.item_id, iwi.quantity, iwi.unit_cost, iwi.total_cost
    from public.inventory_writeoff_items iwi
    where iwi.writeoff_id = p_writeoff_id
  loop
    perform public.inventory_apply_balance_delta(
      v_writeoff.location_id, v_item.item_id, v_item.quantity
    );

    insert into public.inventory_movements (
      item_id, movement_type, from_location_id, to_location_id,
      quantity, unit_cost, total_amount, reference_type, reference_id,
      comment, actor_user_id
    ) values (
      v_item.item_id, 'writeoff_cancel',
      null, v_writeoff.location_id,
      v_item.quantity, v_item.unit_cost, v_item.total_cost,
      'inventory_writeoff_cancel', p_writeoff_id,
      nullif(trim(coalesce(p_reason, '')), ''), p_actor_user_id
    );
  end loop;

  update public.inventory_writeoffs
  set status = 'cancelled',
      cancelled_at = timezone('utc', now()),
      cancelled_by = p_actor_user_id,
      cancel_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_writeoff_id;
end;
$$;

notify pgrst, 'reload schema';
