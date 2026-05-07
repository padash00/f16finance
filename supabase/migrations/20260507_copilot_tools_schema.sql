-- Migration: schema for Copilot AI tools.
-- Idempotent: safe to run multiple times.
-- Creates new tables (ai_memory, reminders, goals, kpi_plans, payroll_periods, debts)
-- and adds columns referenced by tools to existing tables.

-- ============================================================================
-- 1. ai_memory: persistent facts the AI remembers about the business/team
-- ============================================================================
create table if not exists public.ai_memory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  key text not null,
  value text not null,
  source text not null default 'ai' check (source in ('ai', 'user', 'system')),
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, key)
);

alter table public.ai_memory enable row level security;
drop policy if exists ai_memory_all on public.ai_memory;
create policy ai_memory_all on public.ai_memory for all using (true) with check (true);

-- ============================================================================
-- 2. reminders: scheduled notifications/follow-ups
-- ============================================================================
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  text text not null,
  remind_at timestamptz not null,
  audience text not null default 'self' check (audience in ('self', 'team')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled')),
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz null
);

create index if not exists idx_reminders_pending on public.reminders(status, remind_at) where status = 'pending';
create index if not exists idx_reminders_org on public.reminders(organization_id);

alter table public.reminders enable row level security;
drop policy if exists reminders_all on public.reminders;
create policy reminders_all on public.reminders for all using (true) with check (true);

-- ============================================================================
-- 3. goals: team objectives for the month/quarter/year
-- ============================================================================
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  title text not null,
  description text null,
  target_value numeric(14, 2) null,
  period_end date not null,
  status text not null default 'active' check (status in ('active', 'achieved', 'failed', 'cancelled')),
  closed_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_goals_status on public.goals(status, period_end);

alter table public.goals enable row level security;
drop policy if exists goals_all on public.goals;
create policy goals_all on public.goals for all using (true) with check (true);

-- ============================================================================
-- 4. kpi_plans: monthly revenue / KPI targets per company
-- ============================================================================
create table if not exists public.kpi_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null default 'monthly_revenue',
  target_amount numeric(14, 2) not null,
  period_start date not null,
  period_end date not null,
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (company_id, period_start, kind)
);

create index if not exists idx_kpi_plans_company on public.kpi_plans(company_id, period_start);

alter table public.kpi_plans enable row level security;
drop policy if exists kpi_plans_all on public.kpi_plans;
create policy kpi_plans_all on public.kpi_plans for all using (true) with check (true);

-- ============================================================================
-- 5. payroll_periods: locked salary periods (closed for editing)
-- ============================================================================
create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  locked_at timestamptz not null default timezone('utc', now()),
  locked_by uuid null,
  unique (organization_id, period_start, period_end)
);

alter table public.payroll_periods enable row level security;
drop policy if exists payroll_periods_all on public.payroll_periods;
create policy payroll_periods_all on public.payroll_periods for all using (true) with check (true);

-- ============================================================================
-- 6. debts: general client debts (separate from point_debt_items per-point and supplier_debts)
-- ============================================================================
create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete set null,
  client_name text not null,
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  comment text null,
  status text not null default 'active' check (status in ('active', 'paid', 'cancelled')),
  paid_at timestamptz null,
  paid_by uuid null,
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_debts_status on public.debts(status, created_at desc);
create index if not exists idx_debts_company on public.debts(company_id, status);

alter table public.debts enable row level security;
drop policy if exists debts_all on public.debts;
create policy debts_all on public.debts for all using (true) with check (true);

-- ============================================================================
-- 7. Add missing columns to existing tables (idempotent)
-- ============================================================================
alter table public.companies
  add column if not exists code text,
  add column if not exists address text,
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

alter table public.inventory_items
  add column if not exists barcode text,
  add column if not exists low_stock_threshold integer default 0,
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

alter table public.customers
  add column if not exists birth_date date,
  add column if not exists archived_at timestamptz;

alter table public.expenses
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists declined_at timestamptz,
  add column if not exists declined_by uuid,
  add column if not exists declined_reason text;

alter table public.operators
  add column if not exists phone text,
  add column if not exists day_rate numeric(10, 2),
  add column if not exists night_rate numeric(10, 2);

alter table public.point_sales
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_reason text;

-- ============================================================================
-- 8. Reload PostgREST schema cache so new tables/columns are immediately visible
-- ============================================================================
notify pgrst, 'reload schema';
