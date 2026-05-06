-- Сидинг новых capabilities добавленных после глубокого аудита 06.05.2026.
--
-- В каталог добавлены 26 действий которые пропустили в первой версии:
--   - store-billing.* — управление долгами поставщикам (6 действий)
--   - store-warehouse.* — печать ценников, файл подсобки, создание через сканер (4)
--   - store-receipts.* — шаблоны приёмок (3)
--   - store-writeoffs.* — шаблоны списаний (2)
--   - store-showcase.return_to_warehouse — возврат на склад (1)
--   - store-requests-journal.export — выгрузка журнала (1)
--   - store.global_search — поиск по всему складу (1)
--   - weekly-report.export_pdf — PDF экспорт (1)
--   - tasks.notify — отправка уведомлений по задаче (1)
--   - customers.adjust_points — корректировка бонусов (1)
--   - access.change_email — изменение email сотрудника (1)
--   - stations.get_analytics — аналитика проекта (1)
--   - salary.add_extra_day — доп. рабочий день (1)
--   - staff.add_adjustment, staff.add_extra_day — корректировки сотрудника (2)
--
-- Все они засеваются как granted=true для существующих ролей —
-- никто не теряет прав, всё открыто как было.
-- Закрытие происходит позже через UI на странице /access.
--
-- Идемпотентная — можно прогонять несколько раз.

do $$
declare
  v_role text;
  v_capability text;
  v_new_capabilities text[] := array[
    'store.global_search',
    'store-warehouse.create_item',
    'store-warehouse.upload_backroom',
    'store-warehouse.apply_backroom',
    'store-warehouse.print_labels',
    'store-showcase.return_to_warehouse',
    'store-receipts.apply_template',
    'store-receipts.save_template',
    'store-receipts.delete_template',
    'store-requests-journal.export',
    'store-writeoffs.apply_template',
    'store-writeoffs.save_template',
    'store-billing.pay_debt',
    'store-billing.write_off_debt',
    'store-billing.bulk_pay',
    'store-billing.reschedule_debt',
    'store-billing.parse_receipt',
    'store-billing.export',
    'weekly-report.export_pdf',
    'salary.add_extra_day',
    'staff.add_adjustment',
    'staff.add_extra_day',
    'tasks.notify',
    'customers.adjust_points',
    'access.change_email',
    'stations.get_analytics'
  ];
  v_existing_roles text[];
begin
  -- Берём все роли которые есть в role_capabilities
  select array_agg(distinct role) into v_existing_roles from role_capabilities;

  -- Если ничего нет — используем builtin
  if v_existing_roles is null or array_length(v_existing_roles, 1) is null then
    v_existing_roles := array['owner','manager','marketer','other','super_admin'];
  end if;

  -- Засев: для каждой роли, для каждой новой capability
  foreach v_role in array v_existing_roles loop
    foreach v_capability in array v_new_capabilities loop
      insert into role_capabilities (role, capability, granted)
      values (v_role, v_capability, true)
      on conflict (role, capability) do nothing;
    end loop;
  end loop;

  raise notice 'RBAC: добавлено новых capabilities × ролей = % строк',
    array_length(v_existing_roles, 1) * array_length(v_new_capabilities, 1);
end $$;

-- Перезагружаем PostgREST schema cache
notify pgrst, 'reload schema';
