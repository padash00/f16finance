-- ─────────────────────────────────────────────────────────────────────────
-- Регулярные экзамены: расписание вместо ручного назначения.
-- ─────────────────────────────────────────────────────────────────────────
-- Экзамен назначают руками и поэтому назначают редко. Регулярная проверка
-- знаний работает только тогда, когда она случается сама.
--
-- Расписание принадлежит ТОЧКЕ, а не организации: у одного владельца
-- одновременно клуб, PS-клуб и магазин, и спрашивать с них надо разное.
-- Состав билета берётся из ниши точки (companies.industry) — темы по данным
-- у каждой ниши свои: у магазина каталог и склад, у клуба тарифы и железо.
--
-- Крон собирает ЧЕРНОВИК и зовёт владельца проверить. Не рассылку: вопросы
-- пишет модель, и кривой вопрос дешевле выкинуть до отправки, чем объясняться
-- перед семью людьми. Тот же принцип, что у аттестации новичков.

create table if not exists public.operator_exam_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,

  title text not null default 'Еженедельная проверка',
  is_active boolean not null default true,

  -- День недели сборки черновика: 1 — понедельник, 7 — воскресенье.
  -- По умолчанию воскресенье: черновик готов до начала рабочей недели.
  weekday smallint not null default 7 check (weekday between 1 and 7),

  question_count smallint not null default 10 check (question_count between 3 and 20),
  open_count smallint not null default 2 check (open_count between 0 and 5),
  pass_score smallint not null default 70 check (pass_score between 1 and 100),

  -- Сколько дней даётся на сдачу с момента рассылки.
  deadline_days smallint not null default 4 check (deadline_days between 1 and 14),

  -- Темы вопросов по данным точки. Пусто — берутся из ниши.
  fact_topics text[] not null default '{}',

  -- Когда крон в последний раз собирал по этому расписанию. Защита от
  -- повторной сборки: крон может сработать дважды за день.
  last_run_on date null,

  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Одно расписание на точку: два еженедельных экзамена подряд — это не
  -- проверка знаний, а наказание.
  constraint operator_exam_schedules_uniq unique (company_id)
);

create index if not exists idx_operator_exam_schedules_org
  on public.operator_exam_schedules (organization_id);

create index if not exists idx_operator_exam_schedules_due
  on public.operator_exam_schedules (weekday)
  where is_active;

alter table public.operator_exam_schedules enable row level security;

-- Ходит только service-role API: расписание правит владелец через админку,
-- напрямую клиентам таблица не нужна.
drop policy if exists operator_exam_schedules_service on public.operator_exam_schedules;
create policy operator_exam_schedules_service on public.operator_exam_schedules
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

comment on table public.operator_exam_schedules is
  'Регулярные экзамены по точкам. Крон собирает черновик, рассылает человек.';
