-- Wizard-related columns on expenses.
-- After this migration: existing rows are confirmed (legacy data), new rows must be
-- created via wizard. Status flow: confirmed | pending_approval -> approved/declined.

alter table public.expenses
  add column if not exists wizard_session_id uuid null,
  add column if not exists document_kind text null,
  add column if not exists document_url text null,
  add column if not exists whitelist_vendor_id uuid null,
  add column if not exists one_off_payee text null,
  add column if not exists one_off_reason text null,
  add column if not exists status text not null default 'confirmed',
  add column if not exists approved_by uuid null,
  add column if not exists approved_at timestamptz null,
  add column if not exists declined_by uuid null,
  add column if not exists declined_at timestamptz null,
  add column if not exists declined_reason text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'expenses_status_check'
  ) then
    alter table public.expenses
      add constraint expenses_status_check
      check (status in ('confirmed', 'pending_approval', 'approved', 'declined'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'expenses_document_kind_check'
  ) then
    alter table public.expenses
      add constraint expenses_document_kind_check
      check (document_kind is null or document_kind in ('receipt','invoice','bill','whitelist','one_off'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'expenses_wizard_session_fk'
  ) then
    alter table public.expenses
      add constraint expenses_wizard_session_fk
      foreign key (wizard_session_id)
      references public.expense_wizard_sessions(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'expenses_whitelist_vendor_fk'
  ) then
    alter table public.expenses
      add constraint expenses_whitelist_vendor_fk
      foreign key (whitelist_vendor_id)
      references public.expense_vendor_whitelist(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'expense_wizard_sessions_expense_fk'
  ) then
    alter table public.expense_wizard_sessions
      add constraint expense_wizard_sessions_expense_fk
      foreign key (expense_id)
      references public.expenses(id)
      on delete set null;
  end if;
end$$;

create index if not exists expenses_pending_idx
  on public.expenses (status)
  where status = 'pending_approval';

create index if not exists expenses_status_company_date_idx
  on public.expenses (company_id, status, date desc);
