-- КОРЕНЬ УТЕЧКИ: re-tighten миграции ДОБАВЛЯЛИ scoped-политики, но СТАРЫЕ
-- permissive (`using(true)`, другие имена) НЕ удаляли. RLS объединяет политики
-- через OR → permissive побеждает → данные текли между тенантами даже после флипа.
--
-- Дропаем permissive ТОЧНО ПО ИМЕНИ (имена взяты из pg_policies живой БД).
-- Только таблицы, у которых УЖЕ ЕСТЬ scoped-политика (can_access_*) ИЛИ доступ
-- только через service_role — поэтому приложение/F16 не ломается.
-- Остальные permissive (shifts, чат, зарплаты, планы…) — отдельной волной,
-- после проверки каждой (нужна scoped-замена, чтобы не сломать страницы).

-- operator_auth — УЧЁТКИ ОПЕРАТОРОВ. Чтение только через service_role (API).
-- Браузер/anon не должен читать это никогда (это была дыра и до мультитенанта).
drop policy if exists "Anyone can read operator_auth" on public.operator_auth;

-- expenses — есть scoped expenses_select_same_company (can_access_company)
drop policy if exists "public read expenses"  on public.expenses;
drop policy if exists "allow select expenses" on public.expenses;

-- debts — есть scoped debts_tenant
drop policy if exists "debts_select" on public.debts;

-- operator PII — есть scoped operator_documents_select / operator_notes_select
drop policy if exists "Users can view all documents" on public.operator_documents;
drop policy if exists "Users can view all notes"     on public.operator_notes;

-- staff — есть scoped staff_select_own_org (20260611_staff_rls_org_scope).
-- ВАЖНО: реальные permissive-имена в живой БД были другие, прошлый дроп их не снял.
drop policy if exists "Allow read access for authenticated users" on public.staff;
drop policy if exists "staff_select_auth" on public.staff;
