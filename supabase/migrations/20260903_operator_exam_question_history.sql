-- ─────────────────────────────────────────────────────────────────────────
-- Память билетов: что этому человеку уже задавали.
-- ─────────────────────────────────────────────────────────────────────────
-- Еженедельный экзамен с повторяющимися вопросами за месяц превращается в
-- заучивание ответов, а потом в переписку в чате. Проверять он перестаёт, но
-- время у людей забирает — и это хуже, чем не проверять вовсе.
--
-- Вопросы по регламенту каждый раз пишет модель и они разные сами собой. А вот
-- вопросы по данным точки берутся из каталога и тарифов, и они повторяются
-- буквально: «сколько стоит рамен» будет одинаковым и в июле, и в августе.
-- Именно их и нужно помнить.
--
-- Хранится не сам вопрос, а его отпечаток: текст вопроса может быть длинным,
-- а сравнивать нужно только на совпадение. Текст всё же кладём рядом — иначе
-- через полгода невозможно понять, что означал отпечаток.

create table if not exists public.operator_exam_question_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operator_id uuid not null,

  -- sha256 от нормализованного текста вопроса.
  question_hash text not null,
  question_text text null,

  asked_on date not null default current_date,
  -- Ответил ли верно. null — экзамен ещё не завершён.
  was_correct boolean null,

  created_at timestamptz not null default now()
);

-- Основной запрос: «что задавали этому человеку за последние N недель».
create index if not exists idx_exam_history_operator
  on public.operator_exam_question_history (operator_id, asked_on desc);

create index if not exists idx_exam_history_hash
  on public.operator_exam_question_history (operator_id, question_hash);

alter table public.operator_exam_question_history enable row level security;

drop policy if exists operator_exam_question_history_service
  on public.operator_exam_question_history;
create policy operator_exam_question_history_service
  on public.operator_exam_question_history
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

comment on table public.operator_exam_question_history is
  'Какие вопросы уже задавали оператору. Нужна, чтобы билеты не повторялись.';
