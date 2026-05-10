-- =====================================================================
-- Консолидация ролей: positions становится единственным источником правды.
-- Дропаем мою параллельную систему roles/role_paths из Коммита 1,
-- расширяем positions данными которые там были (label, home_path, ...),
-- создаём position_paths для динамических путей.
-- =====================================================================

-- 1) Дропаем мусор из Коммита 1
drop table if exists role_paths;
drop table if exists roles;

-- 2) Расширяем positions
alter table positions
  add column if not exists label      text,
  add column if not exists home_path  text,
  add column if not exists summary    text,
  add column if not exists sort_order int not null default 100;

-- 3) Бекфилл label/home_path/summary для системных ролей
update positions set
  label      = 'Владелец',
  home_path  = '/welcome',
  summary    = 'Имеет управленческий доступ к деньгам, команде, операционной работе и аналитике операторов без системного администрирования.',
  sort_order = 10
where name = 'owner' and is_builtin = true;

update positions set
  label      = 'Руководитель',
  home_path  = '/welcome',
  summary    = 'Контролирует задачи, смены, зарплату и назначает операторов по точкам. Может добавлять доходы и расходы.',
  sort_order = 20
where name = 'manager' and is_builtin = true;

update positions set
  label      = 'Маркетолог',
  home_path  = '/welcome',
  summary    = 'Работает только в контуре задач и не видит операционные и финансовые разделы.',
  sort_order = 30
where name = 'marketer' and is_builtin = true;

-- 'other' — техническая роль, может не быть в positions. Создадим если её нет.
insert into positions (name, description, is_builtin, label, home_path, summary, sort_order)
values ('other', 'Техническая роль без доступа к staff-контуру', true, 'Сотрудник', '/unauthorized', 'Техническая роль без доступа к staff-контуру.', 90)
on conflict (name) do update set
  label      = excluded.label,
  home_path  = excluded.home_path,
  summary    = excluded.summary,
  sort_order = excluded.sort_order
where positions.is_builtin = true;

-- На случай если в БД label остался null (например для кастомных ролей до миграции) — fallback на name
update positions set label = name where label is null;
update positions set home_path = '/welcome' where home_path is null;

-- 4) Создаём связь position → пути
create table if not exists position_paths (
  position_name text not null references positions(name) on update cascade on delete cascade,
  path          text not null,
  primary key (position_name, path)
);

create index if not exists position_paths_name_idx on position_paths(position_name);

-- 5) Сидим position_paths из MANAGER_PATHS / MARKETER_PATHS / OWNER_PATHS
-- (источник: lib/core/access.ts)

insert into position_paths (position_name, path) values
  ('manager','/dashboard'),
  ('manager','/welcome'),
  ('manager','/tasks'),
  ('manager','/income'),
  ('manager','/income/add'),
  ('manager','/income/analytics'),
  ('manager','/shift-telegram-audit'),
  ('manager','/analytics'),
  ('manager','/expenses'),
  ('manager','/expenses/add'),
  ('manager','/expenses/new'),
  ('manager','/expenses/pending'),
  ('manager','/expenses/analysis'),
  ('manager','/expense-whitelist'),
  ('manager','/cashflow'),
  ('manager','/forecast'),
  ('manager','/ratings'),
  ('manager','/goals'),
  ('manager','/birthdays'),
  ('manager','/weekly-report'),
  ('manager','/profitability'),
  ('manager','/reports'),
  ('manager','/analysis'),
  ('manager','/structure'),
  ('manager','/operators'),
  ('manager','/operators/*'),
  ('manager','/shifts'),
  ('manager','/shifts/*'),
  ('manager','/salary'),
  ('manager','/salary/*'),
  ('manager','/point-debts'),
  ('manager','/categories'),
  ('manager','/inventory'),
  ('manager','/inventory/*'),
  ('manager','/store'),
  ('manager','/store/*'),
  ('manager','/tax'),
  ('manager','/kpi'),
  ('manager','/kpi/*')
on conflict do nothing;

insert into position_paths (position_name, path) values
  ('marketer','/welcome'),
  ('marketer','/tasks')
on conflict do nothing;

insert into position_paths (position_name, path) values
  ('owner','/dashboard'),
  ('owner','/welcome'),
  ('owner','/point-devices'),
  ('owner','/income'),
  ('owner','/income/add'),
  ('owner','/income/analytics'),
  ('owner','/shift-telegram-audit'),
  ('owner','/analytics'),
  ('owner','/expenses'),
  ('owner','/expenses/add'),
  ('owner','/expenses/new'),
  ('owner','/expenses/pending'),
  ('owner','/expenses/analysis'),
  ('owner','/expense-whitelist'),
  ('owner','/cashflow'),
  ('owner','/forecast'),
  ('owner','/ratings'),
  ('owner','/categories'),
  ('owner','/inventory'),
  ('owner','/inventory/*'),
  ('owner','/store'),
  ('owner','/store/*'),
  ('owner','/tax'),
  ('owner','/profitability'),
  ('owner','/goals'),
  ('owner','/reports'),
  ('owner','/analysis'),
  ('owner','/birthdays'),
  ('owner','/weekly-report'),
  ('owner','/structure'),
  ('owner','/salary'),
  ('owner','/salary/*'),
  ('owner','/salary/rules'),
  ('owner','/point-debts'),
  ('owner','/operators'),
  ('owner','/operators/*'),
  ('owner','/operator-analytics'),
  ('owner','/staff'),
  ('owner','/hr'),
  ('owner','/kpi'),
  ('owner','/kpi/*'),
  ('owner','/tasks'),
  ('owner','/shifts'),
  ('owner','/shifts/*'),
  ('owner','/knowledge-admin')
on conflict do nothing;

-- 6) Sanity-check
do $$
declare
  manager_paths_count int;
  marketer_paths_count int;
  owner_paths_count int;
  positions_with_label int;
begin
  select count(*) into manager_paths_count  from position_paths where position_name = 'manager';
  select count(*) into marketer_paths_count from position_paths where position_name = 'marketer';
  select count(*) into owner_paths_count    from position_paths where position_name = 'owner';
  select count(*) into positions_with_label from positions where label is not null;

  if manager_paths_count <> 39 then
    raise exception 'sanity: ожидалось 39 paths для manager, получено %', manager_paths_count;
  end if;
  if marketer_paths_count <> 2 then
    raise exception 'sanity: ожидалось 2 paths для marketer, получено %', marketer_paths_count;
  end if;
  if owner_paths_count <> 45 then
    raise exception 'sanity: ожидалось 45 paths для owner, получено %', owner_paths_count;
  end if;

  raise notice 'consolidation ok: positions_with_label=%, paths(manager=%, marketer=%, owner=%)',
    positions_with_label, manager_paths_count, marketer_paths_count, owner_paths_count;
end $$;

-- 7) RLS — read-only для всех
alter table position_paths enable row level security;

drop policy if exists "position_paths read all" on position_paths;
create policy "position_paths read all" on position_paths for select using (true);
