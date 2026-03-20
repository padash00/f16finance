create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

create table if not exists public.salary_calculation_runs (
  id uuid primary key default gen_random_uuid(),
  period_from date not null,
  period_to date not null,
  week_start date,
  company_code text,
  source text not null default 'manual',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.salary_calculation_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.salary_calculation_runs(id) on delete cascade,
  operator_id uuid not null references public.operators(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.report_snapshots (
  id uuid primary key default gen_random_uuid(),
  report_key text not null,
  period_from date,
  period_to date,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  entity_type text not null,
  entity_id text not null,
  action text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  recipient text not null,
  status text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
