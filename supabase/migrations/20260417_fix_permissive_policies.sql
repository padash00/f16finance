-- =============================================================================
-- Fix: rls_policy_always_true + public_bucket_allows_listing
-- Supabase Security Advisor — апрель 2026
--
-- Все API routes используют createAdminSupabaseClient() (service role) —
-- INSERT/UPDATE/DELETE через PostgREST не нужны. Удаляем опасные политики
-- USING(true)/WITH CHECK(true), особенно для роли anon.
-- =============================================================================

-- ─── EXPENSES ────────────────────────────────────────────────────────────────
-- Старые политики: anon INSERT (!) — критическая уязвимость
alter table if exists public.expenses enable row level security;

drop policy if exists "allow insert expenses"       on public.expenses;
drop policy if exists "public insert expenses"      on public.expenses;
drop policy if exists "Allow insert for all users"  on public.expenses;
drop policy if exists "allow_insert_expenses"       on public.expenses;
drop policy if exists "expenses_insert"             on public.expenses;

-- SELECT policy: только своя компания
drop policy if exists expenses_select_same_company on public.expenses;
create policy expenses_select_same_company
  on public.expenses
  for select
  to authenticated
  using (
    company_id is not null
    and public.can_access_company(company_id)
  );

-- ─── SHIFTS ──────────────────────────────────────────────────────────────────
-- shifts_insert_all разрешал anon INSERT (!)
drop policy if exists "shifts_insert_all"           on public.shifts;
drop policy if exists "Allow insert for all users"  on public.shifts;
drop policy if exists shifts_insert_all             on public.shifts;

-- Существующие shifts_*_admin_staff политики (из 20260313_shifts_rls.sql) остаются.

-- ─── STAFF ───────────────────────────────────────────────────────────────────
-- "Allow all access for authenticated users" — ALL OPERATIONS с USING(true)
-- staff_delete_auth, staff_update_auth, staff_write_auth — с USING(true)
alter table if exists public.staff enable row level security;

drop policy if exists "Allow all access for authenticated users" on public.staff;
drop policy if exists "staff_delete_auth"   on public.staff;
drop policy if exists "staff_update_auth"   on public.staff;
drop policy if exists "staff_write_auth"    on public.staff;
drop policy if exists "staff_insert"        on public.staff;
drop policy if exists "staff_update"        on public.staff;
drop policy if exists "staff_delete"        on public.staff;

-- SELECT: сотрудники видят только свою компанию
-- (can_manage_shifts() и другие security definer функции обходят RLS)
drop policy if exists staff_select_same_company on public.staff;
create policy staff_select_same_company
  on public.staff
  for select
  to authenticated
  using (
    company_id is not null
    and public.can_access_company(company_id)
  );

-- ─── STAFF_SALARY_ADJUSTMENTS ────────────────────────────────────────────────
alter table if exists public.staff_salary_adjustments enable row level security;

drop policy if exists "Allow all"           on public.staff_salary_adjustments;
drop policy if exists "staff_salary_adjustments_delete" on public.staff_salary_adjustments;
drop policy if exists "staff_salary_adjustments_update" on public.staff_salary_adjustments;
drop policy if exists "staff_salary_adjustments_insert" on public.staff_salary_adjustments;
drop policy if exists "Allow insert for all users" on public.staff_salary_adjustments;

-- ─── STAFF_SALARY_PAYMENTS ───────────────────────────────────────────────────
alter table if exists public.staff_payments enable row level security;

drop policy if exists "Allow all"               on public.staff_payments;
drop policy if exists "staff_payments_delete"   on public.staff_payments;
drop policy if exists "staff_payments_insert"   on public.staff_payments;
drop policy if exists "Allow insert for all users" on public.staff_payments;

-- ─── OPERATOR_DOCUMENTS ──────────────────────────────────────────────────────
alter table if exists public.operator_documents enable row level security;

drop policy if exists "operator_documents_delete" on public.operator_documents;
drop policy if exists "operator_documents_insert" on public.operator_documents;
drop policy if exists "operator_documents_update" on public.operator_documents;
drop policy if exists "Allow all"                 on public.operator_documents;
drop policy if exists "Allow insert for all users" on public.operator_documents;

-- SELECT: по operator_id
drop policy if exists operator_documents_select on public.operator_documents;
create policy operator_documents_select
  on public.operator_documents
  for select
  to authenticated
  using (
    operator_id is not null
    and public.can_access_operator(operator_id)
  );

-- ─── OPERATOR_NOTES ──────────────────────────────────────────────────────────
alter table if exists public.operator_notes enable row level security;

drop policy if exists "operator_notes_insert"  on public.operator_notes;
drop policy if exists "Allow all"              on public.operator_notes;
drop policy if exists "Allow insert for all users" on public.operator_notes;

-- SELECT: по operator_id
drop policy if exists operator_notes_select on public.operator_notes;
create policy operator_notes_select
  on public.operator_notes
  for select
  to authenticated
  using (
    operator_id is not null
    and public.can_access_operator(operator_id)
  );

-- ─── PLANS_DAILY ─────────────────────────────────────────────────────────────
alter table if exists public.plans_daily enable row level security;

drop policy if exists "plans_daily_update"  on public.plans_daily;
drop policy if exists "plans_daily_insert"  on public.plans_daily;
drop policy if exists "Allow all"           on public.plans_daily;
drop policy if exists "Allow insert for all users" on public.plans_daily;

-- SELECT: по company_id
drop policy if exists plans_daily_select on public.plans_daily;
create policy plans_daily_select
  on public.plans_daily
  for select
  to authenticated
  using (
    company_id is not null
    and public.can_access_company(company_id)
  );

-- ─── STORAGE: expense-attachments bucket ─────────────────────────────────────
-- Убираем публичный listing (public_bucket_allows_listing)
-- Оставляем только для authenticated — anon не должен листить файлы
drop policy if exists "Give public access to expense-attachments"   on storage.objects;
drop policy if exists "Expense attachments are publicly accessible" on storage.objects;
drop policy if exists "expense-attachments public select"           on storage.objects;
drop policy if exists "expense attachments select"                  on storage.objects;
drop policy if exists "Public Access"                               on storage.objects;

-- Разрешаем SELECT только authenticated пользователям
drop policy if exists "expense-attachments-select-authenticated" on storage.objects;
create policy "expense-attachments-select-authenticated"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'expense-attachments');

-- Закрываем INSERT/UPDATE/DELETE для всех ролей — наш API использует service role
drop policy if exists "expense-attachments-insert" on storage.objects;
drop policy if exists "expense-attachments-update" on storage.objects;
drop policy if exists "expense-attachments-delete" on storage.objects;
drop policy if exists "Authenticated users can upload expense attachments" on storage.objects;
drop policy if exists "Users can update own expense attachments"           on storage.objects;
drop policy if exists "Users can delete own expense attachments"           on storage.objects;
