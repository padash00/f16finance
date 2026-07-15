-- Комментарии задач: колонка автора-оператора. Код (быстрые ответы, комментарии,
-- ответы операторов из Telegram/кабинета) всегда передаёт operator_id, но в базе
-- колонки не было → «Could not find the 'operator_id' column of 'task_comments'».

alter table public.task_comments
  add column if not exists operator_id uuid null;

create index if not exists task_comments_operator_idx
  on public.task_comments (operator_id) where operator_id is not null;

comment on column public.task_comments.operator_id is
  'Автор-оператор комментария (operators.id); NULL — комментарий сотрудника/системы.';
