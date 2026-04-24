# Отчет внедрения TZ catalog-model — шаг 4

Дата: 2026-04-24  
Исполнитель: AI assistant (Cursor)  
Объем: пункт 4 из `TZ-inventory-catalog-model.md`

---

## Что сделано

Изменены/добавлены файлы:

- `supabase/migrations/20260424_inventory_request_warehouse_only.sql` (новый)
- `app/api/point/inventory-requests/route.ts` (правка target fallback)

---

## 1) Миграция: одобрение заявки списывает только склад

Файл: `supabase/migrations/20260424_inventory_request_warehouse_only.sql`

Создана миграция `create or replace function public.inventory_decide_request(...)`:

- сохранены проверки:
  - `inventory-request-not-found`
  - `inventory-request-already-decided`
  - валидации строк решения (`decision-line-missing`, `approved-qty-invalid`, `approved-qty-exceeds-requested`).
- при `approved = false`:
  - как и раньше: `approved_qty = 0`, статус `rejected`, проставление `approved_by/approved_at`.
- при `approved = true`:
  - по каждой позиции выполняется **только**
    - `inventory_apply_balance_delta(source_location_id, item_id, -approved_qty)`
  - удалено начисление в target-локацию;
  - движение `inventory_movements` сохраняется для аудита с `from_location_id = source`, `to_location_id = target`.

Итог: физическая витрина (`point_display`) больше не растет при одобрении заявки, что соответствует новой модели (витрина derived).

---

## 2) Point API: fallback target локации под новую модель

Файл: `app/api/point/inventory-requests/route.ts`

В `resolvePointInventoryContext(...)`:

- было:
  - fallback target по `location_type in ('point_display', 'catalog')`
- стало:
  - fallback target по `location_type in ('point_display', 'catalog_total')`

Это убирает зависимость от старого `catalog` location_type.

---

## Примечание

- Для вступления логики в силу нужно применить новую SQL-миграцию.
- После применения шаг 4 будет соответствовать ТЗ: заявки оператора затрагивают только `warehouse`, а витрина считается формулой.
