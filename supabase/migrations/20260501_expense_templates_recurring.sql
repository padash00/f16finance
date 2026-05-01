-- Поддержка повторяющихся расходов из шаблонов.
-- recurring_active=true и recurring_day_of_month=N означает: каждый месяц N-го числа
-- автоматически создавать draft-запись расхода и слать владельцу в Telegram.

alter table public.expense_templates
  add column if not exists recurring_active boolean not null default false,
  add column if not exists recurring_day_of_month smallint null
    check (recurring_day_of_month is null or (recurring_day_of_month between 1 and 28)),
  add column if not exists recurring_last_run_at date null;

create index if not exists expense_templates_recurring_idx
  on public.expense_templates (recurring_active, recurring_day_of_month)
  where recurring_active = true;
