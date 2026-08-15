-- ─────────────────────────────────────────────────────────────────────────
-- Эффективность продавцов: связь начисленного бонуса с зарплатой.
-- ─────────────────────────────────────────────────────────────────────────
-- До сих пор бонусы считались и записывались в store_kpi_bonus_awards, но до
-- зарплаты не доходили — их пришлось бы переносить руками. Теперь начисление
-- создаёт запись в operator_salary_adjustments (kind = 'bonus'), и она сама
-- попадает в недельный расчёт.
--
-- Главное требование здесь — не заплатить дважды. Защита двойная:
--   * уникальность начисления по (точка, кассир, вид, период, смена) уже есть
--     в таблице наград;
--   * ссылка на созданную зарплатную корректировку хранится рядом, поэтому
--     повторный запуск видит, что деньги уже назначены, и ничего не делает.
--
-- Обратная ссылка нужна и для отмены: если корректировку в зарплате убрали,
-- по ней видно, какое именно начисление KPI её породило.

-- Сменные бонусы B1/B2/B3 по умолчанию НЕ платятся из этого модуля: пороги по
-- обороту уже есть в правилах зарплаты (threshold1/threshold2), и платить за
-- одну смену дважды нельзя. Уровни KPI остаются целью на смену, а деньги за
-- оборот начисляет прежнее правило. Тумблер оставлен на случай, если владелец
-- решит перенести оплату оборота сюда — тогда пороги в правилах обнуляются.
alter table public.store_kpi_settings
  add column if not exists shift_bonus_paid boolean not null default false;

alter table public.store_kpi_bonus_awards
  add column if not exists salary_adjustment_id uuid null,
  -- Начисление могут отменить — тогда деньги в зарплату не идут, но след
  -- решения остаётся.
  add column if not exists voided_at timestamptz null,
  add column if not exists void_reason text null;

create index if not exists idx_store_kpi_bonus_awards_adjustment
  on public.store_kpi_bonus_awards (salary_adjustment_id)
  where salary_adjustment_id is not null;

comment on column public.store_kpi_bonus_awards.salary_adjustment_id is
  'Корректировка в operator_salary_adjustments, созданная этим начислением. Пусто — деньги в зарплату не переданы.';
