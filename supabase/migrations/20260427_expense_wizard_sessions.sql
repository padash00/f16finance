-- Wizard sessions for expense creation. Server-side gate: rows in `expenses`
-- can only be inserted by the wizard submit endpoint, which consumes a session.
-- Direct POST /api/admin/expenses is closed elsewhere with 410 Gone.

create table if not exists public.expense_wizard_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  organization_id uuid null,
  company_id uuid null,
  step smallint not null default 1,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'in_progress',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  consumed_at timestamptz null,
  expense_id uuid null,
  constraint expense_wizard_sessions_status_check
    check (status in ('in_progress', 'submitted', 'abandoned'))
);

create index if not exists expense_wizard_sessions_user_active_idx
  on public.expense_wizard_sessions (user_id)
  where consumed_at is null;

create index if not exists expense_wizard_sessions_expires_idx
  on public.expense_wizard_sessions (expires_at)
  where consumed_at is null;

alter table public.expense_wizard_sessions enable row level security;

drop policy if exists expense_wizard_sessions_admin_all on public.expense_wizard_sessions;
create policy expense_wizard_sessions_admin_all
  on public.expense_wizard_sessions
  for all
  to service_role
  using (true)
  with check (true);
