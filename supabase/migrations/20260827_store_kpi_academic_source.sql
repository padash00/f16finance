-- ─────────────────────────────────────────────────────────────────────────
-- Учебные периоды: происхождение записи и защита от дублей при импорте.
-- ─────────────────────────────────────────────────────────────────────────
-- Владелец принёс справочник учебного календаря Казахстана на 2026–2027 с
-- источниками и оценкой влияния на спрос. Чтобы им можно было пользоваться
-- осмысленно, у периода должно быть видно: откуда он взялся, кого касается и
-- насколько эти даты проверены.
--
-- Отдельно нужна уникальность: импорт должны можно было запускать повторно,
-- не плодя копии. Ключ — организация, точка, название и дата начала.
-- `nulls not distinct` нужен потому, что общие для организации периоды
-- хранятся с пустым company_id, а обычная уникальность считает NULL разными.

alter table public.store_kpi_academic_periods
  -- Кого касается: школьники, студенты, абитуриенты, все.
  add column if not exists audience text null,
  add column if not exists source_url text null,
  add column if not exists notes text null;

create unique index if not exists idx_store_kpi_academic_periods_uniq
  on public.store_kpi_academic_periods (organization_id, company_id, name, start_date)
  nulls not distinct;

comment on column public.store_kpi_academic_periods.confidence is
  'Насколько надёжны даты: 1.00 — подтверждено официальным источником, ниже — предварительно или оценка составителя.';
