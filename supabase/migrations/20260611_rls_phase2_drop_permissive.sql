-- Фаза 2: снять остаточные permissive `using(true)` SELECT-политики.
-- Причина та же: 20260606 ДОБАВИЛ scoped-политики, но старые permissive с другими
-- именами не удалил → RLS (OR) пускал всех. Снимаем permissive — scoped остаётся.
--
-- ВАЖНО: после применения проверить на F16: командный чат, новости, цели,
-- напоминания, дашборд, зарплата — всё должно работать (читается через scoped/API).
-- Если что-то опустело — значит scoped-политики не было, вернёмся и добавим.
--
-- plans_daily НЕ трогаем — у неё нет колонки организации (нужен отдельный фикс
-- с organization_id, иначе сломаем страницу анализа).

-- Уже скоуплены в 20260606 (scoped-политика остаётся; снимаем дубль-permissive):
drop policy if exists "ai_memory_select"          on public.ai_memory;
drop policy if exists "direct_messages_select"    on public.direct_messages;
drop policy if exists "goals_select"              on public.goals;
drop policy if exists "news_posts_select"         on public.news_posts;
drop policy if exists "payroll_periods_select"    on public.payroll_periods;
drop policy if exists "reminders_select"          on public.reminders;
drop policy if exists "team_chat_messages_select" on public.team_chat_messages;

-- Читаются только через service_role API (не из браузера select) → deny-by-default:
drop policy if exists "shifts_select_all"          on public.shifts;
drop policy if exists "staff_adj_select_auth"      on public.staff_salary_adjustments;
drop policy if exists "read staff payments"        on public.staff_salary_payments;
drop policy if exists "purchase_plan_items_select" on public.purchase_plan_items;
