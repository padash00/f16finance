-- Личные сообщения 1-на-1.
-- Каждое сообщение знает sender + recipient. Тред = пара (user_a, user_b).

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null,
  recipient_user_id uuid not null,
  -- Денормализованные имена (чтобы не джойнить каждый раз)
  sender_name text not null,
  sender_role text not null default 'staff',
  recipient_name text not null default '',
  -- Контент
  message text not null default '',
  attachments jsonb null,
  reply_to_id uuid null references public.direct_messages(id) on delete set null,
  -- Жизненный цикл
  edited_at timestamptz null,
  deleted_at timestamptz null,
  read_at timestamptz null,           -- когда recipient прочитал
  created_at timestamptz not null default timezone('utc', now())
);

-- Тред идентифицируется парой (user_a, user_b) — нормализуем для быстрого лукапа.
-- thread_key = LEAST(sender, recipient) || '_' || GREATEST(sender, recipient)
create index if not exists idx_direct_messages_thread
  on public.direct_messages(
    least(sender_user_id::text, recipient_user_id::text),
    greatest(sender_user_id::text, recipient_user_id::text),
    created_at desc
  );

create index if not exists idx_direct_messages_recipient_unread
  on public.direct_messages(recipient_user_id, created_at desc)
  where read_at is null and deleted_at is null;

create index if not exists idx_direct_messages_sender on public.direct_messages(sender_user_id, created_at desc);

alter table public.direct_messages enable row level security;
drop policy if exists direct_messages_all on public.direct_messages;
create policy direct_messages_all on public.direct_messages for all using (true) with check (true);

-- Realtime
alter publication supabase_realtime add table public.direct_messages;

notify pgrst, 'reload schema';
