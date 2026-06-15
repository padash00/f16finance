-- Срок годности на приёмке/оприходовании.
--   • inventory_receipt_items: production_date (от = дата изготовления) + expiry_date (до = годен до)
--   • inventory_items.requires_expiry: по умолчанию TRUE (срок обязателен).
--     Для бургеров/хотдогов и прочей готовой еды выключается вручную в каталоге.
--   • RPC inventory_post_receipt пишет даты в строки прихода.
--
-- Блокировка «без срока не добавлять» — на уровне API (приёмка/оприходование),
-- не в БД, чтобы импорт/легаси не падал.

alter table public.inventory_receipt_items
  add column if not exists production_date date null,
  add column if not exists expiry_date date null;

alter table public.inventory_items
  add column if not exists requires_expiry boolean not null default true;

-- Для вкладки «Срок годности»: быстрый поиск ближайших к концу партий.
create index if not exists inventory_receipt_items_expiry_idx
  on public.inventory_receipt_items (expiry_date)
  where expiry_date is not null;

-- RPC с сохранением сроков годности по строкам (read production_date/expiry_date из jsonb).
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
set search_path = public, pg_temp
as $$
declare
  v_receipt_id uuid;
  v_total numeric := 0;
  v_item jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_unit_cost numeric;
  v_line_total numeric;
  v_is_bonus boolean;
  v_loc_type text;
  v_prod_date date;
  v_exp_date date;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'inventory-receipt-items-required';
  end if;

  if p_supplier_id is not null
     and nullif(trim(coalesce(p_invoice_file_url, '')), '') is null then
    raise exception 'inventory-receipt-invoice-required';
  end if;

  select location_type into v_loc_type
  from public.inventory_locations
  where id = p_location_id;

  if v_loc_type is null then
    raise exception 'inventory-receipt-location-not-found';
  end if;

  insert into public.inventory_receipts (
    location_id, supplier_id, received_at, invoice_number, invoice_file_url, comment, created_by
  )
  values (
    p_location_id, p_supplier_id, p_received_at,
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
    v_is_bonus := coalesce((v_item ->> 'is_bonus')::boolean, false);
    v_unit_cost := case when v_is_bonus then 0 else coalesce((v_item ->> 'unit_cost')::numeric, 0) end;
    v_prod_date := nullif(v_item ->> 'production_date', '')::date;
    v_exp_date := nullif(v_item ->> 'expiry_date', '')::date;

    if v_item_id is null or v_qty <= 0 then
      raise exception 'inventory-receipt-line-invalid';
    end if;

    v_line_total := round(v_qty * v_unit_cost, 2);
    v_total := v_total + v_line_total;

    insert into public.inventory_receipt_items (
      receipt_id, item_id, quantity, unit_cost, total_cost, is_bonus, comment,
      production_date, expiry_date
    )
    values (
      v_receipt_id, v_item_id, v_qty, v_unit_cost, v_line_total, v_is_bonus,
      nullif(trim(coalesce(v_item ->> 'comment', '')), ''),
      v_prod_date, v_exp_date
    );

    perform public.inventory_apply_balance_delta(p_location_id, v_item_id, v_qty);

    if p_supplier_id is not null then
      update public.inventory_items
      set primary_supplier_id = p_supplier_id,
          updated_at = timezone('utc', now())
      where id = v_item_id;
    end if;

    insert into public.inventory_movements (
      item_id, movement_type, to_location_id, quantity,
      unit_cost, total_amount, reference_type, reference_id, comment, actor_user_id
    )
    values (
      v_item_id, 'receipt', p_location_id, v_qty, v_unit_cost, v_line_total,
      'inventory_receipt', v_receipt_id,
      nullif(trim(coalesce(v_item ->> 'comment', '')), ''),
      p_created_by
    );
  end loop;

  update public.inventory_receipts
  set total_amount = round(v_total, 2)
  where id = v_receipt_id;

  return query select v_receipt_id, round(v_total, 2);
end;
$$;

notify pgrst, 'reload schema';
