-- Флаги ИИ-модерации для team_chat_messages и direct_messages.
-- Cron сканирует новые сообщения раз в 5 мин, шлёт в Claude, вставляет флаги для подозрительных.

create table if not exists public.chat_moderation_flags (
  id uuid primary key default gen_random_uuid(),
  -- Источник
  source_table text not null,                 -- 'team_chat' | 'direct_messages'
  source_message_id uuid not null,
  -- Контекст
  author_user_id uuid null,
  author_name text not null default 'Аноним',
  recipient_user_id uuid null,                -- для DM
  organization_id uuid null,
  message_text text not null,
  -- Оценка ИИ
  severity smallint not null default 0,       -- 0..10
  categories jsonb not null default '[]'::jsonb,  -- ['cash_skim','data_leak','harassment','threat','profanity','other']
  ai_summary text null,
  ai_model text null default 'gpt-4o-mini',
  -- Решение владельца
  status text not null default 'pending',     -- 'pending' | 'confirmed' | 'dismissed'
  reviewed_by uuid null,
  reviewed_at timestamptz null,
  reviewer_note text null,
  created_at timestamptz not null default timezone('utc', now()),
  unique(source_table, source_message_id)
);

create index if not exists idx_chat_mod_flags_pending
  on public.chat_moderation_flags(created_at desc)
  where status = 'pending';

create index if not exists idx_chat_mod_flags_severity
  on public.chat_moderation_flags(severity desc, created_at desc)
  where status = 'pending';

alter table public.chat_moderation_flags enable row level security;
drop policy if exists chat_mod_flags_all on public.chat_moderation_flags;
create policy chat_mod_flags_all on public.chat_moderation_flags for all using (true) with check (true);

notify pgrst, 'reload schema';
