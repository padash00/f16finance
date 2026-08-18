-- Arena Control Center — аудит боевой схемы ПЕРЕД первой миграцией.
--
-- Зачем: ядро арены (arena_stations, arena_zones, arena_sessions, arena_tariffs,
-- arena_tech_logs) заводилось вне папки миграций, руками. В репозитории его
-- определений нет, а строить поверх невидимой схемы — способ повторить историю
-- со staff.photo_url: код был уверен в колонке, колонки не было, всё молча не
-- работало.
--
-- ТОЛЬКО ЧТЕНИЕ. Ни одного ALTER, UPDATE, DELETE. Ничего не создаёт.
--
-- Как запускать: Supabase SQL Editor, блоки по одному, вывод — в чат.
-- Проект F16: point_project_id = 5ff1c91d-92d1-4a38-ad53-347df71e0bf2

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. КОЛОНКИ arena_stations. Главный блок — на него опирается всё остальное.
--
-- Читать так: смотрим, нет ли уже полей под мониторинг (kiosk_status,
-- last_heartbeat_at и подобных) и как называются identity-поля — MAC, IP, код.
-- Новые имена не должны с ними столкнуться.
-- ─────────────────────────────────────────────────────────────────────────────
select column_name,
       data_type,
       is_nullable,
       column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'arena_stations'
 order by ordinal_position;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. КОЛОНКИ arena_zones — нужны, чтобы понимать, к чему привязывать зону в
--    будущей аналитике загрузки.
-- ─────────────────────────────────────────────────────────────────────────────
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'arena_zones'
 order by ordinal_position;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. КЛЮЧИ И ОГРАНИЧЕНИЯ по всем таблицам арены.
--
-- Читать так: на что можно ставить внешний ключ из новых таблиц и какие
-- ограничения уже действуют. Особенно интересует, что происходит при удалении
-- станции — от этого зависит, переживёт ли история удаление ПК.
-- ─────────────────────────────────────────────────────────────────────────────
select tc.table_name,
       tc.constraint_type,
       tc.constraint_name,
       kcu.column_name,
       ccu.table_name  as ссылается_на_таблицу,
       ccu.column_name as ссылается_на_колонку,
       rc.delete_rule  as при_удалении
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
 order by tc.table_name, tc.constraint_type, kcu.ordinal_position;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ИНДЕКСЫ арены. Читать так: какие запросы уже оптимизированы и не создаём
--    ли мы дубли новыми индексами.
-- ─────────────────────────────────────────────────────────────────────────────
select tablename, indexname, indexdef
  from pg_indexes
 where schemaname = 'public'
   and tablename like 'arena_%'
 order by tablename, indexname;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS И ПОЛИТИКИ. Читать так: включена ли защита на строках и нет ли
--    разрешающих политик вида using(true) — новые таблицы должны повторять
--    рабочий образец, а не изобретать свой.
-- ─────────────────────────────────────────────────────────────────────────────
select c.relname                             as таблица,
       c.relrowsecurity                      as rls_включена,
       c.relforcerowsecurity                 as rls_принудительная
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname like 'arena_%'
   and c.relkind = 'r'
 order by c.relname;

select tablename, policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename like 'arena_%'
 order by tablename, policyname;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ТРИГГЕРЫ на арене. Читать так: не сработает ли что-то неожиданное при
--    записи в станции, и есть ли автоматическое обновление updated_at.
-- ─────────────────────────────────────────────────────────────────────────────
select event_object_table as таблица,
       trigger_name,
       event_manipulation as событие,
       action_timing      as когда,
       action_statement   as что_вызывает
  from information_schema.triggers
 where trigger_schema = 'public'
   and event_object_table like 'arena_%'
 order by event_object_table, trigger_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. ЧТО ЗАВИСИТ ОТ arena_stations: представления и функции.
--
-- Читать так: если станцию читает view или функция, любое изменение таблицы
-- задевает и их. Нам это менять нельзя.
-- ─────────────────────────────────────────────────────────────────────────────
select distinct dependent_view.relname as зависимая_сущность,
       dependent_view.relkind          as тип
  from pg_depend
  join pg_rewrite      on pg_depend.objid = pg_rewrite.oid
  join pg_class as dependent_view on pg_rewrite.ev_class = dependent_view.oid
  join pg_class as source_table   on pg_depend.refobjid = source_table.oid
  join pg_namespace n on n.oid = source_table.relnamespace
 where source_table.relname in ('arena_stations', 'arena_zones')
   and n.nspname = 'public'
   and dependent_view.relname not in ('arena_stations', 'arena_zones');

-- prokind='f' обязателен: pg_get_functiondef() падает на агрегатных функциях
-- («array_agg is an aggregate function»), а они попадают в выборку по public.
select p.proname as функция, pg_get_function_identity_arguments(p.oid) as аргументы
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prokind = 'f'
   and pg_get_functiondef(p.oid) ilike '%arena_stations%'
 order by p.proname;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. СТАНЦИЯ 21 ЦЕЛИКОМ — наша reference station.
--
-- Читать так: по каким полям probe сможет себя опознать при регистрации.
-- Заодно видно, есть ли уже MAC/IP и как заполнены код и имя.
-- ─────────────────────────────────────────────────────────────────────────────
select *
  from public.arena_stations
 where point_project_id = '5ff1c91d-92d1-4a38-ad53-347df71e0bf2'
   and (name = '21' or name ilike '%21%')
 order by name;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. КАРТИНА ПРОЕКТА: сколько станций, зон, компаний.
--
-- Читать так: проверяем, что 71 ПК — это правда, и видим, делится ли парк на
-- несколько компаний (F16 Arena / F16 Extra) — это влияет на изоляцию.
-- ─────────────────────────────────────────────────────────────────────────────
select z.name                        as зона,
       s.company_id,
       count(*)                      as станций,
       count(*) filter (where s.is_active) as активных,
       min(s.name)                   as первая,
       max(s.name)                   as последняя
  from public.arena_stations s
  left join public.arena_zones z on z.id = s.zone_id
 where s.point_project_id = '5ff1c91d-92d1-4a38-ad53-347df71e0bf2'
 group by z.name, s.company_id
 order by z.name;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. БУДУЩИЕ КОНФЛИКТЫ ПО НОМЕРАМ.
--
-- Читать так: если один и тот же числовой номер встречается дважды, то будущий
-- UNIQUE(point_project_id, senet_ws_num) упадёт при попытке создания. Лучше
-- узнать это сейчас, а не в момент миграции.
-- ─────────────────────────────────────────────────────────────────────────────
select имя_как_число, count(*) as станций, string_agg(id::text, ', ') as строки
  from (
    select id,
           nullif(regexp_replace(name, '\D', '', 'g'), '')::bigint as имя_как_число
      from public.arena_stations
     where point_project_id = '5ff1c91d-92d1-4a38-ad53-347df71e0bf2'
  ) t
 where имя_как_число is not null
 group by имя_как_число
having count(*) > 1
 order by имя_как_число;

-- Сколько станций вообще имеют числовое имя — от этого зависит, сработает ли
-- автосопоставление с номерами SENET.
select count(*)                                                            as всего,
       count(*) filter (where name ~ '^\d+$')                              as имя_чисто_число,
       count(*) filter (where name !~ '^\d+$')                             as имя_не_число
  from public.arena_stations
 where point_project_id = '5ff1c91d-92d1-4a38-ad53-347df71e0bf2';

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. КИОСК: что уже есть под наблюдение.
--
-- Читать так: если поля киоска уже описывают «жив ли ПК», надо понимать, чем
-- новый агент от них отличается и не дублируем ли мы существующее.
-- ─────────────────────────────────────────────────────────────────────────────
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'arena_stations'
   and (column_name ilike '%kiosk%'
     or column_name ilike '%heartbeat%'
     or column_name ilike '%mac%'
     or column_name ilike '%ip%'
     or column_name ilike '%device%'
     or column_name ilike '%register%'
     or column_name ilike '%agent%'
     or column_name ilike '%code%')
 order by column_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. ОБЪЁМ существующих таблиц — чтобы после миграции убедиться, что ни одна
--     строка не пропала. Запомните эти числа.
-- ─────────────────────────────────────────────────────────────────────────────
select 'arena_zones'     as таблица, count(*) from public.arena_zones
union all select 'arena_stations',  count(*) from public.arena_stations
union all select 'arena_tariffs',   count(*) from public.arena_tariffs
union all select 'arena_sessions',  count(*) from public.arena_sessions
union all select 'arena_games_catalog', count(*) from public.arena_games_catalog
union all select 'arena_station_games', count(*) from public.arena_station_games
union all select 'arena_map_decorations', count(*) from public.arena_map_decorations;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. НЕ ЗАНЯТЫ ЛИ ИМЕНА будущих таблиц. Читать так: все три должны вернуть
--     null, иначе имя придётся выбрать другое.
-- ─────────────────────────────────────────────────────────────────────────────
select to_regclass('public.arena_station_devices') as devices,
       to_regclass('public.arena_station_runtime') as runtime,
       to_regclass('public.arena_station_events')  as events;
