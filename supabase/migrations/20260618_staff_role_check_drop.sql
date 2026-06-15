-- staff.role теперь хранит НАЗВАНИЕ ДОЛЖНОСТИ (positions.name), а доступы идут
-- через RBAC-capabilities. Старый CHECK staff_role_check (owner/manager/other)
-- блокировал найм с любой кастомной должностью:
--   new row for relation "staff" violates check constraint "staff_role_check"
-- Динамические должности не помещаются в фиксированный список — снимаем констрейнт.
-- Уровень доступа по-прежнему нормализуется кодом (normalizeStaffRole → 'other'
-- для незнакомых ролей), так что это безопасно.

alter table public.staff drop constraint if exists staff_role_check;

notify pgrst, 'reload schema';
