create table if not exists public.monthly_profitability_inputs (
  id uuid primary key default gen_random_uuid(),
  month date not null unique,
  qr_gold_turnover numeric not null default 0,
  qr_gold_rate numeric not null default 0,
  other_cards_turnover numeric not null default 0,
  other_cards_rate numeric not null default 0,
  kaspi_red_turnover numeric not null default 0,
  kaspi_red_rate numeric not null default 0,
  kaspi_kredit_turnover numeric not null default 0,
  kaspi_kredit_rate numeric not null default 0,
  payroll_amount numeric not null default 0,
  payroll_taxes_amount numeric not null default 0,
  income_tax_amount numeric not null default 0,
  depreciation_amount numeric not null default 0,
  amortization_amount numeric not null default 0,
  other_operating_amount numeric not null default 0,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.monthly_profitability_inputs
enable row level security;
