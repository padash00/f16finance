-- Исправление 20260533: при создании функции Postgres даёт EXECUTE роли
-- PUBLIC, и anon/authenticated наследуют его через PUBLIC. Поэтому
-- REVOKE ... FROM anon, authenticated был неэффективен — грант через
-- PUBLIC оставался.
--
-- Правильно: отзываем у PUBLIC (а заодно у anon/authenticated явно) и
-- возвращаем EXECUTE только service_role — через него работает API/крон.

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
      'revoke execute on function public.%I(%s) from public, anon, authenticated',
      fn.proname, fn.args
    );
    execute format(
      'grant execute on function public.%I(%s) to service_role',
      fn.proname, fn.args
    );
  end loop;
end $$;
