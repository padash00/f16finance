-- Личный распорядок дня владельца: задачи по времени (ежедневные + разовые),
-- с напоминаниями в Telegram. Каждая задача привязана к auth.users.id,
-- видна только владельцу (RLS).

create table if not exists public.personal_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text null,
  recurrence text not null default 'once' check (recurrence in ('once', 'daily')),
  task_date date null,            -- для разовых задач (recurrence='once')
  task_time time null,            -- время дня (для обоих типов)
  remind boolean not null default false,
  remind_minutes_before integer not null default 0 check (remind_minutes_before >= 0),
  last_reminded_at timestamptz null,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists personal_tasks_user_idx
  on public.personal_tasks (user_id, recurrence, task_date);

create index if not exists personal_tasks_remind_idx
  on public.personal_tasks (remind, task_time)
  where remind = true;

-- Отметки выполнения по дням (для ежедневных копит историю дисциплины).
create table if not exists public.personal_task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.personal_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  done_date date not null,
  done_at timestamptz not null default timezone('utc', now()),
  unique (task_id, done_date)
);

create index if not exists personal_task_completions_task_idx
  on public.personal_task_completions (task_id, done_date);

alter table public.personal_tasks enable row level security;
alter table public.personal_task_completions enable row level security;

-- Видно/правится только владельцем своих записей.
drop policy if exists personal_tasks_owner on public.personal_tasks;
create policy personal_tasks_owner
  on public.personal_tasks
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists personal_task_completions_owner on public.personal_task_completions;
create policy personal_task_completions_owner
  on public.personal_task_completions
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

notify pgrst, 'reload schema';
