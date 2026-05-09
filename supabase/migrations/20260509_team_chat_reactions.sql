-- Реакции на сообщения чата + storage bucket для вложений.
-- Идёт отдельной миграцией поверх 20260509_team_chat.sql.

create table if not exists public.team_chat_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.team_chat_messages(id) on delete cascade,
  user_id uuid not null,           -- auth.users.id или operator.id (хранится строкой)
  user_name text not null,
  emoji text not null,             -- '❤️', '👍', '😂', '😮', '😢', '🙏', custom
  created_at timestamptz not null default timezone('utc', now()),
  unique(message_id, user_id, emoji)
);

create index if not exists idx_team_chat_reactions_message on public.team_chat_reactions(message_id);

alter table public.team_chat_reactions enable row level security;
drop policy if exists team_chat_reactions_all on public.team_chat_reactions;
create policy team_chat_reactions_all on public.team_chat_reactions for all using (true) with check (true);

alter publication supabase_realtime add table public.team_chat_reactions;

-- Storage bucket для вложений чата (фото, голос, файлы).
-- Создаётся через Supabase Dashboard или этим скриптом:
do $$ begin
  if not exists (select 1 from storage.buckets where id = 'team-chat-attachments') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('team-chat-attachments', 'team-chat-attachments', true, 52428800);  -- 50MB
  end if;
end $$;

-- Открытая RLS на bucket — все авторизованные могут читать/писать
do $$ begin
  drop policy if exists "team_chat_attachments_read" on storage.objects;
  create policy "team_chat_attachments_read"
    on storage.objects for select
    using (bucket_id = 'team-chat-attachments');

  drop policy if exists "team_chat_attachments_write" on storage.objects;
  create policy "team_chat_attachments_write"
    on storage.objects for insert
    with check (bucket_id = 'team-chat-attachments');
end $$;

notify pgrst, 'reload schema';
