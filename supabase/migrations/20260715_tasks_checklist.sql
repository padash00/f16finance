-- Чек-лист (подзадачи) внутри задачи: [{id, text, done}], хранится jsonb.
-- Прогресс виден на карточке канбана, редактируется в деталях задачи.

alter table public.tasks
  add column if not exists checklist jsonb not null default '[]'::jsonb;

comment on column public.tasks.checklist is
  'Чек-лист задачи: массив {id: string, text: string, done: boolean}';
