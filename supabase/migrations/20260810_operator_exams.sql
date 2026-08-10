-- ─────────────────────────────────────────────────────────────────────────
-- Экзамены операторов (аттестация по стандартам точки).
-- ─────────────────────────────────────────────────────────────────────────
-- Владелец назначает экзамен: выбирает точки → ИИ собирает билет из статей
-- базы знаний ЭТИХ точек (knowledge_articles.company_id) → бот шлёт вопросы
-- в Telegram → оператор отвечает кнопками → автопроверка и сводка.
--
-- Почему не переиспользуем knowledge_quiz_attempts: там самопроверка, которую
-- оператор запускает сам со своей кассы, без назначения, дедлайна, привязки к
-- точкам и без состояния диалога (какой вопрос сейчас показан в чате).
--
-- Фаза 1 — только вопросы с вариантами: проверка сводится к сравнению индекса,
-- спорить об оценке не о чем. Ситуационные вопросы с AI-оценкой — отдельно.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists operator_exams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  -- Точки, по стандартам которых собран билет. Массив, а не FK: экзамен может
  -- накрывать несколько точек сразу («общие правила сети»).
  company_ids uuid[] not null default '{}',
  question_count smallint not null default 10,
  pass_score smallint not null default 70,
  deadline_at timestamptz,
  status text not null default 'active' check (status in ('active', 'finished', 'cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists operator_exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references operator_exams(id) on delete cascade,
  -- Дублируем организацию: по попыткам ходят напрямую (роутинг ответа из чата),
  -- и скоуп не должен зависеть от join'а с экзаменом.
  organization_id uuid not null,
  operator_id uuid not null,
  -- Снимок chat_id на момент рассылки: если оператор сменит телеграм, начатый
  -- экзамен продолжит приходить туда, куда ушёл первый вопрос.
  telegram_chat_id text,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'in_progress', 'completed', 'expired', 'undeliverable')),
  -- [{ article_id, company_id, q, choices[4], correct }] — correct наружу не отдаём.
  questions jsonb not null default '[]'::jsonb,
  -- { "0": 2, "1": 0, ... } — индекс вопроса → индекс выбранного варианта.
  answers jsonb not null default '{}'::jsonb,
  current_index smallint not null default 0,
  total_questions smallint not null default 0,
  correct_answers smallint not null default 0,
  score smallint,
  passed boolean,
  delivery_error text,
  sent_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Один экзамен — одна попытка на оператора. Пересдача = новый экзамен.
  unique (exam_id, operator_id)
);

create index if not exists idx_operator_exams_org on operator_exams (organization_id, created_at desc);
create index if not exists idx_operator_exam_attempts_exam on operator_exam_attempts (exam_id);
create index if not exists idx_operator_exam_attempts_operator on operator_exam_attempts (operator_id);
-- Роутинг входящего ответа из Telegram: ищем незавершённую попытку этого чата.
create index if not exists idx_operator_exam_attempts_chat
  on operator_exam_attempts (telegram_chat_id)
  where status in ('sent', 'in_progress');

alter table operator_exams enable row level security;
alter table operator_exam_attempts enable row level security;

-- Только service_role: в попытках лежат ФИО-привязанные результаты аттестации.
-- Читающей политики для authenticated намеренно нет — весь доступ идёт через
-- API под admin-клиентом, который сам режет по организации.
drop policy if exists "service_role full access operator_exams" on operator_exams;
create policy "service_role full access operator_exams" on operator_exams
  to service_role
  using (true) with check (true);

drop policy if exists "service_role full access operator_exam_attempts" on operator_exam_attempts;
create policy "service_role full access operator_exam_attempts" on operator_exam_attempts
  to service_role
  using (true) with check (true);

create or replace function touch_operator_exams_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_operator_exams_updated_at on operator_exams;
create trigger trg_operator_exams_updated_at
  before update on operator_exams
  for each row execute function touch_operator_exams_updated_at();

drop trigger if exists trg_operator_exam_attempts_updated_at on operator_exam_attempts;
create trigger trg_operator_exam_attempts_updated_at
  before update on operator_exam_attempts
  for each row execute function touch_operator_exams_updated_at();

-- Доступ к странице. Рантайм берёт список URL роли из position_paths
-- (fail-closed): без этой строки владелец получит «нет доступа» на /operator-exams.
-- Остальным ролям путь выдаёт владелец сам на /access — новая страница не должна
-- открываться людям молча.
insert into position_paths (position_name, path)
values ('owner', '/operator-exams')
on conflict (position_name, path) do nothing;

notify pgrst, 'reload schema';
