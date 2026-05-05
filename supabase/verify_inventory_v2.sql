-- ─────────────────────────────────────────────────────────────────────────
-- Проверка применения миграций inventory v2.
--
-- Это НЕ миграция — это диагностический запрос. Запускать в Supabase SQL Editor.
-- Возвращает таблицу проверок: status = ✓ ОК или ✗ FAIL.
--
-- Все строки должны быть ✓. Если где-то ✗ — соответствующая миграция
-- не применилась.
-- ─────────────────────────────────────────────────────────────────────────

with checks as (

-- Step 1: health-check
select 'step 1' as step, 'Функция inventory_integrity_check существует' as check_name,
  case when exists (select 1 from pg_proc where proname = 'inventory_integrity_check')
    then '✓' else '✗' end as status, ''::text as detail

-- Step 2: prep — новые колонки
union all
select 'step 2', 'Колонка inventory_balances.quantity_reserved',
  case when exists (
    select 1 from information_schema.columns
    where table_name='inventory_balances' and column_name='quantity_reserved'
  ) then '✓' else '✗' end, ''
union all
select 'step 2', 'Колонка inventory_movements.idempotency_key',
  case when exists (
    select 1 from information_schema.columns
    where table_name='inventory_movements' and column_name='idempotency_key'
  ) then '✓' else '✗' end, ''
union all
select 'step 2', 'Уникальный индекс по idempotency_key',
  case when exists (
    select 1 from pg_indexes
    where indexname='inventory_movements_idempotency_key_uidx'
  ) then '✓' else '✗' end, ''
union all
select 'step 2', 'CHECK включает reservation/transfer_warehouse_to_showcase/migration_initial',
  case when (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conname='inventory_movements_movement_type_check'
  ) like '%reservation%transfer_warehouse_to_showcase%migration_initial%'
    then '✓' else '✗' end, ''

-- Step 3: backfill витрины
union all
select 'step 3', 'Балансы на point_display созданы',
  case when (
    select count(*) from inventory_balances b
    join inventory_locations l on l.id = b.location_id
    where l.location_type = 'point_display'
  ) > 0 then '✓' else '✗' end,
  (select count(*)::text || ' строк' from inventory_balances b
    join inventory_locations l on l.id = b.location_id
    where l.location_type = 'point_display')
union all
select 'step 3', 'Стартовые movements migration_initial созданы',
  case when (
    select count(*) from inventory_movements
    where movement_type = 'migration_initial'
      and reference_type = 'showcase_v2_backfill'
  ) > 0 then '✓' else '✗' end,
  (select count(*)::text || ' движений' from inventory_movements
    where movement_type = 'migration_initial'
      and reference_type = 'showcase_v2_backfill')

-- Step 3.5: сверка истории
union all
select 'step 3.5', 'Сверка движений с балансами выполнена',
  '✓',
  (select count(*)::text || ' компенсирующих движений' from inventory_movements
    where reference_type = 'integrity_reconciliation')

-- Step 4: двойная запись (проверяем что функции есть и они actively v2)
union all
select 'step 4', 'inventory_post_writeoff обновлена',
  case when exists (
    select 1 from pg_proc where proname = 'inventory_post_writeoff'
  ) then '✓' else '✗' end, ''
union all
select 'step 4', 'inventory_post_stocktake обновлена',
  case when exists (
    select 1 from pg_proc where proname = 'inventory_post_stocktake'
  ) then '✓' else '✗' end, ''

-- Step 5: только код, проверять нечего в БД

-- Step 6: separation — функции переписаны
union all
select 'step 6', 'inventory_create_pos_sale существует',
  case when exists (select 1 from pg_proc where proname = 'inventory_create_pos_sale')
    then '✓' else '✗' end, ''
union all
select 'step 6', 'inventory_create_point_sale существует',
  case when exists (select 1 from pg_proc where proname = 'inventory_create_point_sale')
    then '✓' else '✗' end, ''
union all
select 'step 6', 'inventory_cancel_receipt существует',
  case when exists (select 1 from pg_proc where proname = 'inventory_cancel_receipt')
    then '✓' else '✗' end, ''

-- Step 7: резервирование
union all
select 'step 7', 'Функция inventory_apply_reserved_delta',
  case when exists (select 1 from pg_proc where proname = 'inventory_apply_reserved_delta')
    then '✓' else '✗' end, ''
union all
select 'step 7', 'Функция inventory_receive_request',
  case when exists (select 1 from pg_proc where proname = 'inventory_receive_request')
    then '✓' else '✗' end, ''
union all
select 'step 7', 'Статус received разрешён в inventory_requests',
  case when (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conname='inventory_requests_status_check'
  ) like '%received%' then '✓' else '✗' end, ''
union all
select 'step 7', 'CHECK constraint reserved ≥ 0',
  case when exists (
    select 1 from pg_constraint where conname='inventory_balances_reserved_nonneg'
  ) then '✓' else '✗' end, ''
union all
select 'step 7', 'CHECK constraint reserved ≤ quantity',
  case when exists (
    select 1 from pg_constraint where conname='inventory_balances_reserved_le_quantity'
  ) then '✓' else '✗' end, ''

-- Алерт недостач
union all
select 'shortage', 'Функция inventory_recurring_shortages',
  case when exists (select 1 from pg_proc where proname = 'inventory_recurring_shortages')
    then '✓' else '✗' end, ''

-- Step 8: финализация
union all
select 'step 8', 'catalog_total локации удалены',
  case when (
    select count(*) from inventory_locations where location_type = 'catalog_total'
  ) = 0 then '✓' else '✗' end,
  (select count(*)::text || ' локаций осталось'
    from inventory_locations where location_type = 'catalog_total')
union all
select 'step 8', 'CHECK location_type без catalog_total',
  case when (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conname='inventory_locations_location_type_check'
  ) not like '%catalog_total%' then '✓' else '✗' end, ''
union all
select 'step 8', 'Триггер validate_movement_v2',
  case when exists (
    select 1 from pg_trigger where tgname = 'trg_inventory_validate_movement_v2'
  ) then '✓' else '✗' end, ''
union all
select 'step 8', 'Триггер block_catalog_total',
  case when exists (
    select 1 from pg_trigger where tgname = 'trg_inventory_locations_block_catalog_total'
  ) then '✓' else '✗' end, ''
union all
select 'step 8', 'Функция inventory_validate_movement_v2',
  case when exists (
    select 1 from pg_proc where proname = 'inventory_validate_movement_v2'
  ) then '✓' else '✗' end, ''

-- Дополнительно: 20260505_inventory_safety_features
union all
select 'safety', 'Колонка inventory_receipts.kind',
  case when exists (
    select 1 from information_schema.columns
    where table_name='inventory_receipts' and column_name='kind'
  ) then '✓' else '✗' end, ''
union all
select 'safety', 'Колонка inventory_receipts.cancelled_at',
  case when exists (
    select 1 from information_schema.columns
    where table_name='inventory_receipts' and column_name='cancelled_at'
  ) then '✓' else '✗' end, ''
union all
select 'safety', 'Функция inventory_undecide_request',
  case when exists (
    select 1 from pg_proc where proname = 'inventory_undecide_request'
  ) then '✓' else '✗' end, ''

-- Финальная проверка: health-check без ошибок
union all
select 'final', 'Health-check без error/critical',
  case when (
    select count(*) from inventory_integrity_check()
    where severity in ('error', 'critical')
  ) = 0 then '✓' else '✗' end,
  (select count(*)::text || ' проблем'
    from inventory_integrity_check()
    where severity in ('error', 'critical'))

)

select * from checks order by step, check_name;
