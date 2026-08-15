-- ─────────────────────────────────────────────────────────────────────────
-- Эффективность продавцов, фаза 3: погода, ворота по знанию товара,
-- журнал запусков ИИ.
-- ─────────────────────────────────────────────────────────────────────────
-- Погода нужна как контекст потока, а не как оправдание для срезания бонуса.
-- Поэтому по умолчанию она НЕ двигает бонусные пороги: тумблер есть, но
-- выключен. Продавец не должен получать меньше денег за дождь.
--
-- Ключевая тонкость хранения: прогноз сохраняется снимком на дату, когда он
-- был получен. Иначе после смены мы бы смотрели на фактическую погоду и
-- делали вид, что знали её заранее — и любая оценка качества прогноза
-- оказалась бы завышенной.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.store_kpi_settings
  -- Координаты точки для запроса погоды. Без них погода просто не собирается.
  add column if not exists latitude numeric(9,6) null,
  add column if not exists longitude numeric(9,6) null,
  -- Тумблер из ТЗ. Значение по умолчанию — false, и менять его стоит только
  -- осознанно: погода влияет на поток, а не на качество работы продавца.
  add column if not exists weather_adjusts_bonus_threshold boolean not null default false,
  -- Ворота по знанию товара для верхних уровней бонуса. По умолчанию
  -- выключены: если в организации тесты не проводятся, включённые ворота
  -- срезали бы B3 всем подряд за отсутствие данных, а не за незнание.
  add column if not exists require_product_test_for_top_bonus boolean not null default false,
  add column if not exists product_test_min_score smallint not null default 80,
  -- Сколько дней результат теста считается действующим.
  add column if not exists product_test_valid_days smallint not null default 90;

-- ── Погода ───────────────────────────────────────────────────────────────
create table if not exists public.store_kpi_weather (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,

  day date not null,
  -- forecast — каким день выглядел заранее; actual — каким он оказался.
  kind text not null check (kind in ('forecast', 'actual')),
  -- Дата, НА КОТОРУЮ был известен этот прогноз. Для факта равна самому дню.
  captured_on date not null,
  captured_at timestamptz not null default now(),

  temperature_max numeric(5,2) null,
  temperature_min numeric(5,2) null,
  temperature_mean numeric(5,2) null,
  apparent_temperature_max numeric(5,2) null,
  precipitation_mm numeric(6,2) null,
  precipitation_probability smallint null,
  rain boolean null,
  snow boolean null,
  wind_speed numeric(5,2) null,
  weather_code smallint null,

  source text not null default 'open-meteo',
  payload jsonb null,

  created_at timestamptz not null default now(),

  constraint store_kpi_weather_uniq unique (company_id, day, kind, captured_on)
);

create index if not exists idx_store_kpi_weather_lookup
  on public.store_kpi_weather (company_id, day, kind);

-- ── Журнал запусков ИИ ───────────────────────────────────────────────────
-- ИИ в модуле только объясняет уже посчитанное. Но объяснение уходит людям,
-- поэтому нужно уметь ответить, что именно модель видела на входе и что
-- ответила — через полгода, когда никто уже не помнит.
create table if not exists public.store_kpi_ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,

  task_type text not null check (task_type in (
    'POST_SHIFT_CASHIER_REVIEW', 'MONTHLY_DEMAND_REVIEW', 'DAILY_SHIFT_FORECAST'
  )),
  subject_date date null,
  subject_shift text null,

  provider text null,
  model text null,
  model_version text not null default 'STORE_KPI_V1',

  -- Хэш входа: одинаковый вход не пересчитываем и видим повторы.
  input_hash text null,
  input_json jsonb null,
  output_json jsonb null,

  success boolean not null default true,
  error text null,
  tokens integer null,

  created_by uuid null,
  created_at timestamptz not null default now()
);

create index if not exists idx_store_kpi_ai_runs_lookup
  on public.store_kpi_ai_runs (company_id, task_type, created_at desc);

create index if not exists idx_store_kpi_ai_runs_subject
  on public.store_kpi_ai_runs (company_id, subject_date, subject_shift);

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.store_kpi_weather enable row level security;
alter table public.store_kpi_ai_runs enable row level security;

drop policy if exists "service_role full access store_kpi_weather" on public.store_kpi_weather;
create policy "service_role full access store_kpi_weather" on public.store_kpi_weather
  to service_role using (true) with check (true);

drop policy if exists "service_role full access store_kpi_ai_runs" on public.store_kpi_ai_runs;
create policy "service_role full access store_kpi_ai_runs" on public.store_kpi_ai_runs
  to service_role using (true) with check (true);
