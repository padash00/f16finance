# Отчет внедрения TZ catalog-model — шаги 2-3

Дата: 2026-04-24  
Исполнитель: AI assistant (Cursor)  
Объем: пункты 2 и 3 из `TZ-inventory-catalog-model.md`

---

## Что было сделано

Изменены файлы:

- `app/api/admin/inventory/catalog/route.ts`
- `app/api/admin/store/warehouse/route.ts`

---

## 1) Пункт 2 ТЗ — импорт Wipon в `catalog_total`

Файл: `app/api/admin/inventory/catalog/route.ts`

### 1.1 Обновлен выбор целевой каталог-локации

- Обновлен helper `pickCentralCatalogId(...)`:
  - раньше приоритет был по `code = main-catalog`;
  - теперь приоритет по `code` c префиксом `CT-` (под `catalog_total`).

### 1.2 `confirmImport` теперь пишет остатки в `catalog_total`

- В блоке `confirmImport` заменен запрос локаций:
  - было: `.eq('location_type', 'catalog')`
  - стало: `.eq('location_type', 'catalog_total')`
- Сохранен выбор компании (если несколько точек, API продолжает требовать явный выбор).
- `inventory_balances.upsert` остался прежним по механике, но теперь `location_id` всегда от `catalog_total`.
- Обновлен текст ошибки:
  - было про `catalog location`;
  - стало про отсутствие активного `catalog_total`.

### 1.3 Сервисный reset остатков расширен под новую модель

- В `action === 'resetAllBalances'` расширен список типов локаций:
  - было: `['warehouse', 'point_display']`
  - стало: `['warehouse', 'point_display', 'catalog_total']`

---

## 2) Пункт 3 ТЗ — корректный GET для каталога/склада с derived витриной

### 2.1 `GET /api/admin/inventory/catalog`

Файл: `app/api/admin/inventory/catalog/route.ts`

Изменена логика агрегации балансов:

- Добавлена карта `catalogMap` из локаций `catalog_total`.
- `warehouse_qty` оставлен из `warehouse`.
- `showcase_qty` теперь вычисляется:
  - `Math.max(0, catalog_qty - warehouse_qty)`
- В ответ добавлено поле `catalog_qty`.
- `total_balance` теперь равен `catalog_qty` (а не `warehouse + point_display`).

Это убирает зависимость от физической `point_display` в каталоге.

### 2.2 `GET /api/admin/store/warehouse`

Файл: `app/api/admin/store/warehouse/route.ts`

Сделаны изменения:

- `ensureCompanyLocation(...)` расширен:
  - поддержка `locationType: 'catalog_total'`;
  - для автосоздания добавлены `prefix = CT`, `namePrefix = Каталог`.
- В GET одновременно резолвятся 3 локации:
  - `warehouse`, `point_display`, `catalog_total`.
- Балансы читаются по 3 `location_id` (вместо 2).
- Формирование ответа:
  - `catalog_quantity` берется напрямую из `catalog_total`;
  - `showcase_quantity` вычисляется derived:
    - `max(0, catalog_quantity - warehouse_quantity)`;
  - `quantity` приведен к `catalog_quantity`.
- В payload `data.catalog` теперь возвращается объект локации `catalog_total` (вместо `null`).

---

## Что осознанно не менялось в этом проходе

- Продажи POS/point (`/api/point/inventory-sales`) — это следующий шаг ТЗ.
- Логика одобрения заявок оператора (`/api/point/inventory-requests`) — следующий шаг ТЗ.
- Приемки/списания/ревизии под двойную синхронизацию `warehouse + catalog_total` — следующий шаг.

---

## Примечание по совместимости

- Поля ответа сохранены максимально совместимыми (`catalog_quantity`, `quantity`, `warehouse_quantity`, `showcase_quantity`).
- Источник `showcase_quantity` теперь derived, а не физический `point_display`.
