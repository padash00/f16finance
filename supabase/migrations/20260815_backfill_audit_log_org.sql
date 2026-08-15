-- Добивка журнала действий: организация для оставшихся записей.
--
-- После 20260815_backfill_organization_ids в audit_log осталось ~44.6 тыс. строк
-- без организации. Две причины:
--   • у события нет точки в payload (вход, просмотр страницы, обращение к ИИ);
--   • автор события не заведён в organization_members (связь с сотрудником идёт
--     через email, а не через членство в организации).
--
-- Три шага, от точного к общему. Идемпотентна.

-- ── Шаг 1: организация сотрудника по почте ─────────────────────────────────
-- resolveStaffByUser (lib/server/admin.ts) сопоставляет пользователя с сотрудником
-- по email — повторяем ту же связь.
do $$
declare
  moved bigint;
begin
  update public.audit_log a
     set organization_id = s.organization_id
    from auth.users u
    join public.staff s
      on lower(s.email) = lower(u.email)
   where a.organization_id is null
     and a.actor_user_id = u.id
     and s.organization_id is not null;
  get diagnostics moved = row_count;
  raise notice 'Шаг 1: по сотруднику (почта), строк: %', moved;
end $$;

-- ── Шаг 2: организация оператора ───────────────────────────────────────────
-- Операторы входят через operator_auth, где хранится ссылка на пользователя.
do $$
declare
  moved bigint := 0;
begin
  if to_regclass('public.operator_auth') is null then
    raise notice 'Шаг 2 пропущен: operator_auth нет';
    return;
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'operator_auth' and column_name = 'user_id'
  ) then
    raise notice 'Шаг 2 пропущен: в operator_auth нет user_id';
    return;
  end if;

  execute $sql$
    update public.audit_log a
       set organization_id = o.organization_id
      from public.operator_auth oa
      join public.operators o on o.id = oa.operator_id
     where a.organization_id is null
       and a.actor_user_id = oa.user_id
       and o.organization_id is not null
  $sql$;
  get diagnostics moved = row_count;
  raise notice 'Шаг 2: по оператору, строк: %', moved;
end $$;

-- ── Шаг 3: всё, что старше второго клиента, — домашней организации ─────────
-- События, записанные до появления второй организации, физически не могли
-- принадлежать никому, кроме первой: других клиентов тогда в системе не было.
-- Всё, что позже, не трогаем — там угадывать нельзя.
do $$
declare
  home_org uuid;
  boundary timestamptz;
  moved bigint;
begin
  select id into home_org from public.organizations order by created_at limit 1;
  if home_org is null then
    raise notice 'Шаг 3 пропущен: организаций нет';
    return;
  end if;

  select min(created_at) into boundary
    from public.organizations
   where id <> home_org;

  update public.audit_log
     set organization_id = home_org
   where organization_id is null
     and (boundary is null or created_at < boundary);
  get diagnostics moved = row_count;

  raise notice 'Шаг 3: отнесено домашней организации, строк: % (граница: %)',
    moved, coalesce(boundary::text, 'второй организации нет — вся история');
end $$;

-- ── Что осталось ───────────────────────────────────────────────────────────
do $$
declare
  rest bigint;
begin
  select count(*) into rest from public.audit_log where organization_id is null;
  raise notice 'Осталось без организации: % строк(и)', rest;
end $$;
