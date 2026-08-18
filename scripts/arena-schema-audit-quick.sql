-- Arena Control Center — тот же аудит, но в трёх запросах вместо тринадцати.
--
-- Каждый блок возвращает одну строку с JSON. Скопировать вывод целиком.
-- ТОЛЬКО ЧТЕНИЕ.
--
-- Проект F16: 5ff1c91d-92d1-4a38-ad53-347df71e0bf2

-- ─────────────────────────────────────────────────────────────────────────────
-- ЗАПРОС 1 из 3 — СХЕМА: колонки, ключи, индексы.
-- ─────────────────────────────────────────────────────────────────────────────
select json_build_object(
  'stations_columns', (
    select json_agg(json_build_object(
             'col', column_name, 'type', data_type,
             'null', is_nullable, 'default', column_default) order by ordinal_position)
      from information_schema.columns
     where table_schema = 'public' and table_name = 'arena_stations'
  ),
  'zones_columns', (
    select json_agg(json_build_object(
             'col', column_name, 'type', data_type,
             'null', is_nullable, 'default', column_default) order by ordinal_position)
      from information_schema.columns
     where table_schema = 'public' and table_name = 'arena_zones'
  ),
  'constraints', (
    select json_agg(json_build_object(
             'table', tc.table_name, 'kind', tc.constraint_type,
             'name', tc.constraint_name, 'column', kcu.column_name,
             'refs', ccu.table_name, 'on_delete', rc.delete_rule))
      from information_schema.table_constraints tc
      left join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      left join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
      left join information_schema.referential_constraints rc
        on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.table_schema
     where tc.table_schema = 'public'
       and tc.table_name like 'arena_%'
       and tc.constraint_type in ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')
  ),
  'indexes', (
    select json_agg(json_build_object('table', tablename, 'def', indexdef))
      from pg_indexes
     where schemaname = 'public' and tablename like 'arena_%'
  )
) as схема;

-- ─────────────────────────────────────────────────────────────────────────────
-- ЗАПРОС 2 из 3 — ЗАЩИТА И ЗАВИСИМОСТИ: RLS, политики, триггеры, что зависит
-- от arena_stations.
-- ─────────────────────────────────────────────────────────────────────────────
select json_build_object(
  'rls', (
    select json_agg(json_build_object(
             'table', c.relname, 'enabled', c.relrowsecurity, 'forced', c.relforcerowsecurity))
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname like 'arena_%' and c.relkind = 'r'
  ),
  'policies', (
    select json_agg(json_build_object(
             'table', tablename, 'name', policyname, 'cmd', cmd,
             'roles', roles::text, 'using', qual, 'check', with_check))
      from pg_policies
     where schemaname = 'public' and tablename like 'arena_%'
  ),
  'triggers', (
    select json_agg(json_build_object(
             'table', event_object_table, 'name', trigger_name,
             'event', event_manipulation, 'timing', action_timing, 'calls', action_statement))
      from information_schema.triggers
     where trigger_schema = 'public' and event_object_table like 'arena_%'
  ),
  'dependent_views', (
    select json_agg(distinct dv.relname)
      from pg_depend d
      join pg_rewrite r on d.objid = r.oid
      join pg_class dv on r.ev_class = dv.oid
      join pg_class st on d.refobjid = st.oid
      join pg_namespace n on n.oid = st.relnamespace
     where st.relname in ('arena_stations', 'arena_zones')
       and n.nspname = 'public'
       and dv.relname not in ('arena_stations', 'arena_zones')
  ),
  'dependent_functions', (
    select json_agg(p.proname)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and pg_get_functiondef(p.oid) ilike '%arena_stations%'
  )
) as защита;

-- ─────────────────────────────────────────────────────────────────────────────
-- ЗАПРОС 3 из 3 — ДАННЫЕ: станция 21, картина парка, конфликты номеров,
-- объёмы таблиц.
-- ─────────────────────────────────────────────────────────────────────────────
select json_build_object(
  'station_21', (
    select json_agg(to_jsonb(s))
      from public.arena_stations s
     where s.point_project_id = '5ff1c91d-92d1-4a38-ad53-347df71e0bf2'
       and s.name ~ '(^|\D)21(\D|$)'
  ),
  'by_zone', (
    select json_agg(x)
      from (
        select z.name as zone, s.company_id, count(*) as stations,
               count(*) filter (where s.is_active) as active,
               min(s.name) as first_name, max(s.name) as last_name
          from public.arena_stations s
          left join public.arena_zones z on z.id = s.zone_id
         where s.point_project_id = '5ff1c91d-92d1-4a38-ad53-347df71e0bf2'
         group by z.name, s.company_id
      ) x
  ),
  'name_shape', (
    select json_build_object(
             'total', count(*),
             'pure_numeric', count(*) filter (where name ~ '^\d+$'),
             'not_numeric', count(*) filter (where name !~ '^\d+$'))
      from public.arena_stations
     where point_project_id = '5ff1c91d-92d1-4a38-ad53-347df71e0bf2'
  ),
  'numeric_conflicts', (
    select json_agg(x)
      from (
        select num, count(*) as stations
          from (
            select nullif(regexp_replace(name, '\D', '', 'g'), '')::bigint as num
              from public.arena_stations
             where point_project_id = '5ff1c91d-92d1-4a38-ad53-347df71e0bf2'
          ) t
         where num is not null
         group by num
        having count(*) > 1
      ) x
  ),
  'row_counts', json_build_object(
    'arena_zones',           (select count(*) from public.arena_zones),
    'arena_stations',        (select count(*) from public.arena_stations),
    'arena_tariffs',         (select count(*) from public.arena_tariffs),
    'arena_sessions',        (select count(*) from public.arena_sessions),
    'arena_games_catalog',   (select count(*) from public.arena_games_catalog),
    'arena_station_games',   (select count(*) from public.arena_station_games),
    'arena_map_decorations', (select count(*) from public.arena_map_decorations)
  )
) as данные;
