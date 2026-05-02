-- Additive support for structured expense documents and reversible staff salary payouts.

create table if not exists public.expense_attachments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  wizard_session_id uuid null,
  document_url text not null,
  file_name text null,
  mime_type text null,
  file_size bigint null,
  sort_order integer not null default 0,
  uploaded_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_expense_attachments_expense_order
  on public.expense_attachments(expense_id, sort_order, created_at);

create index if not exists idx_expense_attachments_wizard_session
  on public.expense_attachments(wizard_session_id)
  where wizard_session_id is not null;

alter table if exists public.staff_adjustments
  add column if not exists closed_by_payment_id uuid null references public.staff_salary_payments(id) on delete set null,
  add column if not exists source_payment_id uuid null references public.staff_salary_payments(id) on delete set null,
  add column if not exists closed_at timestamptz null;

create index if not exists idx_staff_adjustments_closed_by_payment
  on public.staff_adjustments(closed_by_payment_id)
  where closed_by_payment_id is not null;

create index if not exists idx_staff_adjustments_source_payment
  on public.staff_adjustments(source_payment_id)
  where source_payment_id is not null;
