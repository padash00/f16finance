-- Migration: schema for Copilot AI tools.
-- Idempotent: safe to run multiple times AND safe if some tables already exist
-- with different schema (uses ADD COLUMN IF NOT EXISTS for everything).

-- ============================================================================
-- 1. ai_memory: persistent facts the AI remembers
-- ============================================================================
create table if not exists public.ai_memory (id uuid primary key default gen_random_uuid());

alter table public.ai_memory
  add column if not exists organization_id uuid null,
  add column if not exists key text,
  add column if not exists value text,
  add column if not exists source text not null default 'ai',
  add column if not exists created_by uuid null,
  add column if not exists created_at timestamptz not null default timezone('utc', now());

-- Add FK if missing (only if organizations table exists)
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'organizations') then
    if not exists (select 1 from information_schema.table_constraints
      where table_name = 'ai_memory' and constraint_name = 'ai_memory_organization_id_fkey') then
      alter table public.ai_memory
        add constraint ai_memory_organization_id_fkey
        foreign key (organization_id) references public.organizations(id) on delete cascade;
    end if;
  end if;
end $$;

create unique index if not exists ai_memory_org_key_uidx on public.ai_memory(organization_id, key);

alter table public.ai_memory enable row level security;
drop policy if exists ai_memory_all on public.ai_memory;
create policy ai_memory_all on public.ai_memory for all using (true) with check (true);

-- ============================================================================
-- 2. reminders
-- ============================================================================
create table if not exists public.reminders (id uuid primary key default gen_random_uuid());

alter table public.reminders
  add column if not exists organization_id uuid null,
  add column if not exists text text,
  add column if not exists remind_at timestamptz,
  add column if not exists audience text not null default 'self',
  add column if not exists status text not null default 'pending',
  add column if not exists created_by uuid null,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists sent_at timestamptz null;

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'organizations') then
    if not exists (select 1 from information_schema.table_constraints
      where table_name = 'reminders' and constraint_name = 'reminders_organization_id_fkey') then
      alter table public.reminders
        add constraint reminders_organization_id_fkey
        foreign key (organization_id) references public.organizations(id) on delete cascade;
    end if;
  end if;
end $$;

create index if not exists idx_reminders_pending on public.reminders(status, remind_at) where status = 'pending';
create index if not exists idx_reminders_org on public.reminders(organization_id);

alter table public.reminders enable row level security;
drop policy if exists reminders_all on public.reminders;
create policy reminders_all on public.reminders for all using (true) with check (true);

-- ============================================================================
-- 3. goals
-- ============================================================================
create table if not exists public.goals (id uuid primary key default gen_random_uuid());

alter table public.goals
  add column if not exists organization_id uuid null,
  add column if not exists title text,
  add column if not exists description text null,
  add column if not exists target_value numeric(14, 2) null,
  add column if not exists period_end date,
  add column if not exists status text not null default 'active',
  add column if not exists closed_at timestamptz null,
  add column if not exists created_by uuid null,
  add column if not exists created_at timestamptz not null default timezone('utc', now());

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'organizations') then
    if not exists (select 1 from information_schema.table_constraints
      where table_name = 'goals' and constraint_name = 'goals_organization_id_fkey') then
      alter table public.goals
        add constraint goals_organization_id_fkey
        foreign key (organization_id) references public.organizations(id) on delete cascade;
    end if;
  end if;
end $$;

create index if not exists idx_goals_status on public.goals(status, period_end);

alter table public.goals enable row level security;
drop policy if exists goals_all on public.goals;
create policy goals_all on public.goals for all using (true) with check (true);

-- ============================================================================
-- 4. kpi_plans
-- ============================================================================
create table if not exists public.kpi_plans (id uuid primary key default gen_random_uuid());

alter table public.kpi_plans
  add column if not exists company_id uuid,
  add column if not exists kind text not null default 'monthly_revenue',
  add column if not exists target_amount numeric(14, 2),
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists created_by uuid null,
  add column if not exists created_at timestamptz not null default timezone('utc', now());

do $$ begin
  if not exists (select 1 from information_schema.table_constraints
    where table_name = 'kpi_plans' and constraint_name = 'kpi_plans_company_id_fkey') then
    alter table public.kpi_plans
      add constraint kpi_plans_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete cascade;
  end if;
end $$;

create unique index if not exists kpi_plans_company_period_uidx on public.kpi_plans(company_id, period_start, kind);
create index if not exists idx_kpi_plans_company on public.kpi_plans(company_id, period_start);

alter table public.kpi_plans enable row level security;
drop policy if exists kpi_plans_all on public.kpi_plans;
create policy kpi_plans_all on public.kpi_plans for all using (true) with check (true);

-- ============================================================================
-- 5. payroll_periods
-- ============================================================================
create table if not exists public.payroll_periods (id uuid primary key default gen_random_uuid());

alter table public.payroll_periods
  add column if not exists organization_id uuid null,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists locked_at timestamptz not null default timezone('utc', now()),
  add column if not exists locked_by uuid null;

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'organizations') then
    if not exists (select 1 from information_schema.table_constraints
      where table_name = 'payroll_periods' and constraint_name = 'payroll_periods_organization_id_fkey') then
      alter table public.payroll_periods
        add constraint payroll_periods_organization_id_fkey
        foreign key (organization_id) references public.organizations(id) on delete cascade;
    end if;
  end if;
end $$;

create unique index if not exists payroll_periods_uidx on public.payroll_periods(organization_id, period_start, period_end);

alter table public.payroll_periods enable row level security;
drop policy if exists payroll_periods_all on public.payroll_periods;
create policy payroll_periods_all on public.payroll_periods for all using (true) with check (true);

-- ============================================================================
-- 6. debts (general client debts)
-- ============================================================================
create table if not exists public.debts (id uuid primary key default gen_random_uuid());

alter table public.debts
  add column if not exists organization_id uuid null,
  add column if not exists company_id uuid null,
  add column if not exists client_name text,
  add column if not exists amount numeric(12, 2) not null default 0,
  add column if not exists comment text null,
  add column if not exists status text not null default 'active',
  add column if not exists paid_at timestamptz null,
  add column if not exists paid_by uuid null,
  add column if not exists created_by uuid null,
  add column if not exists created_at timestamptz not null default timezone('utc', now());

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'organizations') then
    if not exists (select 1 from information_schema.table_constraints
      where table_name = 'debts' and constraint_name = 'debts_organization_id_fkey') then
      alter table public.debts
        add constraint debts_organization_id_fkey
        foreign key (organization_id) references public.organizations(id) on delete cascade;
    end if;
  end if;
  if not exists (select 1 from information_schema.table_constraints
    where table_name = 'debts' and constraint_name = 'debts_company_id_fkey') then
    alter table public.debts
      add constraint debts_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete set null;
  end if;
end $$;

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
-- 8. Reload PostgREST schema cache
-- ============================================================================
notify pgrst, 'reload schema';
