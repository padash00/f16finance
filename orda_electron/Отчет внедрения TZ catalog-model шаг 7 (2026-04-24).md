# Отчет внедрения TZ catalog-model — шаг 7

Дата: 2026-04-24  
Исполнитель: AI assistant (Cursor)  
Объем: финальная шлифовка API под `catalog_total` + derived showcase

---

## Что сделано

Изменены файлы:

- `app/api/client/catalog/route.ts`
- `app/api/admin/notifications/route.ts`
- `app/api/pos/bootstrap/route.ts`
- `app/api/admin/store/warehouse/route.ts`

---

## 1) Client catalog API переведен на `catalog_total`

Файл: `app/api/client/catalog/route.ts`

Изменения:

- запрос локаций:
  - было `location_type in ('catalog', 'warehouse')`
  - стало `location_type in ('catalog_total', 'warehouse')`
- агрегация:
  - было чтение `meta.type === 'catalog'`
  - стало `meta.type === 'catalog_total'`

Эффект:

- `qty_on_display` для клиентского каталога считается из новой модели (`catalog_total - warehouse`).

---

## 2) Notifications API (низкие остатки) переведен на `catalog_total`

Файл: `app/api/admin/notifications/route.ts`

Изменения:

- выбор inventory локаций для low-stock:
  - было `['catalog', 'warehouse']`
  - стало `['catalog_total', 'warehouse']`
- накопление `catalogQty`:
  - было при `location_type === 'catalog'`
  - стало при `location_type === 'catalog_total'`

Эффект:

- блок уведомлений "Низкие остатки" использует корректный источник total-остатка.

---

## 3) POS bootstrap переведен на `catalog_total`

Файл: `app/api/pos/bootstrap/route.ts`

Изменения:

- запрос `allLocations`:
  - было `['catalog', 'warehouse']`
  - стало `['catalog_total', 'warehouse']`
- построение маппинга:
  - было `if location_type === 'catalog'`
  - стало `if location_type === 'catalog_total'`

Эффект:

- данные кассы (`items.total_balance` и `location_balances`) считаются из актуальной модели.

---

## 4) Preview backroom upload в warehouse API согласован с derived showcase

Файл: `app/api/admin/store/warehouse/route.ts`

Изменения в `action === 'previewBackroomUpload'`:

- дополнительно резолвится `catalog_total` локация;
- вместо чтения физического `point_display` как showcase:
  - читается `current_catalog_total` из `catalog_total`;
  - `current_showcase` вычисляется как `max(0, catalog_total - warehouse)`;
- `new_catalog` теперь остается равным текущему `catalog_total` (не пересчитывается из warehouse);
- `new_showcase` вычисляется derived от `new_warehouse`;
- добавлен флаг `warehouse_exceeds_catalog`.

Эффект:

- превью Excel-загрузки подсобки отображает корректную математику новой модели и явно показывает конфликт `warehouse > catalog_total`.

---

## Примечание

- Эти изменения не требуют новых SQL-миграций.
- Это слой согласования API, чтобы не оставалось legacy-`catalog` ссылок в ключевых пользовательских потоках.
