-- В legacy-базах PRIMARY KEY на kpi_plans висит на plan_key (text), а не на id.
-- Из-за этого:
--   * любой INSERT с тем же plan_key падает с 23505 (даже если бизнес-ключ
--     отличается), и логика upsert-by-business-key через existing+INSERT
--     работает нестабильно.
--   * id хоть и есть, но не является первичным ключом.
--
-- Эта миграция:
--   1) Гарантирует, что id NOT NULL и заполнен у всех строк.
--   2) Снимает PK с plan_key (если он там).
--   3) Ставит PK на id.
--   4) Снимает любые UNIQUE-ограничения с plan_key (они тоже мешают upsert).
--      plan_key остаётся как обычная колонка — API продолжает её заполнять
--      детерминированно для совместимости, но дубликаты по ней допустимы.

do $$
declare
  v_pk_name text;
  v_constraint_name text;
begin
  -- Гарантируем id (на всякий случай — на тот случай если 20260517 не отработала)
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'kpi_plans' and column_name = 'id'
  ) then
    alter table public.kpi_plans add column id uuid;
  end if;

  update public.kpi_plans set id = gen_random_uuid() where id is null;
  alter table public.kpi_plans alter column id set not null;
  alter table public.kpi_plans alter column id set default gen_random_uuid();

  -- Находим текущий PK
  select tc.constraint_name into v_pk_name
  from information_schema.table_constraints tc
  where tc.table_schema = 'public'
    and tc.table_name = 'kpi_plans'
    and tc.constraint_type = 'PRIMARY KEY'
  limit 1;

  if v_pk_name is not null then
    -- Проверяем, висит ли он не на id (или на id+что-то ещё) — тогда пересоздаём
    if exists (
      select 1 from information_schema.key_column_usage
      where table_schema = 'public'
        and table_name = 'kpi_plans'
        and constraint_name = v_pk_name
        and column_name <> 'id'
    ) or not exists (
      select 1 from information_schema.key_column_usage
      where table_schema = 'public'
        and table_name = 'kpi_plans'
        and constraint_name = v_pk_name
        and column_name = 'id'
    ) then
      execute format('alter table public.kpi_plans drop constraint %I', v_pk_name);
      alter table public.kpi_plans add primary key (id);
    end if;
  else
    alter table public.kpi_plans add primary key (id);
  end if;

  -- Снимаем UNIQUE-ограничения, в которые входит plan_key
  for v_constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.kpi_plans'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%plan_key%'
  loop
    execute format('alter table public.kpi_plans drop constraint %I', v_constraint_name);
    raise notice 'dropped unique constraint %', v_constraint_name;
  end loop;

  -- Снимаем UNIQUE-индексы на plan_key (вне constraints)
  for v_constraint_name in
    select i.relname
    from pg_class i
    join pg_index ix on ix.indexrelid = i.oid
    join pg_class t on t.oid = ix.indrelid
    where t.relname = 'kpi_plans'
      and t.relnamespace = 'public'::regnamespace
      and ix.indisunique
      and not ix.indisprimary
      and pg_get_indexdef(i.oid) ilike '%plan_key%'
  loop
    execute format('drop index if exists public.%I', v_constraint_name);
    raise notice 'dropped unique index %', v_constraint_name;
  end loop;

  -- plan_key больше не обязателен (на случай если был NOT NULL)
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'kpi_plans'
      and column_name = 'plan_key'
      and is_nullable = 'NO'
  ) then
    alter table public.kpi_plans alter column plan_key drop not null;
  end if;
end $$;

notify pgrst, 'reload schema';
