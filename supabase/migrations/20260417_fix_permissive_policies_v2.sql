-- =============================================================================
-- Fix: rls_policy_always_true (v2) — точные имена политик из Security Advisor
-- =============================================================================

-- ─── OPERATOR_DOCUMENTS ──────────────────────────────────────────────────────
drop policy if exists "Users can delete documents" on public.operator_documents;
drop policy if exists "Users can insert documents" on public.operator_documents;
drop policy if exists "Users can update documents" on public.operator_documents;

-- ─── OPERATOR_NOTES ──────────────────────────────────────────────────────────
drop policy if exists "Users can insert notes" on public.operator_notes;

-- ─── PLANS_DAILY ─────────────────────────────────────────────────────────────
drop policy if exists "plans update for authenticated" on public.plans_daily;
drop policy if exists "plans write for authenticated"  on public.plans_daily;

-- ─── STAFF_SALARY_ADJUSTMENTS ────────────────────────────────────────────────
drop policy if exists "staff_adj_delete_auth" on public.staff_salary_adjustments;
drop policy if exists "staff_adj_update_auth" on public.staff_salary_adjustments;
drop policy if exists "staff_adj_write_auth"  on public.staff_salary_adjustments;

-- ─── STAFF_SALARY_PAYMENTS ───────────────────────────────────────────────────
drop policy if exists "delete staff payments" on public.staff_salary_payments;
drop policy if exists "insert staff payments" on public.staff_salary_payments;

-- ─── STORAGE: expense-attachments ────────────────────────────────────────────
-- Убираем "Allow public read" — осталась после предыдущей миграции
drop policy if exists "Allow public read" on storage.objects;
