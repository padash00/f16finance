-- Phase 1: смена как единый объект.
-- Одна открытая смена на company_id (физический партиал-индекс ниже).

create table if not exists public.point_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  organization_id uuid null references public.organizations(id) on delete set null,
  operator_id uuid null references public.staff(id) on delete set null,
  point_device_id uuid null references public.point_devices(id) on delete set null,

  status text not null default 'open',
  shift_type text not null default 'day',

  opened_at timestamptz not null default now(),
  closed_at timestamptz null,

  opening_cash numeric(12,2) not null default 0,
  opening_notes text null,

  closing_cash numeric(12,2) null,
  closing_kaspi numeric(12,2) null,
  closing_kaspi_before_midnight numeric(12,2) null,
  closing_kaspi_after_midnight numeric(12,2) null,
  closing_notes text null,

  z_report_url text null,
  x_report_url text null,

  totals_json jsonb null,

  handover_from_shift_id uuid null references public.point_shifts(id) on delete set null,
  closed_by uuid null references public.staff(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint point_shifts_status_check check (status in ('open', 'closed', 'voided')),
  constraint point_shifts_shift_type_check check (shift_type in ('day', 'night', 'custom')),
  constraint point_shifts_closed_at_check check (
    (status = 'open' and closed_at is null) or status <> 'open'
  )
);

create unique index if not exists idx_point_shifts_one_open_per_company
  on public.point_shifts(company_id) where status = 'open';

create index if not exists idx_point_shifts_company_closed_at
  on public.point_shifts(company_id, closed_at desc);

create index if not exists idx_point_shifts_operator
  on public.point_shifts(operator_id, opened_at desc);

create index if not exists idx_point_shifts_organization
  on public.point_shifts(organization_id, opened_at desc);

create or replace function public.point_shifts_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_point_shifts_updated_at on public.point_shifts;
create trigger trg_point_shifts_updated_at
before update on public.point_shifts
for each row execute function public.point_shifts_set_updated_at();

alter table public.point_shifts enable row level security;
