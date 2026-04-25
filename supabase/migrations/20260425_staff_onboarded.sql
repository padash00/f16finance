-- Phase 4: онбординг сотрудника.
-- Если в организации есть checklist_template со schedule_type='onboarding'
-- и роль/audience совпадают — открытие первой смены блокируется до прохождения.

alter table public.staff
  add column if not exists onboarded_at timestamptz null;

create index if not exists idx_staff_onboarded_at
  on public.staff (organization_id, onboarded_at);
