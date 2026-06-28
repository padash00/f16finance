-- Точечные индексы под РЕАЛЬНЫЕ горячие точки (по анализу pg_stat seq_scan).
-- Большинство «полных сканов» — на крошечных таблицах (<4k строк), где Postgres
-- сам выбирает seq scan (он быстрее индекса) — там трогать НЕ нужно.
-- Здесь только 2 настоящих пробела. Таблицы маленькие → индексы строятся мгновенно.

-- 1. inventory_stocktake_items: позиции ревизии грузятся по stocktake_id (FK),
--    но индекса не было (только PK) → полный скан (idx_scan был ~5). Самый явный пробел.
create index if not exists idx_inventory_stocktake_items_stocktake
  on public.inventory_stocktake_items (stocktake_id);

-- 2. point_sales: дашборд фильтрует по sale_date в рамках компании, а индексы
--    вели по location_id/created_at (sale_date в них не ведущая колонка) → скан.
create index if not exists idx_point_sales_company_sale_date
  on public.point_sales (company_id, sale_date desc);
