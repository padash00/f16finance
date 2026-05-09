-- Этап 4: статусы пользователя + опросы.

-- Расширяем team_chat_presence: статус (онлайн / на смене / выходной / болен / offline)
alter table public.team_chat_presence
  add column if not exists status text not null default 'online',  -- online | on_shift | day_off | sick | offline
  add column if not exists status_emoji text null,
  add column if not exists status_text text null;

create index if not exists idx_team_chat_presence_status
  on public.team_chat_presence(status, last_seen_at desc);

-- Опросы (Polls) — встроены в team_chat как special-attachment
create table if not exists public.team_chat_polls (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.team_chat_messages(id) on delete cascade,
  question text not null,
  options jsonb not null,                             -- [{id, label}]
  multiple_choice boolean not null default false,
  expires_at timestamptz null,
  created_by_user_id uuid null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_team_chat_polls_message on public.team_chat_polls(message_id);

create table if not exists public.team_chat_poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.team_chat_polls(id) on delete cascade,
  voter_user_id uuid not null,
  voter_name text not null,
  option_id text not null,
  voted_at timestamptz not null default timezone('utc', now()),
  unique(poll_id, voter_user_id, option_id)
);

create index if not exists idx_poll_votes_poll on public.team_chat_poll_votes(poll_id);

alter table public.team_chat_polls enable row level security;
drop policy if exists team_chat_polls_all on public.team_chat_polls;
create policy team_chat_polls_all on public.team_chat_polls for all using (true) with check (true);

alter table public.team_chat_poll_votes enable row level security;
drop policy if exists team_chat_poll_votes_all on public.team_chat_poll_votes;
create policy team_chat_poll_votes_all on public.team_chat_poll_votes for all using (true) with check (true);

alter publication supabase_realtime add table public.team_chat_polls;
alter publication supabase_realtime add table public.team_chat_poll_votes;

notify pgrst, 'reload schema';
