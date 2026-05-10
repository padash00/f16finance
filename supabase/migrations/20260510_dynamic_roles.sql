-- =====================================================================
-- Динамические роли — справочник ролей (Коммит 1, аддитивный).
--
-- Цель: убрать STAFF_ROLE_MATRIX (lib/core/access.ts) из кода и хранить
-- лейбл/home/paths каждой роли в БД, чтобы super-admin мог через UI
-- создавать кастомные роли.
--
-- На этом коммите СТАРЫЙ КОД НЕ ТРОГАЕТСЯ — STAFF_ROLE_MATRIX остаётся
-- как fallback. Этот шаг только готовит БД и сидит её текущими данными.
-- =====================================================================

-- 1) Справочник ролей
create table if not exists roles (
  code         text primary key,
  label        text not null,
  home_path    text not null default '/welcome',
  summary      text,
  sort_order   int  not null default 100,
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table roles is
  'Справочник staff-ролей. Системные (is_system=true) нельзя удалять.';

-- 2) Видимые пути per роль (для сайдбара и middleware)
create table if not exists role_paths (
  role  text not null references roles(code) on delete cascade,
  path  text not null,
  primary key (role, path)
);

comment on table role_paths is
  'Какие /url доступны роли. Заменяет MANAGER_PATHS/OWNER_PATHS из кода.';

create index if not exists role_paths_role_idx on role_paths(role);

-- 3) Сидим текущие 4 системные роли (label/home/summary из STAFF_ROLE_MATRIX)
insert into roles (code, label, home_path, summary, sort_order, is_system) values
  ('owner',    'Владелец',     '/welcome',      'Имеет управленческий доступ к деньгам, команде, операционной работе и аналитике операторов без системного администрирования.', 10, true),
  ('manager',  'Руководитель', '/welcome',      'Контролирует задачи, смены, зарплату и назначает операторов по точкам. Может добавлять доходы и расходы.',                  20, true),
  ('marketer', 'Маркетолог',   '/welcome',      'Работает только в контуре задач и не видит операционные и финансовые разделы.',                                              30, true),
  ('other',    'Сотрудник',    '/unauthorized', 'Техническая роль без доступа к staff-контуру.',                                                                              90, true)
on conflict (code) do nothing;

-- 4) Сидим role_paths из *_PATHS массивов lib/core/access.ts
-- MANAGER_PATHS
insert into role_paths (role, path) values
  ('manager', '/dashboard'),
  ('manager', '/welcome'),
  ('manager', '/tasks'),
  ('manager', '/income'),
  ('manager', '/income/add'),
  ('manager', '/income/analytics'),
  ('manager', '/shift-telegram-audit'),
  ('manager', '/analytics'),
  ('manager', '/expenses'),
  ('manager', '/expenses/add'),
  ('manager', '/expenses/new'),
  ('manager', '/expenses/pending'),
  ('manager', '/expenses/analysis'),
  ('manager', '/expense-whitelist'),
  ('manager', '/cashflow'),
  ('manager', '/forecast'),
  ('manager', '/ratings'),
  ('manager', '/goals'),
  ('manager', '/birthdays'),
  ('manager', '/weekly-report'),
  ('manager', '/profitability'),
  ('manager', '/reports'),
  ('manager', '/analysis'),
  ('manager', '/structure'),
  ('manager', '/operators'),
  ('manager', '/operators/*'),
  ('manager', '/shifts'),
  ('manager', '/shifts/*'),
  ('manager', '/salary'),
  ('manager', '/salary/*'),
  ('manager', '/point-debts'),
  ('manager', '/categories'),
  ('manager', '/inventory'),
  ('manager', '/inventory/*'),
  ('manager', '/store'),
  ('manager', '/store/*'),
  ('manager', '/tax'),
  ('manager', '/kpi'),
  ('manager', '/kpi/*')
on conflict do nothing;

-- MARKETER_PATHS
insert into role_paths (role, path) values
  ('marketer', '/welcome'),
  ('marketer', '/tasks')
on conflict do nothing;

-- OWNER_PATHS
insert into role_paths (role, path) values
  ('owner', '/dashboard'),
  ('owner', '/welcome'),
  ('owner', '/point-devices'),
  ('owner', '/income'),
  ('owner', '/income/add'),
  ('owner', '/income/analytics'),
  ('owner', '/shift-telegram-audit'),
  ('owner', '/analytics'),
  ('owner', '/expenses'),
  ('owner', '/expenses/add'),
  ('owner', '/expenses/new'),
  ('owner', '/expenses/pending'),
  ('owner', '/expenses/analysis'),
  ('owner', '/expense-whitelist'),
  ('owner', '/cashflow'),
  ('owner', '/forecast'),
  ('owner', '/ratings'),
  ('owner', '/categories'),
  ('owner', '/inventory'),
  ('owner', '/inventory/*'),
  ('owner', '/store'),
  ('owner', '/store/*'),
  ('owner', '/tax'),
  ('owner', '/profitability'),
  ('owner', '/goals'),
  ('owner', '/reports'),
  ('owner', '/analysis'),
  ('owner', '/birthdays'),
  ('owner', '/weekly-report'),
  ('owner', '/structure'),
  ('owner', '/salary'),
  ('owner', '/salary/*'),
  ('owner', '/salary/rules'),
  ('owner', '/point-debts'),
  ('owner', '/operators'),
  ('owner', '/operators/*'),
  ('owner', '/operator-analytics'),
  ('owner', '/staff'),
  ('owner', '/hr'),
  ('owner', '/kpi'),
  ('owner', '/kpi/*'),
  ('owner', '/tasks'),
  ('owner', '/shifts'),
  ('owner', '/shifts/*'),
  ('owner', '/knowledge-admin')
on conflict do nothing;

-- 5) Sanity-check: количество строк должно совпасть с массивами в коде
do $$
declare
  manager_count int;
  marketer_count int;
  owner_count int;
begin
  select count(*) into manager_count  from role_paths where role = 'manager';
  select count(*) into marketer_count from role_paths where role = 'marketer';
  select count(*) into owner_count    from role_paths where role = 'owner';

  if manager_count <> 39 then
    raise exception 'role_paths sanity: ожидалось 39 для manager, получено %', manager_count;
  end if;
  if marketer_count <> 2 then
    raise exception 'role_paths sanity: ожидалось 2 для marketer, получено %', marketer_count;
  end if;
  if owner_count <> 45 then
    raise exception 'role_paths sanity: ожидалось 45 для owner, получено %', owner_count;
  end if;

  raise notice 'role_paths seeded: manager=%, marketer=%, owner=%', manager_count, marketer_count, owner_count;
end $$;

-- 6) RLS — пока read-only для всех залогиненных, write только service_role
alter table roles enable row level security;
alter table role_paths enable row level security;

drop policy if exists "roles read all" on roles;
create policy "roles read all" on roles for select using (true);

drop policy if exists "role_paths read all" on role_paths;
create policy "role_paths read all" on role_paths for select using (true);
