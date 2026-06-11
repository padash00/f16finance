-- Переужать остаточные permissive RLS-политики `<table>_select FOR SELECT USING(true)`,
-- созданные в 20260536 (33 таблицы), из которых 20260606_* уже переужали 9
-- (ai_memory, debts, supplier_debts, team_chat_messages, direct_messages, news_posts,
--  reminders, goals, payroll_periods).
--
-- Оставшиеся 24 таблицы по коду читаются ТОЛЬКО серверным API через service_role
-- (который обходит RLS); браузер/anon/authenticated их не читает напрямую
-- (realtime-подписка из исходного списка трогала только `debts`, уже закрыт).
-- Поэтому убираем публичную read-политику → deny-by-default для роли authenticated.
-- service_role продолжает читать (приложение не затронуто), а прямой PostgREST
-- по чужому JWT больше не получит эти строки.
--
-- Если в будущем какая-то из таблиц понадобится на чтение через JWT —
-- добавить точечную scoped-политику (can_access_company/organization/operator).

do $$
declare
  tbl text;
  pol record;
  tables text[] := array[
    'chat_moderation_flags',
    'company_payment_product_rates',
    'custom_roles',
    'day_off_requests',
    'expense_attachments',
    'inventory_receipt_drafts',
    'invoice_name_mappings',
    'late_reports',
    'news_views',
    'notification_prefs',
    'operator_messages',
    'operator_salary_rule_versions',
    'operator_salary_seniority_tiers',
    'point_device_messages',
    'point_rules',
    'push_devices',
    'salary_calculation_items',
    'salary_calculation_runs',
    'supplier_debt_payments',
    'team_chat_poll_votes',
    'team_chat_polls',
    'team_chat_presence',
    'team_chat_reactions',
    'team_chat_read_state'
  ];
begin
  foreach tbl in array tables loop
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = tbl
    ) then
      continue;
    end if;

    -- RLS остаётся включённым
    execute format('alter table public.%I enable row level security', tbl);

    -- Снести ВСЕ текущие политики (они permissive USING(true)) → deny-by-default.
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = tbl
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
    end loop;
  end loop;
end $$;
