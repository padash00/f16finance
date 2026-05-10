-- =====================================================================
-- Связь incomes ↔ point_shifts чтобы Z-отчёт мог собрать всё в одном
-- месте: meta (coins, wipon, debts) из incomes + totals_json из shift.
-- =====================================================================

alter table public.incomes
  add column if not exists shift_id uuid null
    references public.point_shifts(id) on delete set null;

create index if not exists idx_incomes_shift_id on public.incomes(shift_id);

comment on column public.incomes.shift_id is
  'Связь с конкретной сменой POS. Заполняется автоматически при создании income через /api/point/shift-report. NULL для исторических записей.';
