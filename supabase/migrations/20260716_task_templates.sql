-- Шаблоны задач и повторяющиеся задачи.
-- Шаблон = заготовка (название, чек-лист, исполнитель, приоритет, точка).
-- recurrence_days (1=Пн … 7=Вс) — крон каждое утро создаёт задачу в эти дни;
-- NULL — шаблон только для ручного «Создать сейчас».

create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete set null,
  title text not null,
  description text null,
  checklist jsonb not null default '[]'::jsonb,
  priority text not null default 'medium',
  operator_id uuid null references public.operators(id) on delete set null,
  staff_id uuid null references public.staff(id) on delete set null,
  due_in_days int null,
  recurrence_days int[] null,
  is_active boolean not null default true,
  created_by uuid null,
  last_spawned_on date null,
  created_at timestamptz not null default now()
);

create index if not exists task_templates_active_idx
  on public.task_templates (is_active) where is_active;

comment on table public.task_templates is
  'Шаблоны задач: ручные заготовки и повторяющиеся (recurrence_days, крон recurring-tasks)';
comment on column public.task_templates.recurrence_days is
  'Дни недели автосоздания задачи (1=Пн…7=Вс); NULL — только ручной запуск';
comment on column public.task_templates.due_in_days is
  'Дедлайн создаваемой задачи: через N дней от даты создания; NULL — без дедлайна';
