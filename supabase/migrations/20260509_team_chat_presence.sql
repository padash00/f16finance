-- Presence для командного чата: кто онлайн и кто печатает.
-- Лёгкая таблица — обновляется heartbeat'ами раз в 10с.

create table if not exists public.team_chat_presence (
  user_id text not null,            -- auth.users.id ИЛИ operators.id (текстом)
  organization_id uuid null,
  user_name text not null,
  user_role text not null default 'staff',
  is_typing boolean not null default false,
  last_seen_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, organization_id)
);

create index if not exists idx_team_chat_presence_seen on public.team_chat_presence(last_seen_at desc);

alter table public.team_chat_presence enable row level security;
drop policy if exists team_chat_presence_all on public.team_chat_presence;
create policy team_chat_presence_all on public.team_chat_presence for all using (true) with check (true);

-- Realtime — чтобы клиенты могли получать апдейты «печатает» сразу
alter publication supabase_realtime add table public.team_chat_presence;

notify pgrst, 'reload schema';
