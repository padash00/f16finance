-- ─── Invoice name mappings (learned product name aliases) ────────────────────
create table if not exists public.invoice_name_mappings (
  id uuid primary key default gen_random_uuid(),
  invoice_name text not null,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  usage_count integer not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists invoice_name_mappings_name_uidx
  on public.invoice_name_mappings (lower(invoice_name));

create index if not exists invoice_name_mappings_item_idx
  on public.invoice_name_mappings (item_id);

-- ─── Telegram invoice sessions (pending confirmations) ────────────────────────
create table if not exists public.telegram_invoice_sessions (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id text not null,
  chat_id text not null,
  message_id integer null,
  parsed_data jsonb not null default '{}'::jsonb,
  warehouse_location_id uuid null references public.inventory_locations(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  receipt_id uuid null references public.inventory_receipts(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null default (timezone('utc', now()) + interval '1 hour')
);

create index if not exists telegram_invoice_sessions_user_status_idx
  on public.telegram_invoice_sessions (telegram_user_id, status);

create index if not exists telegram_invoice_sessions_expires_idx
  on public.telegram_invoice_sessions (expires_at)
  where status = 'pending';
