-- Журнал действий: добивка двух типов, которые прошлый бэкфилл не тронул.
--
-- После 20260815_backfill_audit_log_entities без организации осталось ~18 тыс.
-- строк. Основная часть — намеренный технический шум (system-error, page-view,
-- auth-attempt, operator-chat, auth-user), он к клиентам не относится.
--
-- Но два типа остались там по ошибке:
--
--   * point-device (~1.9 тыс.). Прошлая миграция искала entity_id в
--     public.point_devices. На самом деле события пишет /api/point/bootstrap,
--     а он работает с point_projects — значит в entity_id лежит id ПРОЕКТА
--     точки, а не устройства, и join не находил ничего. Организация
--     восстанавливается через point_project_companies → companies.
--
--   * checklist_run (~1.8 тыс.). У checklist_runs нет колонки company_id, и
--     прошлая миграция честно пропустила этот тип по guard'у «нет колонки».
--     Точка достаётся через смену (shift_id → point_shifts), а если смены нет —
--     через шаблон чек-листа.
--
-- Осторожность: организация проставляется, только когда она определяется
-- ОДНОЗНАЧНО. Проект, растянутый на компании разных организаций, пропускается —
-- в базе больше одного реального клиента, и угадывать тут нельзя.
--
-- Идемпотентна: трогает только строки с пустой организацией.

-- ── point-device: entity_id = point_projects.id ────────────────────────────
do $$
declare
  moved bigint := 0;
begin
  if to_regclass('public.point_project_companies') is null then
    raise notice 'point-device пропущен: нет таблицы point_project_companies';
    return;
  end if;

  -- min(uuid) в Postgres не существует — сравниваем через text и приводим
  -- обратно. Та же грабля, что чинилась в 067003a8.
  update public.audit_log a
     set organization_id = x.organization_id
    from (
      select ppc.project_id,
             (min(c.organization_id::text))::uuid as organization_id
        from public.point_project_companies ppc
        join public.companies c on c.id = ppc.company_id
       where c.organization_id is not null
       group by ppc.project_id
      having count(distinct c.organization_id) = 1
    ) x
   where a.organization_id is null
     and a.entity_type = 'point-device'
     and a.entity_id = x.project_id::text;

  get diagnostics moved = row_count;
  raise notice 'point-device по проекту точки: % строк(и)', moved;
end $$;

-- ── checklist_run: через смену ─────────────────────────────────────────────
do $$
declare
  moved bigint := 0;
begin
  if to_regclass('public.checklist_runs') is null or to_regclass('public.point_shifts') is null then
    raise notice 'checklist_run (смена) пропущен: нет таблиц';
    return;
  end if;

  update public.audit_log a
     set organization_id = coalesce(s.organization_id, c.organization_id)
    from public.checklist_runs r
    join public.point_shifts s on s.id = r.shift_id
    left join public.companies c on c.id = s.company_id
   where a.organization_id is null
     and a.entity_type = 'checklist_run'
     and a.entity_id = r.id::text
     and coalesce(s.organization_id, c.organization_id) is not null;

  get diagnostics moved = row_count;
  raise notice 'checklist_run по смене: % строк(и)', moved;
end $$;

-- ── checklist_run: запасной путь через шаблон ──────────────────────────────
-- Часть прогонов заводится вне смены (плановый чек-лист, ручной запуск).
do $$
declare
  moved bigint := 0;
begin
  if to_regclass('public.checklist_templates') is null then
    raise notice 'checklist_run (шаблон) пропущен: нет таблицы checklist_templates';
    return;
  end if;

  update public.audit_log a
     set organization_id = coalesce(t.organization_id, c.organization_id)
    from public.checklist_runs r
    join public.checklist_templates t on t.id = r.template_id
    left join public.companies c on c.id = t.company_id
   where a.organization_id is null
     and a.entity_type = 'checklist_run'
     and a.entity_id = r.id::text
     and coalesce(t.organization_id, c.organization_id) is not null;

  get diagnostics moved = row_count;
  raise notice 'checklist_run по шаблону: % строк(и)', moved;
end $$;

-- ── Что осталось и почему ──────────────────────────────────────────────────
do $$
declare
  rest bigint;
  noise bigint;
  meaningful bigint;
begin
  select count(*) into rest
    from public.audit_log where organization_id is null;

  select count(*) into noise
    from public.audit_log
   where organization_id is null
     and entity_type in ('system-error', 'page-view', 'auth-attempt',
                         'operator-chat', 'auth-user', 'auth-session');

  meaningful := rest - noise;

  raise notice 'Осталось без организации: %, технический шум: %, содержательных: %',
    rest, noise, meaningful;
  raise notice 'Содержательный остаток — записи об удалённых объектах: восстановить организацию не по чему.';
end $$;
