-- Таблица истории окладов административных сотрудников.
-- Используется в управленческом отчёте /profitability (PDF) для расчёта
-- начисленной (а не выплаченной) зарплаты за месяц с учётом смены оклада
-- в середине месяца.

create table if not exists public.staff_salary_periods (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  effective_from date not null,
  monthly_salary numeric not null,
  created_at timestamptz not null default now(),
  unique (staff_id, effective_from)
);

create index if not exists staff_salary_periods_staff_idx
  on public.staff_salary_periods (staff_id, effective_from desc);

-- RLS: только service_role и аутентифицированные пользователи (через API).
alter table public.staff_salary_periods enable row level security;

drop policy if exists "staff_salary_periods_service_all" on public.staff_salary_periods;
create policy "staff_salary_periods_service_all"
  on public.staff_salary_periods
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

-- Сидируем существующих сотрудников: одна запись с effective_from = created_at::date,
-- monthly_salary = текущему значению в staff. Пропускаем тех, у кого оклад не задан.
insert into public.staff_salary_periods (staff_id, effective_from, monthly_salary)
select s.id, s.created_at::date, s.monthly_salary
from public.staff s
where s.monthly_salary is not null and s.monthly_salary > 0
on conflict (staff_id, effective_from) do nothing;

-- Триггер: при INSERT нового сотрудника с monthly_salary > 0 — создать стартовый период.
create or replace function public.staff_salary_periods_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.monthly_salary is not null and new.monthly_salary > 0 then
    insert into public.staff_salary_periods (staff_id, effective_from, monthly_salary)
    values (new.id, coalesce(new.created_at::date, current_date), new.monthly_salary)
    on conflict (staff_id, effective_from) do update
      set monthly_salary = excluded.monthly_salary;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_salary_periods_after_insert on public.staff;
create trigger staff_salary_periods_after_insert
  after insert on public.staff
  for each row execute function public.staff_salary_periods_on_insert();

-- Триггер: при UPDATE monthly_salary — добавить запись с current_date.
-- Если на эту дату уже есть запись (несколько правок в один день) — перезаписать.
create or replace function public.staff_salary_periods_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.monthly_salary is distinct from old.monthly_salary
     and new.monthly_salary is not null
     and new.monthly_salary > 0 then
    insert into public.staff_salary_periods (staff_id, effective_from, monthly_salary)
    values (new.id, current_date, new.monthly_salary)
    on conflict (staff_id, effective_from) do update
      set monthly_salary = excluded.monthly_salary;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_salary_periods_after_update on public.staff;
create trigger staff_salary_periods_after_update
  after update of monthly_salary on public.staff
  for each row execute function public.staff_salary_periods_on_update();
