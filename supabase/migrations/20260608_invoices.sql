-- Ручной биллинг: счета организаций. Без платёжных провайдеров/webhooks —
-- суперадмин выставляет счёт и отмечает оплату руками. Аддитивно.

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  amount numeric(14, 2) not null default 0,
  currency text not null default 'KZT',
  period_start date null,
  period_end date null,
  due_date date null,
  status text not null default 'issued' check (status in ('draft', 'issued', 'paid', 'void', 'overdue')),
  method text null,                          -- cash / kaspi / transfer / manual (при оплате)
  note text null,
  issued_at timestamptz not null default timezone('utc', now()),
  paid_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists invoices_org_idx on public.invoices (organization_id, created_at desc);
create index if not exists invoices_status_idx on public.invoices (status);

alter table public.invoices enable row level security;
drop policy if exists invoices_all on public.invoices;
create policy invoices_all on public.invoices for all using (true) with check (true);

notify pgrst, 'reload schema';
