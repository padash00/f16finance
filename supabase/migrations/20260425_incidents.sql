-- Phase 3: incidents (нарушения, бонусы, заметки) — учёт штрафов/бонусов в смене.

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),

  company_id uuid not null references public.companies(id) on delete restrict,
  organization_id uuid null references public.organizations(id) on delete set null,
  shift_id uuid null references public.point_shifts(id) on delete set null,

  -- ссылка на статью базы знаний (правило, регламент)
  article_id uuid null references public.knowledge_articles(id) on delete set null,

  -- ссылка на чек-лист, из которого пришёл инцидент (опционально)
  checklist_run_id uuid null references public.checklist_runs(id) on delete set null,
  checklist_item_id uuid null references public.checklist_items(id) on delete set null,

  kind text not null default 'violation',

  subject_staff_id uuid null references public.staff(id) on delete set null,
  reported_by uuid null references public.staff(id) on delete set null,
  reported_by_user_id uuid null,

  title text not null,
  description text null,
  photo_urls text[] not null default '{}',

  fine_amount numeric(12,2) not null default 0,
  bonus_amount numeric(12,2) not null default 0,

  severity text not null default 'normal',
  status text not null default 'confirmed',

  source text not null default 'manual',

  occurred_at timestamptz not null default now(),
  decided_at timestamptz null,
  decided_by uuid null references public.staff(id) on delete set null,
  decision_notes text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint incidents_kind_check check (kind in ('violation', 'bonus', 'note')),
  constraint incidents_severity_check check (severity in ('info', 'normal', 'warning', 'critical')),
  constraint incidents_status_check check (status in ('draft', 'confirmed', 'disputed', 'voided')),
  constraint incidents_source_check check (source in ('manual', 'checklist', 'auto', 'import')),
  constraint incidents_amount_check check (fine_amount >= 0 and bonus_amount >= 0)
);

create index if not exists idx_incidents_company_occurred
  on public.incidents (company_id, occurred_at desc);

create index if not exists idx_incidents_shift
  on public.incidents (shift_id) where shift_id is not null;

create index if not exists idx_incidents_subject_staff
  on public.incidents (subject_staff_id, occurred_at desc) where subject_staff_id is not null;

create index if not exists idx_incidents_status
  on public.incidents (company_id, status, occurred_at desc);

create index if not exists idx_incidents_kind
  on public.incidents (company_id, kind, occurred_at desc);

create or replace function public.incidents_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_incidents_updated_at on public.incidents;
create trigger trg_incidents_updated_at
before update on public.incidents
for each row execute function public.incidents_set_updated_at();

alter table public.incidents enable row level security;
