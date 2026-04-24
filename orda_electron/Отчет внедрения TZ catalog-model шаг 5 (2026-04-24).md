# Отчет внедрения TZ catalog-model — шаг 5

Дата: 2026-04-24  
Исполнитель: AI assistant (Cursor)  
Объем: пункт 5 из `TZ-inventory-catalog-model.md`

---

## Что сделано

Изменены/добавлены файлы:

- `app/api/point/inventory-sales/route.ts`
- `supabase/migrations/20260424_point_sale_catalog_total_autotransfer.sql`

---

## 1) Point API переведен на `catalog_total`

Файл: `app/api/point/inventory-sales/route.ts`

### Изменение в `resolveStockLocations(...)`

- Было:
  - поиск `location_type in ('catalog', 'warehouse')`
  - `catalogId` выбирался из `location_type === 'catalog'`
- Стало:
  - поиск `location_type in ('catalog_total', 'warehouse')`
  - `catalogId` выбирается из `location_type === 'catalog_total'`

Эффект:

- GET/POST sales теперь читают доступный showcase (derived) через `catalog_total - warehouse`.
- Нотификация low-stock (`checkAndNotifyLowStock`) получает корректный `catalogId` новой модели.

---

## 2) SQL-функция продажи `inventory_create_point_sale` переписана

Файл: `supabase/migrations/20260424_point_sale_catalog_total_autotransfer.sql`

Миграция делает `create or replace function public.inventory_create_point_sale(...)` с новой логикой:

1. Ищет `catalog_total` локацию компании (обязательна).  
2. Ищет `warehouse` локацию компании (опциональна, для auto-transfer).  
3. Валидирует, что `catalog_total` хватает на каждую строку продажи.  
4. При проведении:
   - `catalog_total -= sold_qty` для каждой позиции;
   - если после этого `warehouse > catalog_total`, автоматически:
     - уменьшает `warehouse` на `shortage`,
     - пишет movement `transfer_to_point` с `reference_type='auto_warehouse_to_showcase'`.
5. movement `sale` теперь пишется с `from_location_id = catalog_total`.

Это реализует требование ТЗ:

- продажа списывает с общего остатка точки (`catalog_total`);
- физический недостающий товар “подтягивается” со склада автоматически.

---

## Что важно сделать после кода

Применить миграцию:

- `supabase/migrations/20260424_point_sale_catalog_total_autotransfer.sql`

И проверить сценарий:

1. В `catalog_total` товара больше, чем на витрине (derived),  
2. Продажа на сумму, где требуется авто-перенос,  
3. После продажи:
   - `catalog_total` уменьшился на sold qty,
   - `warehouse` уменьшился на auto-transfer shortage,
   - ошибок "insufficient showcase" нет, если в `catalog_total` хватает.
