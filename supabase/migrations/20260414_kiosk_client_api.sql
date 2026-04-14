-- Kiosk client API: balance, theme, catalog category, client token sessions

-- 1. Баланс клиента в тенге (для киоска)
alter table public.customers
  add column if not exists kiosk_balance numeric not null default 0 check (kiosk_balance >= 0);

comment on column public.customers.kiosk_balance is 'Предоплаченный баланс клиента в тенге для киоска';

-- 2. Категория игры в каталоге (game / browser / app)
alter table public.arena_games_catalog
  add column if not exists category text not null default 'game'
    check (category in ('game', 'browser', 'app'));

comment on column public.arena_games_catalog.category is 'Категория: game | browser | app';

-- 3. Тема/дизайн станции
alter table public.arena_stations
  add column if not exists kiosk_bg_type    text not null default 'color'
    check (kiosk_bg_type in ('color', 'gradient', 'image', 'video')),
  add column if not exists kiosk_bg_value   text not null default 'linear-gradient(135deg, #07080a 0%, #0f1520 100%)',
  add column if not exists kiosk_accent     text not null default '#2563eb',
  add column if not exists kiosk_logo_url   text null,
  add column if not exists kiosk_announcement text null;

-- 4. Клиентские токены сессий (для авторизации в киоске без Supabase JS)
create table if not exists public.kiosk_client_tokens (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  token_hash   text not null,
  station_id   uuid null references public.arena_stations(id) on delete set null,
  expires_at   timestamptz not null default (now() + interval '8 hours'),
  created_at   timestamptz not null default now()
);

create unique index if not exists uq_kiosk_client_tokens_hash
  on public.kiosk_client_tokens(token_hash);

create index if not exists idx_kiosk_client_tokens_customer
  on public.kiosk_client_tokens(customer_id, expires_at);

-- Автоудаление истёкших токенов (будет чиститься через cron или at query time)
comment on table public.kiosk_client_tokens is 'Короткоживущие токены для авторизации клиента в kiosk-приложении';
