-- ─────────────────────────────────────────────────────────────────────────
-- Фаза 2 экзаменов: ситуационные вопросы со свободным ответом и AI-оценкой.
-- ─────────────────────────────────────────────────────────────────────────
-- Тесты с вариантами не проверяют главное — «как разговаривать» и «что делать
-- в конфликте». Такие вопросы требуют развёрнутого ответа, а он оценивается
-- по рубрике, а не сравнением индекса.
--
-- Оценка ИИ — предложение, а не приговор: владелец может переставить балл
-- (manual_override). Без этого первый же спорный случай убьёт доверие ко всей
-- аттестации.
-- ─────────────────────────────────────────────────────────────────────────

alter table operator_exams
  add column if not exists open_count smallint not null default 0;

comment on column operator_exams.open_count is
  'Сколько ситуационных вопросов со свободным ответом добавлено к тестовым';

alter table operator_exam_attempts
  -- Сумма максимальных баллов билета: у теста 1, у ситуационного — max_score
  -- вопроса. Итог считается как доля от неё, а не от числа вопросов.
  add column if not exists max_score smallint,
  add column if not exists manual_override boolean not null default false,
  add column if not exists graded_by uuid,
  add column if not exists graded_at timestamptz;

comment on column operator_exam_attempts.manual_override is
  'Владелец вручную переставил балл хотя бы за один ответ';

notify pgrst, 'reload schema';
