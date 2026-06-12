-- plans_daily: снять остаточные permissive using(true) SELECT-политики.
-- Таблица не читается ни из браузера, ни серверным запросом (легаси) → deny-by-default
-- безопасно. service_role (если понадобится) читает в обход RLS.

drop policy if exists plans_daily_select on public.plans_daily;
drop policy if exists "plans read for authenticated" on public.plans_daily;
