# Отчет внедрения TZ catalog-model — шаг 1

Дата: 2026-04-24  
Исполнитель: AI assistant (Cursor)  
Объем: только пункт 1 из `TZ-inventory-catalog-model.md` (миграция БД)

---

## Что было сделано

Создан новый файл миграции:

- `supabase/migrations/20260424_inventory_catalog_total_step1.sql`

Ниже детально по изменениям внутри файла (строки указаны для этого нового файла).

### 1) Изменение CHECK-constraint для `inventory_locations.location_type`

- **Строки 7-12**:
  - удален старый constraint `inventory_locations_location_type_check`;
  - добавлен новый constraint, разрешающий:
    - `warehouse`
    - `point_display`
    - `catalog_total`

Цель: легализовать новый тип локации `catalog_total`.

### 2) Добавлен уникальный индекс на `catalog_total` per company

- **Строки 15-17**:
  - создан partial unique index `inventory_locations_catalog_total_company_uidx`
  - условие: `location_type = 'catalog_total' and company_id is not null`

Цель: гарантировать, что у каждой компании только одна локация `catalog_total`.

### 3) Создание `catalog_total` для компаний с активной витриной

- **Строки 20-48**:
  - `insert ... select` из `inventory_locations pd`, где:
    - `pd.location_type = 'point_display'`
    - `pd.is_active = true`
    - `pd.company_id is not null`
  - переносится `organization_id`;
  - имя: `Каталог - <company_name>`;
  - код: `CT-<company_code>` или fallback `CT-<8 chars company_id>`;
  - используется `on conflict do nothing` (совместимо с состояниями схемы, где conflict-target не выводится как unique constraint для partial index).

### 3.1) Пост-фикс после ошибки `42P10`

- После первого запуска получена ошибка:
  - `there is no unique or exclusion constraint matching the ON CONFLICT specification`
- Причина: `ON CONFLICT (company_id, location_type) WHERE ...` не всегда может быть выведен как conflict target в конкретном состоянии БД.
- Исправление:
  - заменен upsert на безопасный шаблон:
    1) `INSERT ... ON CONFLICT DO NOTHING`
    2) отдельный `UPDATE` существующих `catalog_total` строк.
- В SQL-файле это блоки:
  - `INSERT` с `on conflict do nothing`
  - `UPDATE public.inventory_locations ct ... from public.inventory_locations pd ...`

Цель: выполнить бэкофисное создание `catalog_total` per-company без дублей.

### 4) Обнуление физических остатков `point_display`

- **Строки 51-56**:
  - `delete from inventory_balances` по всем `location_id`, где локация `point_display`.

Цель: после шага 1 витрина не хранится физически, а считается как derived в следующих шагах.

---

## Что осознанно НЕ делалось на этом шаге

- Не изменялись API-роуты.
- Не переписывались SQL-функции продаж/возвратов/заявок.
- Не добавлялись UI-изменения.
- Не менялись триггеры автосоздания локаций.

Это соответствует просьбе «начать с пункта 1».

---

## Проверка перед следующим шагом (рекомендуется)

1. Применить миграцию.
2. Проверить, что у активной компании появилась локация `catalog_total`.
3. Проверить, что `inventory_balances` для `point_display` пусты.
4. Убедиться, что старые сценарии не пишут в `catalog_total` до реализации шага 2+.
