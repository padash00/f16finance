-- Фикс для случая когда таблица role_capabilities существовала до миграции
-- 20260506_rbac_capabilities.sql и create table if not exists не добавил
-- колонку updated_at.
--
-- Идемпотентная: можно прогнать несколько раз.

alter table role_capabilities
  add column if not exists created_at timestamptz not null default now();

alter table role_capabilities
  add column if not exists updated_at timestamptz not null default now();

alter table user_capability_overrides
  add column if not exists created_at timestamptz not null default now();

-- Принудительно перезагружаем schema cache PostgREST,
-- чтобы Supabase API сразу увидел новые колонки.
notify pgrst, 'reload schema';
