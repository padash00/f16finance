-- supplier_debts: единый учёт обязательств перед поставщиком
-- 1 приёмка = 1 долг. Только полная оплата (без partial).
--
-- Жизненный цикл:
--   open         — приёмка проведена, не оплачено
--   paid         — оплачено целиком, привязан expense с чеком
--   written_off  — списано (не платим)

create table if not exists public.supplier_debts (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.inventory_receipts(id) on delete cascade,
  supplier_id uuid null references public.inventory_suppliers(id) on delete set null,
  company_id uuid null references public.companies(id) on delete set null,
  organization_id uuid null references public.organizations(id) on delete cascade,
  expense_category_id uuid null references public.expense_categories(id) on delete set null,
  total_amount numeric(14, 2) not null default 0,
  status text not null default 'open'
    check (status in ('open', 'paid', 'written_off')),
  due_date date null,
  is_consignment boolean not null default false,
  payment_paid_at date null,
  payment_cash_amount numeric(14, 2) not null default 0,
  payment_kaspi_amount numeric(14, 2) not null default 0,
  payment_receipt_file_url text null,
  payment_comment text null,
  expense_id uuid null references public.expenses(id) on delete set null,
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists supplier_debts_receipt_uidx
  on public.supplier_debts (receipt_id);

create index if not exists supplier_debts_status_idx
  on public.supplier_debts (status, due_date);

create index if not exists supplier_debts_org_idx
  on public.supplier_debts (organization_id);

-- Триггер обновления updated_at
create or replace function public.supplier_debts_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists supplier_debts_updated_at on public.supplier_debts;
create trigger supplier_debts_updated_at
  before update on public.supplier_debts
  for each row execute function public.supplier_debts_set_updated_at();

-- Бэкфилл: для каждой приёмки создаём долг.
-- Если есть авто-расход (source_type='inventory_receipt') — переносим в долг как paid.
-- Если расхода нет — оставляем open (но это не ожидается, т.к. до сих пор все приёмки сразу шли в expenses).
insert into public.supplier_debts (
  receipt_id, supplier_id, company_id, organization_id,
  expense_category_id,
  total_amount,
  status,
  payment_paid_at, payment_cash_amount, payment_kaspi_amount,
  payment_receipt_file_url, payment_comment,
  expense_id,
  created_by, created_at
)
select
  r.id,
  r.supplier_id,
  l.company_id,
  l.organization_id,
  cat.id,
  coalesce(r.total_amount, 0),
  case when e.id is not null then 'paid' else 'open' end,
  case when e.id is not null then e.date else null end,
  coalesce(e.cash_amount, 0),
  coalesce(e.kaspi_amount, 0),
  e.attachment_url,
  e.comment,
  e.id,
  r.created_by,
  r.created_at
from public.inventory_receipts r
left join public.inventory_locations l on l.id = r.location_id
left join public.expenses e
  on e.source_type = 'inventory_receipt' and e.source_id = r.id
left join lateral (
  select ec.id from public.expense_categories ec
  where lower(coalesce(ec.name, '')) = lower(coalesce(e.category, ''))
  limit 1
) cat on true
on conflict (receipt_id) do nothing;

-- RLS: повторяем модель existing inventory tables (organization-scoped + service role bypass).
alter table public.supplier_debts enable row level security;

drop policy if exists supplier_debts_select on public.supplier_debts;
create policy supplier_debts_select on public.supplier_debts
  for select
  using (true);

drop policy if exists supplier_debts_insert on public.supplier_debts;
create policy supplier_debts_insert on public.supplier_debts
  for insert
  with check (true);

drop policy if exists supplier_debts_update on public.supplier_debts;
create policy supplier_debts_update on public.supplier_debts
  for update
  using (true)
  with check (true);

drop policy if exists supplier_debts_delete on public.supplier_debts;
create policy supplier_debts_delete on public.supplier_debts
  for delete
  using (true);
