-- Расширяем team_chat_messages: объявления, закрепления со сроком, контекст.

alter table public.team_chat_messages
  add column if not exists is_announcement boolean not null default false,
  add column if not exists pinned_until timestamptz null,
  add column if not exists context_type text null,        -- 'task' | 'shift' | 'debt' | 'expense' | 'income' | null
  add column if not exists context_id uuid null,
  add column if not exists context_label text null;       -- "Задача №42 · Поменять кран"

-- Индекс для поиска по контексту (быстро фильтровать «обсуждения этой задачи»)
create index if not exists idx_team_chat_context
  on public.team_chat_messages(context_type, context_id, created_at desc)
  where context_type is not null;

-- Индекс для активных закреплений + объявлений (на главном экране чата)
create index if not exists idx_team_chat_pinned
  on public.team_chat_messages(pinned_until desc)
  where pinned_until is not null and pinned_until > now() and deleted_at is null;

create index if not exists idx_team_chat_announcements
  on public.team_chat_messages(created_at desc)
  where is_announcement = true and deleted_at is null;

notify pgrst, 'reload schema';
