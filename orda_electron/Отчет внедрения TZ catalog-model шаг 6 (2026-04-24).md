# Отчет внедрения TZ catalog-model — шаг 6

Дата: 2026-04-24  
Исполнитель: AI assistant (Cursor)  
Объем: пункт 6 из `TZ-inventory-catalog-model.md` (приёмки / списания / ревизии)

---

## Что сделано

Изменены/добавлены файлы:

- `supabase/migrations/20260424_inventory_controls_catalog_total_sync.sql` (новый)
- `app/api/admin/inventory/route.ts` (расширение допустимых `location_type` в типах payload)

---

## 1) SQL: синхронизация `catalog_total` в inventory controls

Файл: `supabase/migrations/20260424_inventory_controls_catalog_total_sync.sql`

### 1.1 `inventory_post_receipt(...)` (перезаписана)

Добавлена логика:

- определяет `location_type` и `company_id` для `p_location_id`;
- находит `catalog_total` локацию компании;
- сохраняет старую проводку в выбранную локацию (`p_location_id += qty`);
- дополнительно увеличивает `catalog_total += qty`, если приемка не в `catalog_total`.

Итог:

- приемка в `warehouse` поднимает и `warehouse`, и `catalog_total`;
- приемка в `catalog_total` поднимает только `catalog_total`;
- legacy-приемка в `point_display` также увеличивает `catalog_total`.

### 1.2 `inventory_post_writeoff(...)` (перезаписана)

Добавлена логика:

- определяет тип локации списания;
- если списание со `warehouse`:
  - уменьшает `warehouse`,
  - уменьшает `catalog_total`;
- если списание с витрины/не-warehouse:
  - уменьшает только `catalog_total`.

Движение `writeoff` сохраняется с корректным `from_location_id`.

### 1.3 `inventory_post_stocktake(...)` (перезаписана)

Добавлена логика:

- базовый пересчет `p_location_id` сохранен (как раньше);
- если ревизия по `warehouse`, после обновления склада синхронизирует `catalog_total`:
  - целевой `catalog_total = counted_warehouse + counted_showcase`,
  - `counted_showcase` берется:
    - из `item.counted_showcase`, если поле передано;
    - иначе fallback: текущее derived `max(0, catalog_current - counted_warehouse)`.
- пишет отдельный movement `inventory_adjustment` с `reference_type='inventory_stocktake_catalog_sync'` при изменении `catalog_total`.

---

## 2) API типы: разрешен `catalog_total` как location_type

Файл: `app/api/admin/inventory/route.ts`

В type payload расширены union-типизации:

- `ReceiptBody.payload.location_type`
- `WriteoffBody.payload.location_type`
- `StocktakeBody.payload.location_type`
- helper `resolveLocationId(...).payload.location_type`

Было: `'warehouse' | 'point_display'`  
Стало: `'warehouse' | 'point_display' | 'catalog_total'`

Это нужно для безопасного вызова API в новых сценариях и для совместимости с обновленными SQL-функциями.

---

## Что сделать после изменений

Применить миграцию:

- `supabase/migrations/20260424_inventory_controls_catalog_total_sync.sql`

И проверить:

1. Приёмка в `warehouse` увеличивает и `warehouse`, и `catalog_total`.
2. Списание со склада уменьшает оба.
3. Списание с витрины уменьшает только `catalog_total`.
4. Ревизия склада корректирует `warehouse` и синхронизирует `catalog_total`.
