-- Push device tokens для APNs/FCM.
-- Каждый user_id может иметь несколько устройств (телефон + iPad + Android).

create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,                    -- auth.users.id
  operator_id uuid null,                    -- если оператор, для удобства лукапа
  device_token text not null,               -- APNs hex token (64 hex chars) или FCM token
  platform text not null default 'ios',     -- 'ios' | 'android'
  app_version text null,
  device_name text null,                    -- "iPhone 13 от Жансаи"
  is_active boolean not null default true,
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique(user_id, device_token)
);

create index if not exists idx_push_devices_user on public.push_devices(user_id) where is_active;
create index if not exists idx_push_devices_operator on public.push_devices(operator_id) where is_active;

alter table public.push_devices enable row level security;
drop policy if exists push_devices_self on public.push_devices;
create policy push_devices_self on public.push_devices
  for all
  using (true)              -- читать может service_role / любой авторизованный (мы фильтруем на API)
  with check (true);

notify pgrst, 'reload schema';
