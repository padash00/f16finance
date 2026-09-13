-- Зафиксированные прогнозы на месяц и их сверка с фактом (/analysis).
--
-- 1-го числа крон сохраняет прогноз на начавшийся месяц — по всей организации
-- (scope_key = 'all') и по каждой точке. После закрытия месяца крон дописывает
-- факт. Сам прогноз после вставки менять нельзя (триггер ниже): иначе сверка
-- «что обещали — что вышло» теряет смысл.

create table if not exists public.forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- 'all' — вся организация, иначе id точки (отдельная колонка нужна для
  -- уникальности: null в company_id не считался бы дублем)
  scope_key text not null,
  company_id uuid null references public.companies(id) on delete cascade,
  target_month date not null,
  model_version text not null,

  income_pessimistic numeric(14, 2) not null,
  income_realistic numeric(14, 2) not null,
  income_optimistic numeric(14, 2) not null,
  expense_pessimistic numeric(14, 2) not null,
  expense_realistic numeric(14, 2) not null,
  expense_optimistic numeric(14, 2) not null,
  profit_pessimistic numeric(14, 2) not null,
  profit_realistic numeric(14, 2) not null,
  profit_optimistic numeric(14, 2) not null,

  -- веса способов, поправка на перекос, коридор, число сверок на момент прогноза
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  actual_income numeric(14, 2) null,
  actual_expense numeric(14, 2) null,
  actual_profit numeric(14, 2) null,
  evaluated_at timestamptz null,

  constraint forecast_snapshots_scope_month_key unique (organization_id, scope_key, target_month)
);

create index if not exists idx_forecast_snapshots_org_month
  on public.forecast_snapshots (organization_id, target_month desc);

-- Прогноз заморожен: обновлять можно только факт и дату сверки
create or replace function public.forecast_snapshots_freeze()
returns trigger
language plpgsql
as $$
begin
  if (
    new.organization_id, new.scope_key, new.company_id, new.target_month, new.model_version,
    new.income_pessimistic, new.income_realistic, new.income_optimistic,
    new.expense_pessimistic, new.expense_realistic, new.expense_optimistic,
    new.profit_pessimistic, new.profit_realistic, new.profit_optimistic,
    new.details, new.created_at
  ) is distinct from (
    old.organization_id, old.scope_key, old.company_id, old.target_month, old.model_version,
    old.income_pessimistic, old.income_realistic, old.income_optimistic,
    old.expense_pessimistic, old.expense_realistic, old.expense_optimistic,
    old.profit_pessimistic, old.profit_realistic, old.profit_optimistic,
    old.details, old.created_at
  ) then
    raise exception 'forecast snapshot is frozen: only actual_* and evaluated_at can change';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_forecast_snapshots_freeze on public.forecast_snapshots;
create trigger trg_forecast_snapshots_freeze
before update on public.forecast_snapshots
for each row execute function public.forecast_snapshots_freeze();

-- Доступ только через серверные API (service role обходит RLS), политик нет
alter table public.forecast_snapshots enable row level security;

notify pgrst, 'reload schema';
