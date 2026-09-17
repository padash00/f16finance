-- Отключение расчётного регистра зарплаты (staff_salary_settlements).
--
-- 2026-09-17, решение владельца: зарплату админ-состава считает одна система —
-- ведомость на /salary. Регистр, подключённый миграциями 20260902*, считал ту же
-- зарплату по своим правилам и через триггеры переписывал строки staff_adjustments:
--
--   * «Переплата по выплате» пересчитывалась из распределения платежей: сумма
--     менялась (у Магомедова 1 510 ₸ по комментарию стали 6 490 ₸), а ручное
--     аннулирование откатывалось — статус возвращался в active;
--   * выплата создавала расчёт с суммой, равной самой выплате. Если платили ровно
--     посчитанное ведомостью, исправлять было нечем, и у регистра оставался
--     фантомный долг перед сотрудником;
--   * ручные корректировки применялись к регистру и тут же помечались закрытыми,
--     поэтому пропадали из ведомости без объяснения.
--
-- Владелец про регистр не знал; две системы давали разные цифры.
--
-- Что делает миграция: снимает ТОЛЬКО триггеры. Таблицы регистра, его события и
-- функции остаются — история не теряется, страница /salary/settlements покажет
-- замороженный срез на момент отключения.
--
-- Вернуть регистр: пересоздать триггеры из 20260902144510, 20260902145117 и
-- 20260902145211 (там же их определения).
--
-- Суммы, которые регистр уже успел переписать, миграция не трогает — их показывает
-- scripts/sql/staff-salary-bridge-rows-check.sql, исправлять осознанно.

drop trigger if exists trg_staff_salary_adjustment_insert on public.staff_adjustments;
drop trigger if exists trg_staff_salary_adjustment_status on public.staff_adjustments;
drop trigger if exists trg_staff_salary_source_adjustment on public.staff_adjustments;

drop trigger if exists trg_staff_salary_payment_insert on public.staff_salary_payments;
drop trigger if exists trg_staff_salary_payment_delete on public.staff_salary_payments;

drop trigger if exists trg_staff_salary_point_debt_insert on public.point_debt_items;

drop trigger if exists trg_staff_salary_settlement_remainder on public.staff_salary_settlements;
