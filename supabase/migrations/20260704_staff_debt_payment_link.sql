-- ─────────────────────────────────────────────────────────────────────────
-- Удержание долгов сканера из зарплаты админ-сотрудников.
--
-- При выплате ЗП активные позиции point_debt_items сотрудника гасятся
-- (удерживаются из выплаты) и записываются в staff_debt_payments со ссылкой
-- на выплату. payment_id нужен, чтобы аннулирование выплаты восстановило
-- позиции сканера и аннулировало запись удержания.
--
-- ВАЖНО: staff_salary_payments.id — bigint (целые 84, 85…), НЕ uuid.
-- Первая версия этой миграции ошибочно создала колонку uuid — блок ниже
-- пересоздаёт её с правильным типом (данных в ней быть не могло: вставки падали).
-- ─────────────────────────────────────────────────────────────────────────

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff_debt_payments'
      and column_name = 'payment_id' and data_type = 'uuid'
  ) then
    alter table public.staff_debt_payments drop column payment_id;
  end if;
end $$;

alter table public.staff_debt_payments
  add column if not exists payment_id bigint null;

create index if not exists staff_debt_payments_payment_idx
  on public.staff_debt_payments (payment_id) where payment_id is not null;

comment on column public.staff_debt_payments.payment_id is
  'Выплата ЗП (staff_salary_payments.id, bigint), которой удержаны эти долги. NULL — ручная оплата долга.';
