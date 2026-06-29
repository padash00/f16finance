-- audit_log.actor_user_id ссылался на public.users, но действия в журнал пишут не
-- только админы, а и ОПЕРАТОРЫ — их user_id есть в auth.users, но нет в public.users.
-- Из-за этого insert в audit_log падал с FK-ошибкой (23503):
--   "Key (actor_user_id)=(...) is not present in table users"
-- Приложение это ловило и переписывало запись АНОНИМНО (actor_user_id = null) →
-- терялось «кто сделал», + каждая такая запись засоряла логи Postgres ERROR’ом и
-- делала двойную вставку.
--
-- Журнал аудита — append-only форензика: id актора нужно хранить даже после удаления
-- пользователя. Поэтому жёсткий FK на public.users тут лишний — снимаем его.
-- Имя/email актора по-прежнему резолвится в рантайме (auth.admin.getUserById),
-- так что в логах будет видно живого человека, а не «Система».

alter table public.audit_log
  drop constraint if exists audit_log_actor_user_id_fkey;

-- ──────────────────────────────────────────────────────────────────────────────
-- Альтернатива (если хочется сохранить ссылочную целостность вместо простого drop):
-- перенаправить FK на auth.users (там есть И админы, И операторы) с мягким удалением.
-- Применять ВМЕСТО drop выше. Может потребовать, чтобы все существующие
-- actor_user_id присутствовали в auth.users (обычно так и есть).
--
-- alter table public.audit_log
--   add constraint audit_log_actor_user_id_fkey
--   foreign key (actor_user_id) references auth.users (id) on delete set null;
-- ──────────────────────────────────────────────────────────────────────────────
