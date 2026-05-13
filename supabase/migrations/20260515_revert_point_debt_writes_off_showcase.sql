-- Откат миграции 20260514_point_debt_writes_off_showcase.
--
-- Причина: оператор использует старую версию desktop-клиента, где долги
-- ведутся как accounting (учёт суммы), а не как списание с витрины.
-- Новая логика инициирует movement_type='point_debt_taken', которого нет
-- в check-констрейнте inventory_movements_movement_type_check, и оператор
-- получает ошибку при попытке оформить долг.
--
-- Эта миграция возвращает функцию к состоянию 20260405_point_debt_accounting_only:
--   - inventory_balances не трогаем
--   - inventory_movements не пишем
--   - inventory_location_id у point_debt_items = NULL
--
-- Когда будете готовы перейти на новую модель (после Этапа D плана —
-- полная инвентаризация + раскатка нового клиента), напишите новую
-- миграцию v9.1, где movement_type будет 'debt' (он уже в CHECK), а не
-- 'point_debt_taken'.

-- Сначала уберём возможные перегрузки, чтобы create or replace был
-- однозначен и comment on function не падал на ambiguity.
drop function if exists public.inventory_create_point_debt(
  uuid, uuid, uuid, uuid, text, text, text,
  integer, numeric, numeric, text, date, text, text
);

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
  p_created_by_operator_id uuid default null
)
returns table (
  debt_item_id uuid,
  inventory_item_id uuid
)
language plpgsql
as $fn_create_debt$
declare
  v_inventory_item_id uuid;
  v_debt_item_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'inventory-debt-quantity-invalid';
  end if;

  -- Находим товар по штрихкоду или имени (как в v8.5)
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

  -- Accounting-only: запись в point_debt_items без списания остатков.
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
    created_by_operator_id
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
    null,
    p_created_by_operator_id
  )
  returning id into v_debt_item_id;

  return query
  select v_debt_item_id, v_inventory_item_id;
end;
$fn_create_debt$;

comment on function public.inventory_create_point_debt(
  uuid, uuid, uuid, uuid, text, text, text,
  integer, numeric, numeric, text, date, text, text, uuid
) is
  'v8.5 (откат): accounting-only — фиксирует долг в point_debt_items без списания остатков. Возврат к 20260405-поведению.';

notify pgrst, 'reload schema';
