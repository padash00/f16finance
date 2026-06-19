-- Маршрутизация Telegram-отчётов по организациям (SaaS-изоляция рассылок).
-- Каждая организация получает свои cron/бот-отчёты в собственный чат владельца.
alter table organizations add column if not exists telegram_owner_chat_id text;

comment on column organizations.telegram_owner_chat_id is
  'Chat ID для cron/бот-отчётов этой организации. NULL → используется env-фолбэк '
  '(TELEGRAM_OWNER_CHAT_ID для org из TELEGRAM_OWNER_ORG_ID) ради обратной совместимости.';

-- ВАЖНО для F16: чтобы отчёты не пропали при переходе на per-org рассылку, задай чат
-- владельца F16 (значение = текущий TELEGRAM_OWNER_CHAT_ID):
--   update organizations set telegram_owner_chat_id = '<твой_owner_chat_id>'
--   where id = '447fdc6d-f3bd-453a-b471-465eb3c81e99';
-- (или оставь NULL — тогда сработает env-фолбэк, пока F16 единственный.)
