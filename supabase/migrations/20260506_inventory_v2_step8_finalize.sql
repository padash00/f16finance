-- ─────────────────────────────────────────────────────────────────────────
-- Шаг 8 рефактора: финальная чистка и жёсткие правила в БД.
--
-- 1. Удалить все catalog_total локации (никто их не читает и не пишет
--    после шагов 5-6; ничего не ломается)
-- 2. Удалить тип 'catalog_total' из CHECK constraint
-- 3. Удалить уникальный индекс на catalog_total
-- 4. Триггер валидации движений: гарантируем, что в БД не появится
--    movement с неправильным направлением (sale не из подсобки и т.п.)
-- ─────────────────────────────────────────────────────────────────────────


-- 1. Удаляем catalog_total локации.
-- inventory_balances удалятся автоматически (FK on delete cascade).
-- inventory_movements: from_location_id/to_location_id обнулится (FK on delete set null).
delete from public.inventory_locations
where location_type = 'catalog_total';


-- 2. Удалить уникальный индекс catalog_total
drop index if exists public.inventory_locations_catalog_total_company_uidx;


-- 3. Обновить CHECK constraint: только warehouse и point_display
alter table public.inventory_locations
  drop constraint if exists inventory_locations_location_type_check;

alter table public.inventory_locations
  add constraint inventory_locations_location_type_check
  check (location_type in ('warehouse', 'point_display'));


-- 4. Триггер валидации движений inventory_movements
--    Гарантирует, что новые движения создаются с правильным направлением
--    относительно типа локации.

create or replace function public.inventory_validate_movement_v2()
returns trigger
language plpgsql
as $$
declare
  v_from_type text;
  v_to_type text;
begin
  if new.from_location_id is not null then
    select location_type into v_from_type
    from public.inventory_locations where id = new.from_location_id;
  end if;
  if new.to_location_id is not null then
    select location_type into v_to_type
    from public.inventory_locations where id = new.to_location_id;
  end if;

  case new.movement_type
    when 'sale' then
      -- Продажа списывается ТОЛЬКО с витрины
      if v_from_type is null or v_from_type <> 'point_display' then
        raise exception 'inventory-movement-validation-sale-from-must-be-showcase';
      end if;

    when 'return' then
      -- Возврат с кассы идёт ТОЛЬКО на витрину
      if v_to_type is null or v_to_type <> 'point_display' then
        raise exception 'inventory-movement-validation-return-to-must-be-showcase';
      end if;

    when 'transfer_warehouse_to_showcase' then
      -- Получение точкой: склад → витрина
      if v_from_type <> 'warehouse' or v_to_type <> 'point_display' then
        raise exception 'inventory-movement-validation-transfer-w2s';
      end if;

    when 'transfer_showcase_to_warehouse' then
      -- Возврат на склад с витрины: витрина → склад
      if v_from_type <> 'point_display' or v_to_type <> 'warehouse' then
        raise exception 'inventory-movement-validation-transfer-s2w';
      end if;

    when 'reservation' then
      -- Резерв создаётся ТОЛЬКО на складе
      if v_from_type is null or v_from_type <> 'warehouse' then
        raise exception 'inventory-movement-validation-reservation-must-be-warehouse';
      end if;

    when 'reservation_release' then
      -- Снятие резерва — также только склад
      if v_from_type is null or v_from_type <> 'warehouse' then
        raise exception 'inventory-movement-validation-reservation-release-must-be-warehouse';
      end if;

    when 'receipt' then
      -- Приёмка/оприходование — на склад или витрину
      if v_to_type is null or v_to_type not in ('warehouse', 'point_display') then
        raise exception 'inventory-movement-validation-receipt-to-must-be-warehouse-or-showcase';
      end if;

    when 'writeoff' then
      -- Списание — со склада или с витрины
      if v_from_type is null or v_from_type not in ('warehouse', 'point_display') then
        raise exception 'inventory-movement-validation-writeoff-from-must-be-warehouse-or-showcase';
      end if;

    -- Остальные типы (inventory_adjustment, set_stock, debt, posting, receipt_cancel,
    -- transfer_cancel, transfer_to_point, auto_warehouse_to_showcase, migration_initial)
    -- проверяются мягко — это либо корректировки, либо legacy.
    else null;
  end case;

  return new;
end;
$$;

drop trigger if exists trg_inventory_validate_movement_v2 on public.inventory_movements;
create trigger trg_inventory_validate_movement_v2
before insert on public.inventory_movements
for each row
execute function public.inventory_validate_movement_v2();

comment on function public.inventory_validate_movement_v2 is
  'Жёсткая валидация направления движений: sale только из витрины, transfer_warehouse_to_showcase строго склад→витрина, и т.д. Срабатывает только на INSERT.';


-- 5. Защита от создания новых локаций типа catalog_total
-- (CHECK constraint уже не пропустит, но добавим явное сообщение)
create or replace function public.inventory_locations_block_catalog_total()
returns trigger
language plpgsql
as $$
begin
  if new.location_type = 'catalog_total' then
    raise exception 'catalog_total больше не поддерживается. Используйте склад (warehouse) или витрину (point_display).';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_inventory_locations_block_catalog_total on public.inventory_locations;
create trigger trg_inventory_locations_block_catalog_total
before insert or update on public.inventory_locations
for each row
execute function public.inventory_locations_block_catalog_total();
