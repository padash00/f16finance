-- В некоторых базах у kpi_plans есть legacy-колонка plan_key NOT NULL,
-- которой нет в актуальных миграциях. Из-за неё новый INSERT падает на
-- «null value in column plan_key of relation kpi_plans violates not-null
-- constraint». Делаем колонку nullable, чтобы новые планы можно было
-- сохранять — старые legacy-записи остаются с заполненным plan_key.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'kpi_plans'
      and column_name = 'plan_key'
      and is_nullable = 'NO'
  ) then
    alter table public.kpi_plans alter column plan_key drop not null;
  end if;
end $$;

notify pgrst, 'reload schema';
