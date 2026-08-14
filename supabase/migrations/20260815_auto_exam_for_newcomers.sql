-- Автоматическая аттестация новичка.
--
-- Экзамен новому оператору назначают руками, а значит забывают ровно тогда,
-- когда он важнее всего — в первые недели. Здесь настройки на организацию и
-- отметка на операторе, чтобы не собрать ему второй экзамен на следующий день.

alter table public.organizations
  add column if not exists auto_exam_enabled boolean not null default false,
  add column if not exists auto_exam_days smallint not null default 7,
  add column if not exists auto_exam_questions smallint not null default 10,
  add column if not exists auto_exam_open smallint not null default 2,
  add column if not exists auto_exam_pass_score smallint not null default 70;

comment on column public.organizations.auto_exam_enabled is
  'Собирать ли новичку экзамен автоматически (черновик, рассылает владелец)';
comment on column public.organizations.auto_exam_days is
  'Через сколько дней после найма собирается экзамен';

alter table public.operators
  add column if not exists auto_exam_created_at timestamptz;

comment on column public.operators.auto_exam_created_at is
  'Когда для оператора собрали автоматический экзамен новичка';
