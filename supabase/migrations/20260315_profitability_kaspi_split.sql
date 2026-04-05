alter table public.monthly_profitability_inputs
  add column if not exists kaspi_qr_turnover numeric not null default 0,
  add column if not exists kaspi_qr_rate numeric not null default 0,
  add column if not exists kaspi_gold_turnover numeric not null default 0,
  add column if not exists kaspi_gold_rate numeric not null default 0;
