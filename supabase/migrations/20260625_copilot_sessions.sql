-- Персистентные сессии AI-копилота (надёжность многошаговых действий на serverless).
-- Хранят состояние диалога целиком как JSONB; читаются/пишутся ТОЛЬКО service-role
-- клиентом копилота (createAdminSupabaseClient), поэтому RLS включён без политик
-- (service role обходит RLS; anon/authenticated доступа не имеют).

create table if not exists public.copilot_sessions (
  session_key text primary key,
  data        jsonb       not null,
  updated_at  timestamptz not null default now()
);

create index if not exists copilot_sessions_updated_at_idx
  on public.copilot_sessions (updated_at);

alter table public.copilot_sessions enable row level security;

comment on table public.copilot_sessions is
  'AI-копилот: персистентные сессии диалога (L2 к in-memory кэшу). Доступ только service-role.';
