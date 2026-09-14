-- Остаток денег на /cashflow.
--
-- Движение денег считалось «от нуля» с начала периода — это накопленная
-- прибыль, а не деньги на руках. Владелец один раз вводит, сколько было
-- наличных и безналичных на утро даты; дальше остаток на любой день
-- считается как «введённое + поступления − расходы» от этой даты.
--
-- scope_key: 'all' — вся организация (все точки, включая F16 Extra: это
-- реальные деньги), иначе id точки. Несколько отметок на разные даты —
-- берётся последняя до нужного дня (так можно «сверить» кассу заново).

create table if not exists public.cash_balance_anchors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete cascade,
  scope_key text not null,
  as_of_date date not null,
  cash_amount numeric(14, 2) not null default 0,
  cashless_amount numeric(14, 2) not null default 0,
  note text null,
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint cash_balance_anchors_scope_check check (
    (company_id is null and scope_key = 'all') or (company_id is not null and scope_key = company_id::text)
  )
);

create unique index if not exists cash_balance_anchors_scope_date_uidx
  on public.cash_balance_anchors (organization_id, scope_key, as_of_date);

-- Доступ только через серверный API (service role обходит RLS)
alter table public.cash_balance_anchors enable row level security;

notify pgrst, 'reload schema';
