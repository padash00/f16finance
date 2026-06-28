-- Укрепление по Supabase Database Linter (2026-06-28). Все пункты — WARN.
-- Доступ к данным у Orda идёт через service-role (минует RLS/EXECUTE-гранты),
-- поэтому фиксы ниже не ломают приложение. DO-блоки обрабатывают все перегрузки.

-- ── 1. Зафиксировать search_path у SECURITY DEFINER функций (lint 0011) ──────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'inventory_create_point_debt',
        'inventory_return_to_warehouse',
        'inventory_create_pos_sale'
      )
  loop
    execute 'alter function ' || r.sig || ' set search_path = public, pg_temp';
  end loop;
end $$;

-- ── 2. Отозвать EXECUTE у anon/authenticated на внутренних helper/триггер
--       функциях (lint 0028/0029). Они нужны только внутри RLS-политик и триггеров,
--       где EXECUTE-грант роли не требуется. Прямой вызов через /rest/v1/rpc больше
--       недоступен публике. Клиентский портал их напрямую не зовёт (проверено). ───
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (
        p.proname like 'can_access_%'
        or p.proname in (
          'customer_link_matches_auth',
          'customer_own_company_row',
          'staff_salary_periods_on_insert',
          'staff_salary_periods_on_update'
        )
      )
  loop
    execute 'revoke execute on function ' || r.sig || ' from anon, authenticated';
  end loop;
end $$;

-- ── 3. Убрать «всегда true» политики записи на purchase_plan_items (lint 0024).
--       Запись идёт только через service-role (минует RLS), публичные write-политики
--       не нужны. RLS остаётся включённым; SELECT-политику не трогаем. ───────────────
drop policy if exists purchase_plan_items_insert on public.purchase_plan_items;
drop policy if exists purchase_plan_items_update on public.purchase_plan_items;
drop policy if exists purchase_plan_items_delete on public.purchase_plan_items;

-- Примечание (НЕ SQL, делается в дашборде Supabase):
--   • lint 0024 password: Authentication → Settings → включить
--     "Leaked password protection" (проверка по HaveIBeenPwned).
--   • lint 0025 bucket listing (customer-display-ads): при желании сузить
--     SELECT-политику, чтобы нельзя было листать файлы (URL-доступ останется).
