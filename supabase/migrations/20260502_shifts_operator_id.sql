-- Link scheduled shifts to operator records by ID (was name-only before).
-- The column is nullable so existing rows are unaffected; the nightly
-- schedule enforcement in point/shift/open only activates when operator_id
-- is set AND the week is published.

alter table public.shifts
  add column if not exists operator_id uuid references public.operators(id) on delete set null;

create index if not exists shifts_company_date_operator_id_idx
  on public.shifts(company_id, date, operator_id)
  where operator_id is not null;
