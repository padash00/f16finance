-- Arena payment fields on sessions
alter table public.arena_sessions
  add column if not exists payment_method text not null default 'cash',
  add column if not exists cash_amount     numeric not null default 0,
  add column if not exists kaspi_amount    numeric not null default 0,
  add column if not exists discount_percent numeric not null default 0,
  add column if not exists income_id       uuid null;

-- Tariff type support (fixed duration vs time-window package)
alter table public.arena_tariffs
  add column if not exists tariff_type     text not null default 'fixed',
  add column if not exists window_end_time text null;  -- e.g. '16:00', '10:00'
