-- Задачи для админ-сотрудников: исполнителем задачи может быть не только
-- оператор (tasks.operator_id), но и сотрудник (tasks.staff_id).
-- Одновременно заполняется только одно из двух полей — следит API.

alter table public.tasks
  add column if not exists staff_id uuid null references public.staff(id) on delete set null;

create index if not exists tasks_staff_id_idx
  on public.tasks (staff_id) where staff_id is not null;

comment on column public.tasks.staff_id is
  'Исполнитель-сотрудник (staff.id); NULL — задача оператора или без исполнителя.';
