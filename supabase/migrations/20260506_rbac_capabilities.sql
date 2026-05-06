-- ─────────────────────────────────────────────────────────────────────────
-- RBAC Capabilities — гибкие права доступа на уровне действий
-- ─────────────────────────────────────────────────────────────────────────
-- Создаёт две новые таблицы:
--   1) role_capabilities (role, capability, granted)
--      — какие действия разрешены каждой роли
--   2) user_capability_overrides (user_id, capability, granted, reason, ...)
--      — переопределения для конкретного человека
--      (например: Иванов имеет роль manager, но ему лично запретили
--       salary.void_payment)
--
-- Существующая таблица `positions` используется как источник ролей.
-- Существующая таблица `role_permissions` (page-level) НЕ трогается —
-- продолжает работать параллельно.
--
-- Миграция backwards-compatible: всем существующим ролям засевает ВСЕ
-- capabilities как granted=true. Никто прав не теряет. Ограничение
-- происходит позже через UI на странице /access.
--
-- Идемпотентная: можно прогонять несколько раз без последствий.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Таблицы ────────────────────────────────────────────────────────────

create table if not exists role_capabilities (
  role text not null,
  capability text not null,
  granted boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (role, capability)
);

create index if not exists idx_role_capabilities_role on role_capabilities(role);
create index if not exists idx_role_capabilities_capability on role_capabilities(capability);

create table if not exists user_capability_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  capability text not null,
  granted boolean not null,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  primary key (user_id, capability)
);

create index if not exists idx_user_caps_user on user_capability_overrides(user_id);

-- ── 2. RLS политики ───────────────────────────────────────────────────────
-- Включаем RLS, разрешаем service_role (admin client) делать всё.
-- Залогиненный пользователь может читать только свои собственные права.

alter table role_capabilities enable row level security;
alter table user_capability_overrides enable row level security;

-- Политики для role_capabilities
drop policy if exists "service_role full access" on role_capabilities;
create policy "service_role full access" on role_capabilities
  to service_role
  using (true) with check (true);

drop policy if exists "authenticated read" on role_capabilities;
create policy "authenticated read" on role_capabilities
  for select to authenticated
  using (true);

-- Политики для user_capability_overrides
drop policy if exists "service_role full access overrides" on user_capability_overrides;
create policy "service_role full access overrides" on user_capability_overrides
  to service_role
  using (true) with check (true);

drop policy if exists "user reads own overrides" on user_capability_overrides;
create policy "user reads own overrides" on user_capability_overrides
  for select to authenticated
  using (user_id = auth.uid());

-- ── 3. Засев существующих ролей всеми capabilities ────────────────────────
-- Собираем все имеющиеся роли из:
--   - positions (если таблица есть): name
--   - role_permissions (если есть): distinct role
--   - staff (если есть и колонка role): distinct role
--   - builtin: owner, manager, marketer, other
-- Затем для каждой роли вставляем все capabilities из CAPABILITIES_LIST.

do $$
declare
  v_role text;
  v_capability text;
  v_capabilities text[] := array[
    -- Финансы — Доходы
    'income.view','income.create','income.edit','income.delete','income.export',
    'income.update_online','income.create_batch',
    -- Финансы — Расходы
    'expenses.view','expenses.create','expenses.edit','expenses.delete','expenses.export',
    'expenses.manage_templates',
    'expenses-pending.view','expenses-pending.approve','expenses-pending.decline',
    'expense-whitelist.view','expense-whitelist.create','expense-whitelist.delete',
    -- Финансы — Cashflow / ОПиУ / Kaspi
    'cashflow.view','cashflow.export',
    'profitability.view','profitability.edit','profitability.simulate',
    'kaspi-terminal.view','kaspi-terminal.create','kaspi-terminal.edit','kaspi-terminal.delete','kaspi-terminal.export','kaspi-terminal.reconcile',
    -- Финансы — Отчёты
    'weekly-report.view','weekly-report.export','weekly-report.share',
    'reports.view','reports.export',
    'forecast.view','forecast.generate',
    'analytics.view','analytics.export',
    'analysis.view','analysis.refresh','analysis.export',
    'tax.view',
    'point-debts.view','point-debts.mark_paid','point-debts.export',
    -- Склад — общая
    'store.view','store.export',
    'store-warehouse.view','store-warehouse.edit',
    'store-showcase.view','store-showcase.move',
    -- Склад — каталог
    'store-catalog.view','store-catalog.create','store-catalog.edit','store-catalog.delete',
    'store-catalog.export','store-catalog.import',
    'store-catalog.bulk_zero_stock','store-catalog.bulk_deactivate',
    'store-catalog.bulk_delete_empty','store-catalog.bulk_delete_all',
    -- Склад — приёмки и оприходование
    'store-receipts.view','store-receipts.create','store-receipts.edit','store-receipts.delete','store-receipts.export',
    'store-receipts.cancel','store-receipts.ai_parse',
    'store-postings.view','store-postings.create','store-postings.edit','store-postings.delete',
    -- Склад — заявки
    'store-requests.view','store-requests.create','store-requests.edit',
    'store-requests.approve','store-requests.bulk_approve',
    'store-requests.reject','store-requests.bulk_reject',
    'store-requests.issue','store-requests.receive','store-requests.undecide','store-requests.export',
    'store-requests-journal.view',
    -- Склад — ревизии и списания
    'store-revisions.view','store-revisions.create','store-revisions.edit','store-revisions.export',
    'store-revisions.commit','store-revisions.cancel',
    'store-writeoffs.view','store-writeoffs.create','store-writeoffs.edit','store-writeoffs.delete','store-writeoffs.export',
    'store-writeoffs.cancel',
    -- Склад — поставщики, расходники, движения
    'store-suppliers.view','store-suppliers.create','store-suppliers.edit',
    'store-consumables.view','store-consumables.create','store-consumables.edit','store-consumables.issue',
    'store-movements.view','store-movements.create',
    'store-forecast.view',
    'store-analytics.view','store-analytics.export','store-analytics.edit_sale_price',
    'store-billing.view',
    -- Смены
    'shifts.view','shifts.create','shifts.edit','shifts.delete',
    'shifts.copy_week','shifts.bulk_assign_week','shifts.publish_week','shifts.resolve_issue','shifts.export',
    'shifts-reports.view','shifts-reports.export',
    'shifts-reports.close_force','shifts-reports.purge','shifts-reports.reopen',
    -- Персонал — операторы
    'operators.view','operators.create','operators.edit','operators.delete',
    'operators.toggle_active','operators.bulk_delete','operators.promote','operators.save_assignments',
    -- Персонал — staff
    'staff.view','staff.create','staff.edit','staff.delete',
    'staff.invite','staff.toggle_status','staff.create_payment',
    'pass.view',
    -- Персонал — зарплата
    'salary.view','salary.create_advance','salary.create_payment','salary.create_adjustment',
    'salary.void_payment','salary.void_adjustment','salary.unlock_week','salary.update_chat_id',
    'salary-rules.view','salary-rules.create','salary-rules.edit','salary-rules.delete',
    'salary-rules.upsert_version','salary-rules.delete_version',
    'salary-rules.upsert_seniority','salary-rules.delete_seniority',
    -- Персонал — структура и аналитика
    'structure.view','structure.save_assignments',
    'hr.view',
    'operator-analytics.view','operator-analytics.export',
    'operator-tasks.view','operator-lead.view',
    -- Точки и оборудование
    'point-devices.view','point-devices.create','point-devices.edit','point-devices.delete',
    'point-devices.toggle_active','point-devices.rotate_token',
    'stations.view','stations.create_station','stations.edit_station','stations.delete_station',
    'stations.edit_theme','stations.create_zone','stations.edit_zone','stations.delete_zone',
    'stations.create_decoration','stations.delete_decoration',
    'stations.create_game_catalog','stations.edit_game_catalog','stations.delete_game_catalog',
    'stations.bulk_upsert_games','stations.edit_station_game','stations.delete_station_game',
    'stations.create_tariff','stations.edit_tariff','stations.delete_tariff',
    'stations.top_up_balance','stations.admin_start_session','stations.admin_end_session',
    'stations.rotate_provisioning_key','stations.update_branding','stations.update_map_layout',
    -- POS / Клиенты
    'pos-receipts.view','pos-receipts.print',
    'pos-returns.view','pos-returns.return',
    'customers.view','customers.create','customers.edit','customers.delete','customers.export',
    'discounts.view','discounts.create','discounts.edit','discounts.delete',
    -- Операционка
    'tasks.view','tasks.create','tasks.edit','tasks.delete',
    'tasks.complete','tasks.add_comment','tasks.respond','tasks.assign',
    'incidents.view','incidents.create','incidents.update','incidents.close',
    'kpi.view','kpi.generate_collective_plans',
    'goals.view','ratings.view','birthdays.view',
    -- Системные
    'dashboard.view','dashboard.dismiss_warning',
    'welcome.view','workspace.view',
    'access.view','access.create_role','access.edit_role','access.delete_role',
    'access.toggle_capability','access.bulk_capabilities',
    'access.manage_user_overrides','access.manage_staff_roles','access.reset_to_defaults',
    'settings.view','settings.manage_companies','settings.delete_company','settings.manage_categories',
    'telegram.view','telegram.toggle_connection','telegram.add_user','telegram.delete_user',
    'telegram.toggle_finance','telegram.edit_staff_telegram','telegram.setup_webhook','telegram.send_report',
    'logs.view','logs.export',
    'shift-telegram-audit.view',
    'categories.view','categories.create','categories.edit','categories.delete',
    'knowledge-admin.view','knowledge-admin.create','knowledge-admin.edit','knowledge-admin.delete',
    'knowledge-admin.publish','knowledge-admin.manage_checklists',
    'debug.view','debug.run_tests'
  ];
  v_existing_roles text[] := array['owner','manager','marketer','other','super_admin'];
begin
  -- Дополняем список ролей из таблицы positions, если она есть
  begin
    select array_agg(distinct name)
    into v_existing_roles
    from (
      select unnest(v_existing_roles) as name
      union
      select name from positions
    ) t;
  exception when undefined_table then
    -- positions нет — оставляем builtin
    null;
  end;

  -- Дополняем из role_permissions
  begin
    select array_agg(distinct name)
    into v_existing_roles
    from (
      select unnest(v_existing_roles) as name
      union
      select role from role_permissions
    ) t
    where name is not null;
  exception when undefined_table then
    null;
  end;

  -- Дополняем из staff.role
  begin
    select array_agg(distinct name)
    into v_existing_roles
    from (
      select unnest(v_existing_roles) as name
      union
      select role from staff where role is not null
    ) t
    where name is not null;
  exception when undefined_table then
    null;
  end;

  -- Засев: для каждой роли, для каждой capability — granted=true
  foreach v_role in array v_existing_roles loop
    foreach v_capability in array v_capabilities loop
      insert into role_capabilities (role, capability, granted)
      values (v_role, v_capability, true)
      on conflict (role, capability) do nothing;
    end loop;
  end loop;
end $$;

-- ── 4. Триггер для updated_at ─────────────────────────────────────────────

create or replace function touch_role_capabilities_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_role_capabilities_updated_at on role_capabilities;
create trigger trg_role_capabilities_updated_at
  before update on role_capabilities
  for each row execute function touch_role_capabilities_updated_at();

-- ── 5. Сводка после прогона ───────────────────────────────────────────────
-- Этот SELECT покажет сколько ролей засеяно и сколько capabilities.
-- Должно быть: roles ≥ 4 (как минимум builtin),
--              capabilities = 265 (тек. количество в каталоге)

do $$
declare
  v_role_count int;
  v_cap_count int;
  v_total int;
begin
  select count(distinct role) into v_role_count from role_capabilities;
  select count(distinct capability) into v_cap_count from role_capabilities;
  select count(*) into v_total from role_capabilities;
  raise notice 'RBAC seed complete: % roles × % capabilities = % rows',
    v_role_count, v_cap_count, v_total;
end $$;
