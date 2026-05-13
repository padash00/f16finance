-- Гарантия что у public.kpi_plans есть колонка id (uuid primary key).
--
-- В некоторых базах таблица была создана без id (или PK), и страница
-- /goals падает с «column kpi_plans.id does not exist». Эта миграция
-- идемпотентно приводит схему к ожидаемому виду.

do $$
declare
  v_has_id boolean;
  v_has_pk boolean;
begin
  -- Создаём таблицу полностью, если её нет.
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'kpi_plans'
  ) then
    create table public.kpi_plans (
      id uuid primary key default gen_random_uuid(),
      company_id uuid null,
      kind text not null default 'monthly_revenue',
      target_amount numeric(14, 2),
      period_start date,
      period_end date,
      created_by uuid null,
      created_at timestamptz not null default timezone('utc', now())
    );
    return;
  end if;

  -- Колонка id отсутствует — добавим.
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'kpi_plans' and column_name = 'id'
  ) into v_has_id;

  if not v_has_id then
    alter table public.kpi_plans add column id uuid;
    -- Подставим uuid каждой существующей строке (если они есть).
    update public.kpi_plans set id = gen_random_uuid() where id is null;
    alter table public.kpi_plans alter column id set not null;
    alter table public.kpi_plans alter column id set default gen_random_uuid();
  end if;

  -- Если первичного ключа нет — поставим на id.
  select exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'kpi_plans' and constraint_type = 'PRIMARY KEY'
  ) into v_has_pk;

  if not v_has_pk then
    alter table public.kpi_plans add primary key (id);
  end if;

  -- Гарантируем остальные ожидаемые колонки.
  alter table public.kpi_plans
    add column if not exists company_id uuid,
    add column if not exists kind text not null default 'monthly_revenue',
    add column if not exists target_amount numeric(14, 2),
    add column if not exists period_start date,
    add column if not exists period_end date,
    add column if not exists created_by uuid null,
    add column if not exists created_at timestamptz not null default timezone('utc', now());
end $$;

-- Полезные индексы (не было ранее).
create index if not exists idx_kpi_plans_period_start on public.kpi_plans(period_start);
create index if not exists idx_kpi_plans_company on public.kpi_plans(company_id);
create index if not exists idx_kpi_plans_kind on public.kpi_plans(kind);

-- FK на companies (если companies существует и FK ещё не висит).
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='companies'
  ) and not exists (
    select 1 from information_schema.table_constraints
    where table_name='kpi_plans' and constraint_name='kpi_plans_company_id_fkey'
  ) then
    alter table public.kpi_plans
      add constraint kpi_plans_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete cascade;
  end if;
end $$;

alter table public.kpi_plans enable row level security;

drop policy if exists kpi_plans_all on public.kpi_plans;
create policy kpi_plans_all
  on public.kpi_plans
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

notify pgrst, 'reload schema';
