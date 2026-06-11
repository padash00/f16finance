-- Платежи по долгам административных сотрудников (кнопка «Оплата долга» в зарплате).
-- Хранит затронутые строки (debts / point_debt_items / staff_adjustments),
-- чтобы платёж можно было АННУЛИРОВАТЬ (откатить статусы обратно в active).

create table if not exists public.staff_debt_payments (
  id               uuid primary key default gen_random_uuid(),
  staff_id         uuid not null,
  amount           numeric(12, 2) not null default 0,
  comment          text null,
  debt_ids         uuid[] not null default '{}',   -- закрытые debts
  item_ids         uuid[] not null default '{}',   -- помеченные deleted point_debt_items
  adjustment_ids   uuid[] not null default '{}',   -- закрытые staff_adjustments
  status           text not null default 'active' check (status in ('active', 'voided')),
  organization_id  uuid null references public.organizations(id) on delete set null,
  paid_at          timestamptz not null default now(),
  paid_by          uuid null,
  voided_at        timestamptz null,
  created_at       timestamptz not null default now()
);

create index if not exists staff_debt_payments_staff_idx
  on public.staff_debt_payments (staff_id, status, paid_at desc);

-- Доступ только через service-role (admin-клиент в API).
alter table public.staff_debt_payments enable row level security;
