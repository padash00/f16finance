-- ─────────────────────────────────────────────────────────────────────────
-- Черновик экзамена: сначала посмотреть вопросы, потом рассылать.
-- ─────────────────────────────────────────────────────────────────────────
-- До этого билет генерился и сразу улетал операторам. Если ИИ выдал кривой
-- вопрос, узнаёшь об этом от семи человек постфактум, и экзамен уже испорчен.
--
-- Теперь создание даёт ЧЕРНОВИК: пул вопросов лежит в самом экзамене, владелец
-- читает его, выкидывает неудачные, и только потом жмёт «Разослать».
-- ─────────────────────────────────────────────────────────────────────────

alter table operator_exams
  -- Сгенерированные вопросы до рассылки. После рассылки остаются как след:
  -- по ним видно, из чего собирались личные билеты.
  add column if not exists question_pool jsonb not null default '[]'::jsonb,
  add column if not exists open_pool jsonb not null default '[]'::jsonb,
  -- Кого экзаменуем — выбрано при создании, применяется при рассылке.
  add column if not exists operator_ids uuid[] not null default '{}',
  add column if not exists sent_at timestamptz;

alter table operator_exams drop constraint if exists operator_exams_status_check;
alter table operator_exams add constraint operator_exams_status_check
  check (status in ('draft', 'active', 'finished', 'cancelled'));

comment on column operator_exams.question_pool is
  'Пул тестовых вопросов экзамена. Личные билеты собираются из него при рассылке';

notify pgrst, 'reload schema';
