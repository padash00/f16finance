alter table if exists public.incomes
  add column if not exists kaspi_before_midnight numeric;

comment on column public.incomes.kaspi_before_midnight is
  'Kaspi amount before midnight for night shifts (20:00-23:59). kaspi_amount keeps the full shift total.';
