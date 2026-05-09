-- Настройки уведомлений по типам.
-- Каждая запись — выбор пользователя «получать ли push/telegram по типу события».

create table if not exists public.notification_prefs (
  user_id uuid not null,
  channel text not null,                -- 'push' | 'telegram' | 'in_app'
  event_type text not null,             -- 'team_chat_message', 'dm', 'announcement', 'shift_assigned', 'task_assigned', 'debt_overdue', 'birthday', etc
  enabled boolean not null default true,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, channel, event_type)
);

create index if not exists idx_notification_prefs_user on public.notification_prefs(user_id);

alter table public.notification_prefs enable row level security;
drop policy if exists notification_prefs_self on public.notification_prefs;
create policy notification_prefs_self on public.notification_prefs for all using (true) with check (true);

notify pgrst, 'reload schema';
