-- Хранилище истории диалогов Telegram-бота
create table if not exists telegram_chat_history (
  chat_id text primary key,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Автоочистка истории старше 7 дней (чтобы не раздувалась)
create index if not exists telegram_chat_history_updated_idx on telegram_chat_history (updated_at);
