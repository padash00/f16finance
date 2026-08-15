-- Журнал действий: организация по объекту события.
--
-- У части записей автора нет вообще (кроны, устройства точки, фоновые задачи),
-- зато есть entity_id — ссылка на конкретный объект. По нему организация
-- восстанавливается точно, без догадок. Это важно, потому что в базе уже больше
-- одного реального клиента, и «отнести всё старое первой организации» нельзя.
--
-- Технический шум (system-error, page-view, auth-attempt, operator-chat,
-- auth-user) намеренно остаётся без организации: он ни к какому клиенту не
-- относится, в журнале скрыт строгим фильтром и в Telegram не уходит.
--
-- Идемпотентна: трогает только строки с пустой организацией.

-- ── Объекты, у которых есть точка ──────────────────────────────────────────
do $$
declare
  link text[];
  moved bigint;
  links constant text[][] := array[
    array['checklist_run', 'checklist_runs'],
    array['point-device', 'point_devices'],
    array['point-shift', 'point_shifts'],
    array['point-sale', 'point_sales']
  ];
begin
  foreach link slice 1 in array links loop
    continue when to_regclass('public.' || link[2]) is null;
    continue when not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = link[2] and column_name = 'company_id'
    );

    execute format(
      'update public.audit_log a
          set organization_id = c.organization_id
         from public.%I src
         join public.companies c on c.id = src.company_id
        where a.organization_id is null
          and a.entity_type = %L
          and a.entity_id = src.id::text
          and c.organization_id is not null',
      link[2], link[1]
    );
    get diagnostics moved = row_count;
    if moved > 0 then
      raise notice 'по объекту %: % строк(и)', link[1], moved;
    end if;
  end loop;
end $$;

-- ── Объекты, привязанные к сотруднику ──────────────────────────────────────
do $$
declare
  link text[];
  moved bigint;
  links constant text[][] := array[
    array['staff-payment', 'staff_salary_payments'],
    array['staff-adjustment', 'staff_adjustments'],
    array['staff-debt-payment', 'staff_debt_payments']
  ];
begin
  foreach link slice 1 in array links loop
    continue when to_regclass('public.' || link[2]) is null;
    continue when not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = link[2] and column_name = 'staff_id'
    );

    execute format(
      'update public.audit_log a
          set organization_id = s.organization_id
         from public.%I src
         join public.staff s on s.id = src.staff_id
        where a.organization_id is null
          and a.entity_type = %L
          and a.entity_id = src.id::text
          and s.organization_id is not null',
      link[2], link[1]
    );
    get diagnostics moved = row_count;
    if moved > 0 then
      raise notice 'по сотруднику %: % строк(и)', link[1], moved;
    end if;
  end loop;
end $$;

-- ── Вход оператора на точке: entity_id = operator_auth.id ──────────────────
do $$
declare
  moved bigint;
begin
  if to_regclass('public.operator_auth') is null then
    raise notice 'operator_auth нет — шаг пропущен';
    return;
  end if;

  update public.audit_log a
     set organization_id = o.organization_id
    from public.operator_auth oa
    join public.operators o on o.id = oa.operator_id
   where a.organization_id is null
     and a.entity_type = 'point-login'
     and a.entity_id = oa.id::text
     and o.organization_id is not null;
  get diagnostics moved = row_count;
  raise notice 'вход оператора: % строк(и)', moved;
end $$;

-- ── Что осталось и почему ──────────────────────────────────────────────────
do $$
declare
  rest bigint;
  noise bigint;
begin
  select count(*) into rest from public.audit_log where organization_id is null;
  select count(*) into noise from public.audit_log
   where organization_id is null
     and entity_type in ('system-error', 'page-view', 'auth-attempt', 'operator-chat', 'auth-user');
  raise notice 'Осталось без организации: % строк(и), из них технический шум: %', rest, noise;
end $$;
