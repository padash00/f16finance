-- Засев 14 новых capabilities после третьего глубокого аудита.
-- Каталог: было 320 → стало 334.
--
-- Добавлены критичные действия которые упустили:
-- - Раскрытие паролей и токенов (access.reveal_password, point-devices.reveal_token)
-- - Bulk-операции в приёмках (markup, sale_price)
-- - Quick-add по штрихкоду в приёмках/списаниях/ревизиях
-- - Автозаполнение остатков в ревизию (preload)
-- - Экспорт пропусков с паролями
-- - Генерация промокодов
-- - Приглашения по email и генерация паролей
-- Все granted=true для существующих ролей. Идемпотентная.

do $$
declare
  v_role text;
  v_capability text;
  v_new_capabilities text[] := array[
    -- Склад: критичные новые
    'store-receipts.bulk_markup',
    'store-receipts.bulk_sale_price',
    'store-receipts.quick_add_barcode',
    'store-revisions.add_item_barcode',
    'store-revisions.preload_from_balances',
    'store-writeoffs.quick_add_barcode',
    -- Точки: раскрытие токенов (опасное)
    'point-devices.reveal_token',
    'point-devices.copy_token',
    -- Доступ: управление паролями (ОЧЕНЬ опасное)
    'access.generate_password',
    'access.reveal_password',
    'access.invite_staff',
    -- Пропуска: экспорт и копирование (критично)
    'pass.export_csv',
    'pass.copy_credentials',
    -- Скидки
    'discounts.generate_promo'
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

  raise notice 'RBAC round3: добавлено % новых capabilities × % ролей',
    array_length(v_new_capabilities, 1),
    array_length(v_existing_roles, 1);
end $$;

notify pgrst, 'reload schema';
