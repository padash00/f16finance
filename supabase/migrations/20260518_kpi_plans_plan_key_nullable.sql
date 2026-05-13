-- Legacy-колонка plan_key NOT NULL в kpi_plans мешала INSERT.
-- Если plan_key НЕ часть primary key — делаем её nullable.
-- Если plan_key — primary key (или часть составного PK), оставляем как есть:
-- API сам заполняет plan_key детерминированно (company|kind|period_start),
-- так что NOT NULL ему не мешает.

do $$
declare
  v_has_col boolean;
  v_is_in_pk boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'kpi_plans'
      and column_name = 'plan_key'
      and is_nullable = 'NO'
  ) into v_has_col;

  if not v_has_col then
    return;
  end if;

  -- Проверяем, входит ли plan_key в первичный ключ
  select exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name
      and kcu.table_schema = tc.table_schema
      and kcu.table_name = tc.table_name
    where tc.table_schema = 'public'
      and tc.table_name = 'kpi_plans'
      and tc.constraint_type = 'PRIMARY KEY'
      and kcu.column_name = 'plan_key'
  ) into v_is_in_pk;

  if v_is_in_pk then
    raise notice 'plan_key входит в primary key — оставляем NOT NULL, API заполняет значение сам';
    return;
  end if;

  alter table public.kpi_plans alter column plan_key drop not null;
end $$;

notify pgrst, 'reload schema';
