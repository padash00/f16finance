-- Токены push-уведомлений мобильного приложения (Expo).
create table if not exists public.mobile_push_tokens (
  token text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  operator_id uuid null,
  organization_id uuid references public.organizations(id) on delete cascade,
  platform text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists mobile_push_tokens_org_idx on public.mobile_push_tokens(organization_id);
create index if not exists mobile_push_tokens_user_idx on public.mobile_push_tokens(user_id);

-- Доступ только через service-role API (RLS включён, политик нет → клиентам закрыто).
alter table public.mobile_push_tokens enable row level security;
