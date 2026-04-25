-- Phase 2: расписание чек-листов и история прохождения.

alter table public.checklist_templates
  add column if not exists schedule_type text not null default 'opening',
  add column if not exists recurrence_minutes integer null,
  add column if not exists blocks_shift boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'checklist_templates_schedule_check'
  ) then
    alter table public.checklist_templates
      add constraint checklist_templates_schedule_check
      check (schedule_type in ('opening', 'periodic', 'closing', 'onboarding', 'handover'));
  end if;
end$$;

create table if not exists public.checklist_runs (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid null references public.point_shifts(id) on delete cascade,
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  run_by uuid null references public.staff(id) on delete set null,
  co_signed_by uuid null references public.staff(id) on delete set null,

  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  scheduled_at timestamptz null,

  status text not null default 'in_progress',
  responses jsonb not null default '{}'::jsonb,

  fines_total numeric(10,2) not null default 0,
  bonuses_total numeric(10,2) not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint checklist_runs_status_check check (status in ('in_progress', 'completed', 'skipped', 'failed'))
);

create index if not exists idx_checklist_runs_shift
  on public.checklist_runs(shift_id, created_at desc);

create index if not exists idx_checklist_runs_template_status
  on public.checklist_runs(template_id, status);

-- Только один in_progress run на (shift, template). Освободит UI от дублей.
create unique index if not exists idx_checklist_runs_shift_template_active
  on public.checklist_runs(shift_id, template_id) where status = 'in_progress';

create or replace function public.checklist_runs_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_checklist_runs_updated_at on public.checklist_runs;
create trigger trg_checklist_runs_updated_at
before update on public.checklist_runs
for each row execute function public.checklist_runs_set_updated_at();

alter table public.checklist_runs enable row level security;
