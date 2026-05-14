-- Хардненинг: отзываем EXECUTE у anon/authenticated на внутренних
-- SECURITY DEFINER функциях (Supabase linter anon/authenticated_
-- security_definer_function_executable).
--
-- Это служебные функции (sync_cashless_*, point_shift_admin_*,
-- inventory_integrity_check) — вызываются только через service-role
-- (admin client) или DB-триггерами. Клиенту/анону они не нужны.
-- REVOKE ... FROM anon, authenticated не трогает service_role и postgres,
-- поэтому приложение продолжает работать.
--
-- can_access_* и customer_* НЕ трогаем: они используются внутри RLS-
-- политик и обязаны быть исполнимы для authenticated, иначе RLS-чтения
-- сломаются.

do $$
declare
  fn record;
begin
  for fn in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'sync_cashless_arena_sessions',
        'sync_cashless_expenses',
        'sync_cashless_incomes',
        'sync_cashless_monthly_profitability_inputs',
        'sync_cashless_operator_salary_week_payment_expenses',
        'sync_cashless_operator_salary_week_payments',
        'sync_cashless_operator_shifts',
        'sync_cashless_point_returns',
        'sync_cashless_point_sales',
        'sync_cashless_shifts',
        'sync_cashless_staff_payments',
        'sync_cashless_supplier_debt_payments',
        'sync_kaspi_cashless_columns',
        'point_shift_admin_close',
        'point_shift_admin_purge',
        'inventory_integrity_check'
      )
  loop
    execute format(
      'revoke execute on function public.%I(%s) from anon, authenticated',
      fn.proname, fn.args
    );
  end loop;
end $$;
