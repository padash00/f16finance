-- Supabase linter rls_policy_always_true: 33 таблицы имели политику
-- FOR ALL USING(true) WITH CHECK(true) — линтер флагует это как
-- «RLS фактически отключён» для INSERT/UPDATE/DELETE.
--
-- Проверено по коду:
--   * браузер (anon/authenticated клиент) НЕ делает прямых
--     .insert/.update/.delete в эти таблицы — все записи идут через
--     серверный API (service_role, который RLS обходит);
--   * realtime-подписки браузера из этого списка трогают только debts.
--
-- Решение: меняем FOR ALL → FOR SELECT USING(true).
--   - чтения (в т.ч. realtime для debts) продолжают работать;
--   - записи из anon/authenticated закрываются (их и не было);
--   - service_role по-прежнему обходит RLS — серверный API не затронут;
--   - линтер FOR SELECT USING(true) НЕ флагует (явно исключает этот
--     паттерн как осознанный публичный доступ на чтение).

do $$
declare
  tbl text;
  pol record;
  tables text[] := array[
    'ai_memory',
    'chat_moderation_flags',
    'company_payment_product_rates',
    'custom_roles',
    'day_off_requests',
    'debts',
    'direct_messages',
    'expense_attachments',
    'goals',
    'inventory_receipt_drafts',
    'invoice_name_mappings',
    'late_reports',
    'news_posts',
    'news_views',
    'notification_prefs',
    'operator_messages',
    'operator_salary_rule_versions',
    'operator_salary_seniority_tiers',
    'payroll_periods',
    'point_device_messages',
    'point_rules',
    'push_devices',
    'reminders',
    'salary_calculation_items',
    'salary_calculation_runs',
    'supplier_debt_payments',
    'supplier_debts',
    'team_chat_messages',
    'team_chat_poll_votes',
    'team_chat_polls',
    'team_chat_presence',
    'team_chat_reactions',
    'team_chat_read_state'
  ];
begin
  foreach tbl in array tables loop
    -- пропускаем, если таблицы нет
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = tbl
    ) then
      continue;
    end if;

    -- сносим все текущие политики таблицы (они все permissive USING(true))
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = tbl
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
    end loop;

    -- RLS остаётся включённым
    execute format('alter table public.%I enable row level security', tbl);

    -- единственная политика — только чтение (линтер это не флагует)
    execute format(
      'create policy %I on public.%I for select using (true)',
      tbl || '_select',
      tbl
    );
  end loop;
end $$;
