-- =============================================================================
-- Performance indexes — апрель 2026
-- Покрывает самые частые запросы: доходы, расходы, смены, склад, аудит
-- =============================================================================

-- ─── INCOMES ─────────────────────────────────────────────────────────────────
-- Основной паттерн: WHERE date BETWEEN :from AND :to AND company_id IN (:ids) ORDER BY date DESC

create index if not exists idx_incomes_company_date
  on public.incomes (company_id, date desc);

-- Для суперадмина (без фильтра по company_id): ORDER BY date DESC
create index if not exists idx_incomes_date
  on public.incomes (date desc);

-- Фильтр по оператору + дата (страница доходов, KPI)
create index if not exists idx_incomes_operator_date
  on public.incomes (operator_id, date desc);

-- Фильтр по смене (day/night)
create index if not exists idx_incomes_shift_date
  on public.incomes (shift, date desc)
  where shift is not null;

-- ─── EXPENSES ────────────────────────────────────────────────────────────────
-- Основной паттерн: WHERE date BETWEEN :from AND :to AND company_id IN (:ids)

create index if not exists idx_expenses_company_date
  on public.expenses (company_id, date desc);

-- Без фильтра по компании (суперадмин)
create index if not exists idx_expenses_date
  on public.expenses (date desc);

-- Фильтр по категории (страница анализа расходов)
create index if not exists idx_expenses_category_date
  on public.expenses (category, date desc)
  where category is not null;

-- ─── SHIFTS ──────────────────────────────────────────────────────────────────
-- Точечный поиск: WHERE company_id = X AND date = Y AND shift_type = Z
create index if not exists idx_shifts_company_date_type
  on public.shifts (company_id, date, shift_type);

-- Диапазонный поиск: WHERE date BETWEEN :from AND :to AND company_id IN (:ids)
create index if not exists idx_shifts_date_company
  on public.shifts (date desc, company_id);

-- ─── INVENTORY BALANCES ──────────────────────────────────────────────────────
-- Главный запрос склада: WHERE location_id = X ORDER BY quantity DESC
create index if not exists idx_inventory_balances_location_qty
  on public.inventory_balances (location_id, quantity desc);

-- Поиск конкретного товара на локации: WHERE location_id = X AND item_id = Y
create index if not exists idx_inventory_balances_location_item
  on public.inventory_balances (location_id, item_id);

-- ─── INVENTORY MOVEMENTS ─────────────────────────────────────────────────────
-- История движений по локации: WHERE from_location_id = X OR to_location_id = X
create index if not exists idx_inventory_movements_from_location_date
  on public.inventory_movements (from_location_id, created_at desc)
  where from_location_id is not null;

create index if not exists idx_inventory_movements_to_location_date
  on public.inventory_movements (to_location_id, created_at desc)
  where to_location_id is not null;

-- ─── INVENTORY REQUESTS ──────────────────────────────────────────────────────
-- Заявки компании: WHERE requesting_company_id = X AND status = Y ORDER BY created_at DESC
create index if not exists idx_inventory_requests_company_status_date
  on public.inventory_requests (requesting_company_id, status, created_at desc);

-- ─── AUDIT LOG ───────────────────────────────────────────────────────────────
-- Главный запрос логов: ORDER BY created_at DESC LIMIT 300
create index if not exists idx_audit_log_created_at
  on public.audit_log (created_at desc);

-- Поиск по типу сущности: WHERE entity_type = X ORDER BY created_at DESC
create index if not exists idx_audit_log_entity_type_date
  on public.audit_log (entity_type, created_at desc);

-- Поиск по конкретной сущности: WHERE entity_type = X AND entity_id = Y
create index if not exists idx_audit_log_entity
  on public.audit_log (entity_type, entity_id, created_at desc);

-- Действия конкретного пользователя
create index if not exists idx_audit_log_actor_date
  on public.audit_log (actor_user_id, created_at desc)
  where actor_user_id is not null;

-- ─── POINT SALES ─────────────────────────────────────────────────────────────
-- Продажи по компании + дата (дашборд, отчёты)
create index if not exists idx_point_sales_company_date
  on public.point_sales (company_id, created_at desc)
  where company_id is not null;

-- ─── CUSTOMERS ───────────────────────────────────────────────────────────────
-- Сортировка по сумме покупок: WHERE company_id = X ORDER BY total_spent DESC
create index if not exists idx_customers_company_total_spent
  on public.customers (company_id, total_spent desc nulls last)
  where is_active = true;

-- Поиск по телефону (partial index для активных)
create index if not exists idx_customers_phone
  on public.customers (phone)
  where phone is not null and is_active = true;

-- ─── OPERATOR SALARY ADJUSTMENTS ─────────────────────────────────────────────
-- Поиск бонусов/штрафов по компании + неделе (расчёт зарплат)
create index if not exists idx_operator_salary_adjustments_company_week
  on public.operator_salary_adjustments (company_id, salary_week_id);
