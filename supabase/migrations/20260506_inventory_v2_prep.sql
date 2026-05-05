-- ─────────────────────────────────────────────────────────────────────────
-- Шаг 2 рефактора: подготовка БД к новой модели «склад + витрина независимы».
--
-- Только ADD COLUMN / расширение CHECK constraint. Никакой логики не меняется.
-- Безопасно откатить: drop добавленных колонок и значений в check.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Резервы на балансах: для будущей логики «одобрено, но ещё не получено».
alter table public.inventory_balances
  add column if not exists quantity_reserved numeric(14, 3) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_balances_reserved_nonneg'
  ) then
    alter table public.inventory_balances
      add constraint inventory_balances_reserved_nonneg check (quantity_reserved >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_balances_reserved_le_quantity'
  ) then
    alter table public.inventory_balances
      add constraint inventory_balances_reserved_le_quantity check (quantity_reserved <= quantity);
  end if;
end $$;

-- 2. Идемпотентность: уникальный ключ операции, чтобы повторные запросы не дублировались.
alter table public.inventory_movements
  add column if not exists idempotency_key text null;

create unique index if not exists inventory_movements_idempotency_key_uidx
  on public.inventory_movements (idempotency_key)
  where idempotency_key is not null;

-- 3. Расширение типов движений для будущих операций v2.
--    Старые типы остаются — это аддитивно.
alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check (movement_type in (
    -- v1 (существующие)
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
    -- v2 (новые)
    'transfer_warehouse_to_showcase',  -- явный перенос склад→витрина (заявка получена)
    'transfer_showcase_to_warehouse',  -- обратный перенос
    'reservation',                      -- резерв на складе
    'reservation_release',              -- снятие резерва (отмена/откат)
    'migration_initial'                 -- стартовый остаток при миграции v1→v2
  ));

-- 4. Индекс для быстрого поиска движений по reference (уже частично есть, дополним).
create index if not exists inventory_movements_reference_idx
  on public.inventory_movements (reference_type, reference_id);

comment on column public.inventory_balances.quantity_reserved is
  'Резерв (зарезервировано под одобренные, но ещё не полученные заявки). Доступное = quantity - quantity_reserved.';
comment on column public.inventory_movements.idempotency_key is
  'Идемпотентный ключ операции. Уникален; защищает от двойных кликов в UI.';
