-- Командный чат — общий для всех ролей (владелец, менеджер, оператор).
-- Realtime через Supabase Postgres Changes.

create table if not exists public.team_chat_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  -- Кто отправил
  sender_user_id uuid null,           -- auth.users.id (для staff/owner)
  sender_operator_id uuid null,       -- operators.id (для operators)
  sender_name text not null,          -- denormalized для скорости
  sender_role text not null,          -- "owner" | "manager" | "operator" | "marketer"
  sender_avatar_url text null,
  -- Контент
  message text not null default '',
  attachments jsonb null,             -- [{type, url, name}]
  -- Метаданные
  reply_to_id uuid null references public.team_chat_messages(id) on delete set null,
  edited_at timestamptz null,
  deleted_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_team_chat_org_created on public.team_chat_messages(organization_id, created_at desc);
create index if not exists idx_team_chat_recent on public.team_chat_messages(created_at desc);

-- Прочитанные сообщения (per-user pointer)
create table if not exists public.team_chat_read_state (
  user_id uuid not null,
  organization_id uuid null,
  last_read_message_id uuid null references public.team_chat_messages(id) on delete set null,
  last_read_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, organization_id)
);

-- RLS включаем но открыто (все авторизованные могут читать/писать)
alter table public.team_chat_messages enable row level security;
drop policy if exists team_chat_messages_all on public.team_chat_messages;
create policy team_chat_messages_all on public.team_chat_messages for all using (true) with check (true);

alter table public.team_chat_read_state enable row level security;
drop policy if exists team_chat_read_state_all on public.team_chat_read_state;
create policy team_chat_read_state_all on public.team_chat_read_state for all using (true) with check (true);

-- Включаем realtime
alter publication supabase_realtime add table public.team_chat_messages;

notify pgrst, 'reload schema';
