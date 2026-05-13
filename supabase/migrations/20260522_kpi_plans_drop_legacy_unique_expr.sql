-- Legacy UNIQUE «kpi_plans_unique_expr» построен на
-- (month_start, entity_type, COALESCE(company_code, ''), COALESCE(operator_id, ...),
-- COALESCE(role_code, '')). Это ограничение пришло из старой схемы и
-- не учитывает kind, из-за чего нельзя сохранить одновременно несколько
-- метрик (revenue/expense/profit) на один и тот же месяц.
--
-- В актуальной модели уникальность планов — по (company_id, period_start, kind),
-- и она обеспечивается на уровне API (existing-check). Снимаем legacy UNIQUE.
--
-- Заодно — общее: дропаем любые UNIQUE-ограничения и UNIQUE-индексы на
-- kpi_plans, кроме PRIMARY KEY на id.

do $$
declare
  v_name text;
begin
  -- UNIQUE constraints (включая на выражениях)
  for v_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.kpi_plans'::regclass
      and c.contype = 'u'
  loop
    execute format('alter table public.kpi_plans drop constraint %I', v_name);
    raise notice 'dropped unique constraint %', v_name;
  end loop;

  -- UNIQUE-индексы, не привязанные к constraint (могут остаться отдельно)
  for v_name in
    select i.relname
    from pg_class i
    join pg_index ix on ix.indexrelid = i.oid
    join pg_class t on t.oid = ix.indrelid
    where t.relname = 'kpi_plans'
      and t.relnamespace = 'public'::regnamespace
      and ix.indisunique
      and not ix.indisprimary
  loop
    execute format('drop index if exists public.%I', v_name);
    raise notice 'dropped unique index %', v_name;
  end loop;
end $$;

notify pgrst, 'reload schema';
