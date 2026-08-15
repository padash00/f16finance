-- ─────────────────────────────────────────────────────────────────────────
-- Эффективность продавцов, фаза 2: план смены, бонусные уровни, месячный
-- индекс спроса и календарь.
-- ─────────────────────────────────────────────────────────────────────────
-- Ключевое отличие от фазы 1: здесь появляются числа, за которые платят
-- деньги. Поэтому план смены — не расчёт «на лету», а зафиксированная строка:
-- продавец работает под ту планку, которую ему объявили до начала смены, и
-- задним числом она не поднимается.
--
-- Правки после фиксации возможны только руками и только с причиной — она
-- хранится в самой строке плана и дублируется в журнал действий.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Настройки бонусов и индекса ──────────────────────────────────────────
alter table public.store_kpi_settings
  -- Перцентили распределения выручки сегмента, из которых берутся уровни.
  add column if not exists control_percentile numeric(4,2) not null default 0.40,
  add column if not exists b1_percentile numeric(4,2) not null default 0.60,
  add column if not exists b2_percentile numeric(4,2) not null default 0.75,
  add column if not exists b3_percentile numeric(4,2) not null default 0.90,
  -- Суммы в тенге целыми: копеек в бонусах не бывает.
  add column if not exists b1_amount integer not null default 2000,
  add column if not exists b2_amount integer not null default 3000,
  add column if not exists b3_amount integer not null default 5000,
  add column if not exists record_amount integer not null default 7000,
  add column if not exists rounding_step integer not null default 5000,
  add column if not exists plan_lock_days_ahead smallint not null default 3,
  add column if not exists monthly_index_min numeric(4,2) not null default 0.85,
  add column if not exists monthly_index_max numeric(4,2) not null default 1.20,
  add column if not exists auto_adjust_max_delta numeric(4,2) not null default 0.05;

-- ── Месячный индекс спроса ───────────────────────────────────────────────
create table if not exists public.store_kpi_monthly_indices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,

  -- Первое число целевого месяца.
  month date not null,

  -- Применяемое значение и то, что посчитала модель до ограничения границами.
  value numeric(4,2) not null,
  recommended numeric(4,2) null,

  -- Разбор по частям: сезонность, тренд, учебный контекст, состав календаря.
  -- Хранится целиком, чтобы через полгода можно было ответить «почему 1.04».
  components jsonb not null default '[]'::jsonb,
  confidence numeric(3,2) null,

  status text not null default 'applied'
    check (status in ('applied', 'pending_approval', 'rejected')),
  source text not null default 'auto' check (source in ('auto', 'manual')),
  approval_reason text null,
  approved_by uuid null,
  approved_at timestamptz null,

  -- Ручная правка обязана иметь причину: индекс двигает деньги людей.
  override_reason text null,

  model_version text not null default 'STORE_KPI_V1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint store_kpi_monthly_indices_uniq unique (company_id, month),
  constraint store_kpi_monthly_indices_value check (value > 0 and value < 3)
);

create index if not exists idx_store_kpi_monthly_indices_company
  on public.store_kpi_monthly_indices (company_id, month desc);

-- ── План смены ───────────────────────────────────────────────────────────
create table if not exists public.store_kpi_shift_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,

  plan_date date not null,
  shift text not null check (shift in ('day', 'night')),

  -- Уровни в тенге целыми. CONTROL — отметка «разобраться», не штраф.
  control_amount integer not null,
  b1_amount integer not null,
  b2_amount integer not null,
  b3_amount integer not null,
  -- Планка рекорда сегмента. Месячным индексом не подкручивается.
  record_threshold integer null,

  -- Прогноз показывается рядом с планом, но планом НЕ является: прогноз
  -- меняется каждый день, планка обязана стоять на месте.
  expected_revenue integer null,
  expected_club_revenue integer null,
  confidence numeric(3,2) null,

  monthly_index numeric(4,2) not null default 1.00,
  baseline_level text null,
  baseline_sample smallint null,
  drivers jsonb not null default '[]'::jsonb,

  -- Пока пусто — план можно пересчитывать. После фиксации автоматический
  -- пересчёт запрещён, меняет только человек и только с причиной.
  locked_at timestamptz null,
  override_reason text null,
  overridden_by uuid null,
  overridden_at timestamptz null,

  model_version text not null default 'STORE_KPI_V1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint store_kpi_shift_plans_uniq unique (company_id, plan_date, shift),
  -- Лестница обязана быть строго возрастающей, иначе часть уровней
  -- недостижима или достигается одновременно.
  constraint store_kpi_shift_plans_ladder check (
    control_amount < b1_amount and b1_amount < b2_amount and b2_amount < b3_amount
  ),
  -- Правка зафиксированного плана без причины запрещена на уровне базы,
  -- а не только в коде: это единственная защита при прямом доступе к БД.
  constraint store_kpi_shift_plans_override_reason check (
    overridden_at is null or (override_reason is not null and length(btrim(override_reason)) >= 5)
  )
);

create index if not exists idx_store_kpi_shift_plans_company_date
  on public.store_kpi_shift_plans (company_id, plan_date desc);

-- ── Календарь особых дней ────────────────────────────────────────────────
-- Поверх kz_holidays: официальные праздники берутся оттуда, а сюда попадает
-- то, чего в общем календаре нет — переносы, турниры, локальные события,
-- закрытие точки. Плюс собственный множитель влияния на спрос.
create table if not exists public.store_kpi_calendar_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- null = день влияет на все точки организации.
  company_id uuid null references public.companies(id) on delete cascade,

  day date not null,
  day_type text not null default 'CUSTOM' check (day_type in (
    'PUBLIC_HOLIDAY', 'TRANSFERRED_DAY_OFF', 'WORKING_WEEKEND', 'LONG_WEEKEND',
    'RELIGIOUS_HOLIDAY', 'LOCAL_EVENT', 'INTERNAL_EVENT', 'CLOSURE', 'CUSTOM'
  )),
  name text not null,

  -- 1.00 = нейтрально. Пока по типу дня нет своей истории, влияние остаётся
  -- нейтральным — придумывать коэффициент праздника нельзя.
  impact_index numeric(4,2) not null default 1.00,

  source text null,
  source_url text null,
  verified boolean not null default false,

  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint store_kpi_calendar_days_impact check (impact_index > 0 and impact_index < 3)
);

create unique index if not exists idx_store_kpi_calendar_days_uniq
  on public.store_kpi_calendar_days (organization_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), day, day_type);

create index if not exists idx_store_kpi_calendar_days_lookup
  on public.store_kpi_calendar_days (organization_id, day);

-- ── Учебные периоды ──────────────────────────────────────────────────────
-- Семестры, каникулы, сессия. Диапазон дат, а не отдельные дни.
create table if not exists public.store_kpi_academic_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete cascade,

  start_date date not null,
  end_date date not null,
  period_type text not null default 'SEMESTER' check (period_type in (
    'SEMESTER', 'VACATION', 'EXAMS', 'ADMISSION', 'START_OF_YEAR',
    'END_OF_YEAR', 'SUMMER_BREAK', 'CUSTOM'
  )),
  name text not null,

  manual_index numeric(4,2) not null default 1.00,
  source text null,
  confidence numeric(3,2) null,
  -- Период, предложенный автоматически, в расчёт не идёт до подтверждения:
  -- сдвинуть планку людям по неподтверждённой догадке нельзя.
  is_confirmed boolean not null default false,

  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint store_kpi_academic_periods_range check (end_date >= start_date),
  constraint store_kpi_academic_periods_index check (manual_index > 0 and manual_index < 3)
);

create index if not exists idx_store_kpi_academic_periods_lookup
  on public.store_kpi_academic_periods (organization_id, start_date, end_date);

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.store_kpi_monthly_indices enable row level security;
alter table public.store_kpi_shift_plans enable row level security;
alter table public.store_kpi_calendar_days enable row level security;
alter table public.store_kpi_academic_periods enable row level security;

drop policy if exists "service_role full access store_kpi_monthly_indices" on public.store_kpi_monthly_indices;
create policy "service_role full access store_kpi_monthly_indices" on public.store_kpi_monthly_indices
  to service_role using (true) with check (true);

drop policy if exists "service_role full access store_kpi_shift_plans" on public.store_kpi_shift_plans;
create policy "service_role full access store_kpi_shift_plans" on public.store_kpi_shift_plans
  to service_role using (true) with check (true);

drop policy if exists "service_role full access store_kpi_calendar_days" on public.store_kpi_calendar_days;
create policy "service_role full access store_kpi_calendar_days" on public.store_kpi_calendar_days
  to service_role using (true) with check (true);

drop policy if exists "service_role full access store_kpi_academic_periods" on public.store_kpi_academic_periods;
create policy "service_role full access store_kpi_academic_periods" on public.store_kpi_academic_periods
  to service_role using (true) with check (true);

drop trigger if exists trg_store_kpi_monthly_indices_updated_at on public.store_kpi_monthly_indices;
create trigger trg_store_kpi_monthly_indices_updated_at
before update on public.store_kpi_monthly_indices
for each row execute function public.touch_store_kpi_updated_at();

drop trigger if exists trg_store_kpi_shift_plans_updated_at on public.store_kpi_shift_plans;
create trigger trg_store_kpi_shift_plans_updated_at
before update on public.store_kpi_shift_plans
for each row execute function public.touch_store_kpi_updated_at();

drop trigger if exists trg_store_kpi_calendar_days_updated_at on public.store_kpi_calendar_days;
create trigger trg_store_kpi_calendar_days_updated_at
before update on public.store_kpi_calendar_days
for each row execute function public.touch_store_kpi_updated_at();

drop trigger if exists trg_store_kpi_academic_periods_updated_at on public.store_kpi_academic_periods;
create trigger trg_store_kpi_academic_periods_updated_at
before update on public.store_kpi_academic_periods
for each row execute function public.touch_store_kpi_updated_at();

-- ── Защита зафиксированного плана на уровне базы ─────────────────────────
-- Код мы контролируем, но прямые правки в SQL Editor и будущие миграции —
-- нет. Триггер запрещает менять суммы у зафиксированного плана, если не
-- указана причина правки.
create or replace function public.store_kpi_guard_locked_plan()
returns trigger
language plpgsql
as $$
begin
  if old.locked_at is not null
     and (new.control_amount is distinct from old.control_amount
       or new.b1_amount is distinct from old.b1_amount
       or new.b2_amount is distinct from old.b2_amount
       or new.b3_amount is distinct from old.b3_amount)
     and (new.override_reason is null or btrim(new.override_reason) = '')
  then
    raise exception 'store-kpi-plan-locked: план смены зафиксирован, правка требует причины';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_store_kpi_shift_plans_guard on public.store_kpi_shift_plans;
create trigger trg_store_kpi_shift_plans_guard
before update on public.store_kpi_shift_plans
for each row execute function public.store_kpi_guard_locked_plan();
