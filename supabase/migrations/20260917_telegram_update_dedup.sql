-- Дедуп входящих апдейтов Telegram.
--
-- Telegram повторяет доставку апдейта, пока вебхук не ответит 2xx. Наш вебхук на
-- любой ошибке отвечал 500 — и тот же самый апдейт приходил снова: ответ на
-- вопрос экзамена засчитывался дважды, расход с фотографии чека парсился и
-- создавался дважды, кнопка отрабатывала повторно. Ничего не сверялось по
-- update_id, потому что сверять было негде.
--
-- Теперь вебхук в самом начале вставляет сюда update_id. Вставка упала на
-- первичном ключе — значит, этот апдейт уже разбирали: молча отвечаем 200.
--
-- Таблица растёт примерно на число сообщений боту; чистить её раз в сутки
-- (created_at) можно, но не обязательно — строка весит десятки байт.

create table if not exists public.telegram_processed_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);

create index if not exists idx_telegram_processed_updates_created_at
  on public.telegram_processed_updates (created_at);

comment on table public.telegram_processed_updates is
  'Разобранные update_id вебхука Telegram. Вставка-конфликт = повторная доставка, апдейт пропускаем.';

-- Пишет только серверный вебхук под service role (обходит RLS), политик нет
alter table public.telegram_processed_updates enable row level security;

notify pgrst, 'reload schema';
