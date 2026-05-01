-- История платежей по долгам поставщикам.
-- Сейчас одна оплата = один полный платёж (без partial), но таблица — задел
-- под будущие частичные. Также сохраняет события списания и переноса срока для аудита.

create table if not exists public.supplier_debt_payments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.supplier_debts(id) on delete cascade,
  organization_id uuid null references public.organizations(id) on delete cascade,
  paid_at date null,
  cash_amount numeric(14, 2) not null default 0,
  kaspi_amount numeric(14, 2) not null default 0,
  receipt_file_url text null,
  comment text null,
  expense_id uuid null references public.expenses(id) on delete set null,
  event_type text not null default 'payment'
    check (event_type in ('payment', 'write_off', 'due_date_change')),
  event_payload jsonb null,
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists supplier_debt_payments_debt_idx
  on public.supplier_debt_payments (debt_id, created_at desc);

create index if not exists supplier_debt_payments_org_idx
  on public.supplier_debt_payments (organization_id, created_at desc);

alter table public.supplier_debt_payments enable row level security;

drop policy if exists supplier_debt_payments_select on public.supplier_debt_payments;
create policy supplier_debt_payments_select on public.supplier_debt_payments for select using (true);

drop policy if exists supplier_debt_payments_insert on public.supplier_debt_payments;
create policy supplier_debt_payments_insert on public.supplier_debt_payments for insert with check (true);

drop policy if exists supplier_debt_payments_update on public.supplier_debt_payments;
create policy supplier_debt_payments_update on public.supplier_debt_payments for update using (true) with check (true);

drop policy if exists supplier_debt_payments_delete on public.supplier_debt_payments;
create policy supplier_debt_payments_delete on public.supplier_debt_payments for delete using (true);
