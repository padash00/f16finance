alter table public.monthly_profitability_inputs
  add column if not exists cash_revenue_override numeric not null default 0,
  add column if not exists pos_revenue_override numeric not null default 0;
