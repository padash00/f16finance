-- Засев 29 новых capabilities найденных при втором глубоком аудите.
--
-- Каталог расширен: было 291 → стало 320 capabilities.
-- Новые действия покрывают: bulk-удаления склада, AI-распознавание чека
-- об оплате, алиасы поставщиков, управление аккаунтами операторов
-- (создать/сбросить пароль/изменить логин/отправить креды), HR-операции
-- (увольнение/восстановление), флаги функций кассовых устройств,
-- настройки киоска, AI-генерация еженедельных отчётов, импорт файлов
-- к расходам, тестирование Telegram-webhook, чек-листы (запуск/пропуск),
-- история покупок клиента, массовые операции с задачами.
--
-- Все granted=true для существующих ролей — никто прав не теряет.
-- Идемпотентная.

do $$
declare
  v_role text;
  v_capability text;
  v_new_capabilities text[] := array[
    -- Финансы
    'expenses.import_file',
    'cashflow.ai_analysis',
    'weekly-report.ai_generate',
    -- Склад
    'store-warehouse.delete_selected',
    'store-warehouse.delete_all',
    'store-receipts.parse_payment_receipt',
    'store-suppliers.add_alias',
    'store-suppliers.delete_alias',
    -- Операторы (ОПАСНЫЕ — управление учётками)
    'operators.avatar_upload',
    'operators.document_upload',
    'operators.create_account',
    'operators.reset_password',
    'operators.edit_login',
    'operators.send_credentials_telegram',
    'operators.bulk_send_credentials_telegram',
    'operators.export_credentials',
    -- Сотрудники
    'staff.reset_password',
    -- HR
    'hr.dismiss',
    'hr.restore',
    'hr.view_history',
    -- Точки и киоск
    'point-devices.manage_feature_flags',
    'stations.edit_kiosk_background',
    'stations.edit_kiosk_announcement',
    -- POS / клиенты
    'customers.view_sale_history',
    -- Задачи
    'tasks.bulk_complete',
    'tasks.bulk_delete',
    -- Knowledge / чек-листы
    'knowledge-admin.run_checklist',
    'knowledge-admin.skip_checklist',
    -- Telegram
    'telegram.test_webhook'
  ];
  v_existing_roles text[];
begin
  select array_agg(distinct role) into v_existing_roles from role_capabilities;

  if v_existing_roles is null or array_length(v_existing_roles, 1) is null then
    v_existing_roles := array['owner','manager','marketer','other','super_admin'];
  end if;

  foreach v_role in array v_existing_roles loop
    foreach v_capability in array v_new_capabilities loop
      insert into role_capabilities (role, capability, granted)
      values (v_role, v_capability, true)
      on conflict (role, capability) do nothing;
    end loop;
  end loop;

  raise notice 'RBAC round2: добавлено % новых capabilities × % ролей',
    array_length(v_new_capabilities, 1),
    array_length(v_existing_roles, 1);
end $$;

notify pgrst, 'reload schema';
