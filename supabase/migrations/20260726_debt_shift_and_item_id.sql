-- =====================================================================
-- Долги: привязка к смене (shift_id) + прямая ссылка на товар (p_item_id).
--
-- Аддитивно. Старые записи НЕ трогаем (никаких UPDATE/бэкфиллов).
--   • point_debt_items.shift_id — к какой смене относится долг (nullable).
--   • RPC inventory_create_point_debt: новый параметр p_item_id — если задан,
--     используем товар НАПРЯМУЮ (без резолва по штрихкоду/имени; уходит
--     неоднозначность при дублях). Поиск по barcode/name остаётся фолбэком
--     (старый сканер продолжит работать без релиза).
--   • shift_id заполняется RPC автоматически — текущая открытая смена точки.
-- =====================================================================

alter table public.point_debt_items
  add column if not exists shift_id uuid null references public.point_shifts(id) on delete set null;

create index if not exists idx_point_debt_items_shift
  on public.point_debt_items(shift_id) where shift_id is not null;

-- Пересоздаём RPC с новым параметром (сигнатура меняется → drop + create).
drop function if exists public.inventory_create_point_debt(
  uuid, uuid, uuid, uuid, text, text, text, integer, numeric, numeric, text, date, text, text, uuid);

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
  p_created_by_operator_id uuid default null,
  p_item_id uuid default null
)
returns table (
  debt_item_id uuid,
  inventory_item_id uuid
)
language plpgsql
set search_path = public
as $fn_create_debt$
declare
  v_inventory_item_id uuid;
  v_debt_item_id uuid;
  v_showcase_loc_id uuid;
  v_showcase_qty numeric;
  v_shift_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'inventory-debt-quantity-invalid';
  end if;

  -- Товар: прямая ссылка (сканер знает id) → без неоднозначного поиска.
  -- Иначе фолбэк — поиск по штрихкоду или имени.
  if p_item_id is not null then
    v_inventory_item_id := p_item_id;
  else
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
  end if;

  -- Текущая открытая смена точки → привязываем долг к ней.
  select id into v_shift_id
  from public.point_shifts
  where company_id = p_company_id and status = 'open'
  order by opened_at desc
  limit 1;

  -- Витрина точки (point_display).
  select id into v_showcase_loc_id
  from public.inventory_locations
  where company_id = p_company_id
    and location_type = 'point_display'
    and is_active = true
  limit 1;

  -- Проверяем остаток на витрине, если айтем найден и витрина существует.
  if v_inventory_item_id is not null and v_showcase_loc_id is not null then
    select coalesce(quantity, 0) into v_showcase_qty
    from public.inventory_balances
    where location_id = v_showcase_loc_id and item_id = v_inventory_item_id;

    v_showcase_qty := coalesce(v_showcase_qty, 0);

    if v_showcase_qty + 0.0001 < p_quantity then
      raise exception 'inventory-debt-insufficient-stock: % (showcase: %, requested: %)',
        p_item_name, v_showcase_qty, p_quantity;
    end if;
  end if;

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
    created_by_operator_id,
    shift_id
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
    case when v_inventory_item_id is not null then v_showcase_loc_id else null end,
    p_created_by_operator_id,
    v_shift_id
  )
  returning id into v_debt_item_id;

  -- Списываем с витрины + movement 'debt'.
  if v_inventory_item_id is not null and v_showcase_loc_id is not null then
    perform public.inventory_apply_balance_delta(
      v_showcase_loc_id, v_inventory_item_id, -p_quantity
    );

    insert into public.inventory_movements (
      item_id,
      movement_type,
      from_location_id,
      quantity,
      total_amount,
      reference_type,
      reference_id,
      comment,
      actor_user_id
    )
    values (
      v_inventory_item_id,
      'debt',
      v_showcase_loc_id,
      p_quantity,
      p_total_amount,
      'point_debt_create',
      v_debt_item_id,
      coalesce(nullif(trim(coalesce(p_comment, '')), ''), p_item_name),
      p_operator_id
    );
  end if;

  return query
  select v_debt_item_id, v_inventory_item_id;
end;
$fn_create_debt$;

notify pgrst, 'reload schema';
