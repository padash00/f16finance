-- Customers table
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  name text not null,
  phone text null,
  card_number text null, -- barcode for scanner
  email text null,
  notes text null,
  loyalty_points integer not null default 0 check (loyalty_points >= 0),
  total_spent numeric(14, 2) not null default 0,
  visits_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists customers_phone_company_uidx
  on public.customers (company_id, phone) where phone is not null;

create unique index if not exists customers_card_uidx
  on public.customers (card_number) where card_number is not null;

create index if not exists customers_company_idx
  on public.customers (company_id, is_active);

-- Discounts table
create table if not exists public.discounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  name text not null,
  type text not null check (type in ('percent', 'fixed', 'promo_code')),
  value numeric(10, 2) not null check (value >= 0),
  promo_code text null,
  min_order_amount numeric(14, 2) not null default 0,
  is_active boolean not null default true,
  valid_from date null,
  valid_to date null,
  usage_limit integer null,
  usage_count integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists discounts_promo_code_uidx
  on public.discounts (lower(promo_code)) where promo_code is not null;

-- Loyalty config per company
create table if not exists public.loyalty_config (
  company_id uuid primary key references public.companies(id) on delete cascade,
  points_per_100_tenge integer not null default 1, -- how many points per 100 tenge spent
  tenge_per_point numeric(8, 4) not null default 1, -- how much 1 point is worth in tenge
  min_points_to_redeem integer not null default 100,
  max_redeem_percent integer not null default 50, -- max % of order payable with points
  is_active boolean not null default true
);

-- Add columns to point_sales
alter table public.point_sales
  add column if not exists customer_id uuid null references public.customers(id) on delete set null,
  add column if not exists discount_id uuid null references public.discounts(id) on delete set null,
  add column if not exists discount_amount numeric(14, 2) not null default 0,
  add column if not exists loyalty_points_earned integer not null default 0,
  add column if not exists loyalty_points_spent integer not null default 0,
  add column if not exists loyalty_discount_amount numeric(14, 2) not null default 0;
