-- HR dismissals: track who was fired, when, and why for staff and operators.

alter table public.staff
  add column if not exists dismissed_at timestamptz null,
  add column if not exists dismissal_reason text null,
  add column if not exists dismissed_by uuid null;

alter table public.operators
  add column if not exists dismissed_at timestamptz null,
  add column if not exists dismissal_reason text null,
  add column if not exists dismissed_by uuid null;

create index if not exists staff_dismissed_at_idx on public.staff (dismissed_at) where dismissed_at is not null;
create index if not exists operators_dismissed_at_idx on public.operators (dismissed_at) where dismissed_at is not null;
