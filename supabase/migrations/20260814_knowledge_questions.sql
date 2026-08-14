-- Вопросы сотрудников по правилам.
--
-- Оператор нажимает «Объясни проще» и может спросить своими словами. Сам ответ
-- ему выдаёт модель, а вопрос остаётся здесь: это единственный честный сигнал
-- владельцу, какое правило написано непонятно. Без таблицы функция работает —
-- запись обёрнута в try/catch (lib/server/knowledge-explain.ts).

create table if not exists public.knowledge_questions (
  id              uuid primary key default gen_random_uuid(),
  article_id      uuid not null references public.knowledge_articles(id) on delete cascade,
  question        text,
  answer          text not null,
  staff_id        uuid,
  operator_id     uuid,
  company_id      uuid,
  organization_id uuid,
  created_at      timestamptz not null default now()
);

comment on table public.knowledge_questions is 'Вопросы операторов по статьям базы знаний и ответы ИИ';

create index if not exists knowledge_questions_article_idx
  on public.knowledge_questions (article_id, created_at desc);
create index if not exists knowledge_questions_org_idx
  on public.knowledge_questions (organization_id, created_at desc);

alter table public.knowledge_questions enable row level security;

-- Пишет и читает только service-role API: вопросы видны владельцу через
-- админский эндпоинт, напрямую клиентам таблица не нужна.
