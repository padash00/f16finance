-- Legacy-колонки в kpi_plans (entity_type, plan_key, month_start) могут
-- молча отрезаться PostgREST'ом из INSERT-payload, если их нет в schema
-- cache. После этого PostgreSQL фейлится на NOT NULL. Чтобы это лечить:
--
--   1) NOTIFY pgrst, 'reload schema' — перезагружаем кэш PostgREST.
--   2) ALTER COLUMN ... SET DEFAULT — если payload всё-таки пришёл без
--      колонки, PostgreSQL подставит дефолт и INSERT пройдёт.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'kpi_plans'
      and column_name = 'entity_type'
  ) then
    alter table public.kpi_plans alter column entity_type set default 'kpi_plan';
    -- Заполним существующие NULL-строки (если есть) дефолтом
    update public.kpi_plans set entity_type = 'kpi_plan' where entity_type is null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'kpi_plans'
      and column_name = 'month_start'
  ) then
    -- month_start всегда совпадает с period_start — поставим дефолт CURRENT_DATE
    -- и заполним пустые на основе period_start (если он есть)
    alter table public.kpi_plans alter column month_start set default current_date;
    update public.kpi_plans
    set month_start = period_start
    where month_start is null and period_start is not null;
  end if;
end $$;

notify pgrst, 'reload schema';
