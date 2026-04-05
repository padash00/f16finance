create table if not exists public.operator_salary_weeks (
  id uuid not null default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  gross_amount numeric not null default 0,
  bonus_amount numeric not null default 0,
  fine_amount numeric not null default 0,
  debt_amount numeric not null default 0,
  advance_amount numeric not null default 0,
  net_amount numeric not null default 0,
  paid_amount numeric not null default 0,
  remaining_amount numeric not null default 0,
  status text not null default 'draft',
  last_payment_date date null,
  notes text null,
  created_by uuid null references auth.users(id) on delete set null,
  locked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operator_salary_weeks_pkey primary key (id),
  constraint operator_salary_weeks_operator_week_key unique (operator_id, week_start),
  constraint operator_salary_weeks_status_check check (status in ('draft', 'partial', 'paid')),
  constraint operator_salary_weeks_dates_check check (week_end = week_start + 6)
);

create index if not exists idx_operator_salary_weeks_week_start
  on public.operator_salary_weeks using btree (week_start);

create index if not exists idx_operator_salary_weeks_status
  on public.operator_salary_weeks using btree (status);

drop trigger if exists update_operator_salary_weeks_updated_at on public.operator_salary_weeks;

create trigger update_operator_salary_weeks_updated_at
before update on public.operator_salary_weeks
for each row
execute function update_updated_at_column();

create table if not exists public.operator_salary_week_company_allocations (
  id uuid not null default gen_random_uuid(),
  salary_week_id uuid not null references public.operator_salary_weeks(id) on delete cascade,
  operator_id uuid not null references public.operators(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  accrued_amount numeric not null default 0,
  share_ratio numeric not null default 0,
  allocated_net_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operator_salary_week_company_allocations_pkey primary key (id),
  constraint operator_salary_week_company_allocations_unique unique (salary_week_id, company_id)
);

create index if not exists idx_operator_salary_week_company_allocations_week
  on public.operator_salary_week_company_allocations using btree (salary_week_id);

drop trigger if exists update_operator_salary_week_company_allocations_updated_at on public.operator_salary_week_company_allocations;

create trigger update_operator_salary_week_company_allocations_updated_at
before update on public.operator_salary_week_company_allocations
for each row
execute function update_updated_at_column();

create table if not exists public.operator_salary_week_payments (
  id uuid not null default gen_random_uuid(),
  salary_week_id uuid not null references public.operator_salary_weeks(id) on delete cascade,
  operator_id uuid not null references public.operators(id) on delete cascade,
  payment_date date not null,
  cash_amount numeric not null default 0,
  kaspi_amount numeric not null default 0,
  total_amount numeric not null default 0,
  comment text null,
  status text not null default 'active',
  created_by uuid null references auth.users(id) on delete set null,
  voided_at timestamptz null,
  voided_by uuid null references auth.users(id) on delete set null,
  void_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operator_salary_week_payments_pkey primary key (id),
  constraint operator_salary_week_payments_status_check check (status in ('active', 'voided')),
  constraint operator_salary_week_payments_total_check check (
    total_amount > 0
    and cash_amount >= 0
    and kaspi_amount >= 0
    and (cash_amount + kaspi_amount) = total_amount
  )
);

create index if not exists idx_operator_salary_week_payments_week
  on public.operator_salary_week_payments using btree (salary_week_id);

create index if not exists idx_operator_salary_week_payments_payment_date
  on public.operator_salary_week_payments using btree (payment_date);

drop trigger if exists update_operator_salary_week_payments_updated_at on public.operator_salary_week_payments;

create trigger update_operator_salary_week_payments_updated_at
before update on public.operator_salary_week_payments
for each row
execute function update_updated_at_column();

create table if not exists public.operator_salary_week_payment_expenses (
  id uuid not null default gen_random_uuid(),
  payment_id uuid not null references public.operator_salary_week_payments(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  expense_id text not null,
  cash_amount numeric not null default 0,
  kaspi_amount numeric not null default 0,
  total_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint operator_salary_week_payment_expenses_pkey primary key (id),
  constraint operator_salary_week_payment_expenses_unique unique (payment_id, company_id, expense_id),
  constraint operator_salary_week_payment_expenses_total_check check (
    total_amount > 0
    and cash_amount >= 0
    and kaspi_amount >= 0
    and (cash_amount + kaspi_amount) = total_amount
  )
);

create index if not exists idx_operator_salary_week_payment_expenses_payment
  on public.operator_salary_week_payment_expenses using btree (payment_id);

alter table if exists public.operator_salary_adjustments
  add column if not exists company_id uuid null references public.companies(id) on delete set null,
  add column if not exists salary_week_id uuid null references public.operator_salary_weeks(id) on delete set null,
  add column if not exists linked_expense_id text null,
  add column if not exists source_type text not null default 'manual',
  add column if not exists status text not null default 'active',
  add column if not exists voided_at timestamptz null,
  add column if not exists voided_by uuid null references auth.users(id) on delete set null,
  add column if not exists void_reason text null;

create index if not exists idx_operator_salary_adjustments_salary_week_id
  on public.operator_salary_adjustments using btree (salary_week_id);

create index if not exists idx_operator_salary_adjustments_company_id
  on public.operator_salary_adjustments using btree (company_id);

alter table if exists public.expenses
  add column if not exists source_type text null,
  add column if not exists source_id text null,
  add column if not exists salary_week_id uuid null references public.operator_salary_weeks(id) on delete set null;

create index if not exists idx_expenses_source_type_source_id
  on public.expenses using btree (source_type, source_id);

create index if not exists idx_expenses_salary_week_id
  on public.expenses using btree (salary_week_id);
