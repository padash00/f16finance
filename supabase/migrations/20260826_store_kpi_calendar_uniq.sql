-- ─────────────────────────────────────────────────────────────────────────
-- Календарь модуля: уникальность, с которой умеет работать upsert.
-- ─────────────────────────────────────────────────────────────────────────
-- Прежний индекс был построен по выражению:
--
--   (organization_id, coalesce(company_id, '000…0'::uuid), day, day_type)
--
-- Так делали, потому что в Postgres NULL-значения по умолчанию считаются
-- различными, и общие для организации дни (company_id пуст) могли
-- задваиваться.
--
-- Но upsert из кода указывает конфликт по обычным колонкам
-- (organization_id, company_id, day, day_type), а под выражение он не
-- подходит: Postgres отвечает 42P10 «нет подходящего ограничения», и добавить
-- праздники было невозможно.
--
-- Начиная с Postgres 15 у уникального индекса есть `nulls not distinct` —
-- ровно то, ради чего городили coalesce, но без выражения. Переходим на него.

drop index if exists idx_store_kpi_calendar_days_uniq;

create unique index if not exists idx_store_kpi_calendar_days_uniq
  on public.store_kpi_calendar_days (organization_id, company_id, day, day_type)
  nulls not distinct;
