-- ─────────────────────────────────────────────────────────────────────────
-- Удержание долгов сканера из зарплаты админ-сотрудников.
--
-- При выплате ЗП активные позиции point_debt_items сотрудника гасятся
-- (удерживаются из выплаты) и записываются в staff_debt_payments со ссылкой
-- на выплату. payment_id нужен, чтобы аннулирование выплаты восстановило
-- позиции сканера и аннулировало запись удержания.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.staff_debt_payments
  add column if not exists payment_id uuid null;

create index if not exists staff_debt_payments_payment_idx
  on public.staff_debt_payments (payment_id) where payment_id is not null;

comment on column public.staff_debt_payments.payment_id is
  'Выплата ЗП (staff_salary_payments.id), которой удержаны эти долги. NULL — ручная оплата долга.';
