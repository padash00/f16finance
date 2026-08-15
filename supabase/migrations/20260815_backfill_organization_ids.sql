-- Бэкфилл organization_id по всей базе.
--
-- Зачем. Изоляция арендаторов раньше держалась на company_id, а фильтр по
-- организации во многих местах включался «если организация известна». Мы это
-- закрыли: теперь запросы фильтруют по organization_id всегда. Побочный эффект —
-- строки, у которых organization_id пустой (legacy: заведены до появления
-- организаций), перестанут быть видимыми вообще. Это касается статей регламента,
-- чек-листов, клиентов лояльности, журнала действий.
--
-- Что делает миграция:
--   Шаг 1 — везде, где у таблицы есть и company_id, и organization_id, тянет
--           организацию из companies. Работает при любом числе клиентов.
--   Шаг 2 — если в системе ровно ОДНА организация, оставшиеся пустые строки
--           тоже принадлежат ей (других владельцев просто нет). Шаблонные и
--           платформенные таблицы исключены: там NULL означает «общее для всех».
--
-- Идемпотентна: повторный запуск ничего не меняет.

-- ── Шаг 1: организация из точки ────────────────────────────────────────────
do $$
declare
  target record;
  moved bigint;
  total bigint := 0;
begin
  for target in
    select org_col.table_name
      from information_schema.columns org_col
      join information_schema.columns company_col
        on company_col.table_schema = org_col.table_schema
       and company_col.table_name = org_col.table_name
       and company_col.column_name = 'company_id'
     where org_col.table_schema = 'public'
       and org_col.column_name = 'organization_id'
       and org_col.table_name <> 'companies'
     order by org_col.table_name
  loop
    execute format(
      'update public.%I t
          set organization_id = c.organization_id
         from public.companies c
        where t.company_id = c.id
          and t.organization_id is null
          and c.organization_id is not null',
      target.table_name
    );
    get diagnostics moved = row_count;
    if moved > 0 then
      total := total + moved;
      raise notice 'organization_id проставлен: %.% строк(и)', target.table_name, moved;
    end if;
  end loop;
  raise notice 'Шаг 1 завершён, всего строк: %', total;
end $$;

-- ── Шаг 1б: журнал действий — организация по автору события ────────────────
-- У audit_log нет company_id: организация выводилась из payload, а у событий без
-- точки (вход, просмотр страницы, работа с ИИ) её взять неоткуда. Берём по
-- автору — но только если он состоит ровно в одной организации, иначе угадывать
-- нельзя.
do $$
declare
  moved bigint;
begin
  update public.audit_log a
     set organization_id = m.organization_id
    from (
      -- min()/max() для uuid в Postgres нет, поэтому берём первый элемент
      -- массива: строк тут ровно одна, это гарантирует having ниже.
      select user_id, (array_agg(distinct organization_id))[1] as organization_id
        from public.organization_members
       where user_id is not null
       group by user_id
      having count(distinct organization_id) = 1
    ) m
   where a.organization_id is null
     and a.actor_user_id = m.user_id;
  get diagnostics moved = row_count;
  raise notice 'Шаг 1б: журнал привязан по автору, строк: %', moved;
end $$;

-- ── Шаг 2: единственная организация забирает бесхозные строки ──────────────
do $$
declare
  org_count int;
  only_org uuid;
  target record;
  moved bigint;
  total bigint := 0;
  -- NULL здесь означает «общий шаблон / платформенная запись», а не «ничей».
  skip_tables text[] := array[
    'organizations',
    'positions',
    'position_paths',
    'subscription_plans',
    'subscription_packages',
    'package_features',
    'organization_capability_overrides',
    'role_capabilities',
    'user_capability_overrides',
    'telegram_allowed_users',
    'operator_salary_seniority_tiers',
    'holidays',
    'barcode_cache'
  ];
begin
  select count(*) into org_count from public.organizations;
  if org_count <> 1 then
    raise notice 'Организаций в системе: % — шаг 2 пропущен (не угадать владельца строк)', org_count;
    return;
  end if;

  select id into only_org from public.organizations limit 1;

  for target in
    select table_name
      from information_schema.columns
     where table_schema = 'public'
       and column_name = 'organization_id'
       and not (table_name = any(skip_tables))
     order by table_name
  loop
    execute format(
      'update public.%I set organization_id = $1 where organization_id is null',
      target.table_name
    ) using only_org;
    get diagnostics moved = row_count;
    if moved > 0 then
      total := total + moved;
      raise notice 'бесхозные строки переданы владельцу: %.% строк(и)', target.table_name, moved;
    end if;
  end loop;
  raise notice 'Шаг 2 завершён, всего строк: %', total;
end $$;
