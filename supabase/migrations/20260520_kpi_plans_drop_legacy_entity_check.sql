-- В kpi_plans есть legacy CHECK-ограничение «kpi_plans_entity_type_check»,
-- которое не пускает наши значения entity_type (kpi_plan / kpi / goal / ...).
-- Так как entity_type — legacy-колонка, не используемая в актуальной схеме,
-- снимаем CHECK и NOT NULL. Сама колонка остаётся, дефолт остаётся.

do $$
begin
  -- Снимаем CHECK
  if exists (
    select 1
    from pg_constraint
    where conname = 'kpi_plans_entity_type_check'
      and conrelid = 'public.kpi_plans'::regclass
  ) then
    alter table public.kpi_plans drop constraint kpi_plans_entity_type_check;
  end if;

  -- Снимаем NOT NULL (если у колонки нет NOT NULL — оператор no-op)
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'kpi_plans'
      and column_name = 'entity_type'
      and is_nullable = 'NO'
  ) then
    alter table public.kpi_plans alter column entity_type drop not null;
  end if;
end $$;

notify pgrst, 'reload schema';
