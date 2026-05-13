-- В kpi_plans бывает legacy CHECK-ограничение на entity_type, которое
-- не пускает наши значения. Имя у разных баз отличается:
-- «kpi_plans_entity_type_check», «kpi_plans_entity_type_chk» и т.п.
-- Чтобы покрыть все варианты — ищем ВСЕ CHECK-ограничения, в определении
-- которых упоминается entity_type, и дропаем.

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.kpi_plans'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%entity_type%'
  loop
    execute format('alter table public.kpi_plans drop constraint %I', v_constraint_name);
    raise notice 'dropped check constraint %', v_constraint_name;
  end loop;

  -- Снимаем NOT NULL (если оно ещё там)
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
