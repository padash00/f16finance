-- Мост: e-mail сотрудника → auth.users.id (на нём держится /planner «Распорядок дня»).
-- Нужно, чтобы Telegram-бот, опознав сотрудника по telegram_chat_id (staff.email),
-- мог положить задачу в ЕГО распорядок (personal_tasks.user_id = auth.users.id).
-- SECURITY DEFINER — читает auth.users (PostgREST напрямую туда не ходит).

create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1
$$;

revoke all on function public.auth_user_id_by_email(text) from public;
grant execute on function public.auth_user_id_by_email(text) to service_role;

notify pgrst, 'reload schema';
