-- ─────────────────────────────────────────────────────────────────────────
-- Arena Control Center — фундамент наблюдения за станциями.
-- ─────────────────────────────────────────────────────────────────────────
-- Три новые таблицы. Существующие НЕ ИЗМЕНЯЮТСЯ ни одной строкой: ни ALTER,
-- ни DROP, ни UPDATE. arena_stations остаётся ровно такой, какой была.
--
-- Разделение слоёв, ради которого всё и затевается:
--
--   arena_stations           — что это за место (конфигурация, не трогаем)
--   arena_station_devices    — кто наблюдает
--   arena_station_runtime    — что наблюдалось последним
--   arena_station_events     — что происходило (только добавление)
--
-- Почему снимок вынесен из arena_stations, хотя формально мог бы жить в ней:
-- станцию читают три разных API через select('*') — админский, операторский и
-- точечный, — и её касаются двенадцать файлов, включая весь киоск. Добавив
-- колонки, мы изменили бы форму ответа во всех этих местах. Плюс станция —
-- это конфигурация, меняется раз в месяц руками, а снимок пишется каждые
-- тридцать секунд с каждого компьютера. Складывать их в одну строку значит
-- превратить справочник в горячую таблицу.
--
-- Образцы взяты из существующей схемы, а не придуманы:
--   • RLS включена, политик для браузера нет — как у arena_stations. Доступ
--     только через service role, то есть через Next.js API.
--   • Нормализация MAC повторяет uq_arena_stations_project_device_mac дословно.
--     Иначе одно устройство оказалось бы разным в двух таблицах.
--   • История переживает удаление станции через SET NULL — как arena_tech_logs.

-- ═════════════════════════════════════════════════════════════════════════
-- 1. КТО НАБЛЮДАЕТ
-- ═════════════════════════════════════════════════════════════════════════
-- Устройство появляется здесь заявкой и не может ничего писать, пока человек
-- её не подтвердит. Общий ключ регистрации на diskless окажется в образе, то
-- есть на каждом клиентском компьютере, — поэтому он даёт право только
-- попроситься, а не право слать данные.

create table if not exists public.arena_station_devices (
  id uuid primary key default gen_random_uuid(),

  point_project_id uuid not null references public.point_projects(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete cascade,

  -- Пустой до подтверждения: заявка приходит раньше, чем известно, чья она.
  station_id uuid null references public.arena_stations(id) on delete set null,

  device_type text not null default 'arena_agent'
    check (device_type in ('arena_agent')),

  status text not null default 'pending'
    check (status in ('pending', 'active', 'revoked')),

  -- ── Что устройство сообщило о себе ────────────────────────────────────
  -- Префикс reported_ не случаен: это наблюдения, а не истина. Станцию
  -- назначает человек при подтверждении, а не совпадение номеров.
  device_instance_id text null,
  reported_hostname text null,
  reported_mac text null,
  reported_station_name text null,
  reported_senet_ws_num integer null,
  agent_version text null,

  -- ── Учётные данные ────────────────────────────────────────────────────
  -- Выдаются только при подтверждении и только в виде хэшей. Сам секрет
  -- показывается один раз и больше не восстанавливается.
  device_token_hash text null,
  client_secret_hash text null,

  -- ── Жизненный цикл ────────────────────────────────────────────────────
  requested_at timestamptz not null default now(),
  approved_at timestamptz null,
  approved_by uuid null,
  last_seen_at timestamptz null,
  revoked_at timestamptz null,
  revoke_reason text null,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Активное устройство обязано быть привязанным и иметь свои учётные данные.
  -- Без этой проверки можно было бы получить «активное» устройство без
  -- станции — и оно писало бы события в никуда.
  constraint arena_station_devices_active_complete check (
    status <> 'active'
    or (station_id is not null and device_token_hash is not null and client_secret_hash is not null)
  )
);

comment on table public.arena_station_devices is
  'Кто наблюдает за станцией. Заявка → подтверждение человеком → право писать.';
comment on column public.arena_station_devices.status is
  'pending — может только спросить свой статус; active — может слать данные; revoked — не может ничего.';
comment on column public.arena_station_devices.reported_senet_ws_num is
  'Номер рабочей станции в SENET со слов устройства. Справочно: привязку создаёт человек.';

-- Одна станция — одно активное устройство. Захват чужой станции невозможен:
-- второе активное просто не вставится, и подтверждение потребует сначала
-- отозвать старое.
create unique index if not exists uq_arena_station_devices_active_station
  on public.arena_station_devices (station_id)
  where status = 'active' and station_id is not null;

-- Повторная заявка с той же машины не плодит строки. Ключ дедупликации —
-- идентификатор экземпляра, а не MAC: MAC может отсутствовать.
create unique index if not exists uq_arena_station_devices_instance
  on public.arena_station_devices (point_project_id, device_instance_id)
  where device_instance_id is not null;

-- По этому индексу идёт аутентификация каждого запроса — он обязан быть.
create unique index if not exists uq_arena_station_devices_token
  on public.arena_station_devices (device_token_hash)
  where device_token_hash is not null;

-- Нормализация MAC дословно как в uq_arena_stations_project_device_mac.
-- Не уникальный: до подтверждения одна машина может подать заявку повторно
-- после переустановки, и запрещать это на уровне базы неправильно.
create index if not exists idx_arena_station_devices_mac
  on public.arena_station_devices (point_project_id, replace(upper(reported_mac), '-', ':'))
  where reported_mac is not null;

-- Список заявок и устройств проекта — основной экран подтверждения.
create index if not exists idx_arena_station_devices_project_status
  on public.arena_station_devices (point_project_id, status, requested_at desc);

-- ═════════════════════════════════════════════════════════════════════════
-- 2. ЧТО НАБЛЮДАЛОСЬ ПОСЛЕДНИМ
-- ═════════════════════════════════════════════════════════════════════════
-- Строка на станцию. Здесь лежат ТОЛЬКО наблюдения и время каждого из них.
--
-- Чего здесь принципиально нет: состояния. Ни CLIENT, ни AVAILABLE, ни
-- OFFLINE. Состояние выводит сервер при чтении, потому что:
--   • OFFLINE станция никогда не сообщает — она просто замолкает;
--   • правило «SenetUser значит клиент» ещё не проверено и будет меняться,
--     а менять его нужно деплоем, а не пересборкой образа на 71 машине.
--
-- Отметки времени раздельные по каждому наблюдению. Общий барьер по строке
-- означал бы, что опоздавшее событие про игру заблокирует свежее про
-- пользователя — они независимы и приходят вразнобой.

create table if not exists public.arena_station_runtime (
  station_id uuid primary key references public.arena_stations(id) on delete cascade,

  point_project_id uuid not null references public.point_projects(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete cascade,

  device_id uuid null references public.arena_station_devices(id) on delete set null,

  -- ── Наблюдения, каждое со своим временем ──────────────────────────────
  observed_user_kind text null,
  observed_user_kind_at timestamptz null,

  observed_game_process text null,
  observed_game_path text null,
  observed_game_at timestamptz null,

  -- Догадка самого устройства о состоянии. Только для сверки во время
  -- эксперимента: сервер не использует её ни в проекции, ни в аналитике.
  observed_state_hint text null,
  observed_state_hint_at timestamptz null,

  last_boot_at timestamptz null,
  agent_version text null,

  -- ВРЕМЯ СЕРВЕРА, не устройства. Часы клиента могут врать, а вывод об
  -- offline обязан опираться на то, что сервер действительно получал.
  last_heartbeat_at timestamptz null,
  last_event_at timestamptz null,

  -- Для диагностики порядка и пропусков: устройство нумерует свои сообщения.
  source_instance_id text null,
  last_source_seq bigint null,

  updated_at timestamptz not null default now()
);

comment on table public.arena_station_runtime is
  'Последние наблюдения по станции. Состояние здесь НЕ хранится — оно выводится сервером при чтении.';
comment on column public.arena_station_runtime.last_heartbeat_at is
  'Время ПРИЁМА сервером. Именно по нему определяется offline, а не по часам устройства.';
comment on column public.arena_station_runtime.observed_state_hint is
  'Что о своём состоянии думает само устройство. Только сверка, в проекцию не идёт.';

-- Живой экран читает по проекту и сортирует по свежести сигнала.
create index if not exists idx_arena_station_runtime_project
  on public.arena_station_runtime (point_project_id, last_heartbeat_at desc nulls last);

-- ═════════════════════════════════════════════════════════════════════════
-- 3. ЧТО ПРОИСХОДИЛО
-- ═════════════════════════════════════════════════════════════════════════
-- Только добавление. Ничего не обновляется и не удаляется: это улики, а не
-- выводы. Через полгода спорный случай разбирается по ним, а не по тому, что
-- система тогда решила.

create table if not exists public.arena_station_events (
  id uuid primary key default gen_random_uuid(),

  -- Идентификатор события, назначенный самим устройством. По нему работает
  -- защита от повторной доставки: сеть нестабильна, и одно событие приходит
  -- дважды. Обработать его дважды нельзя.
  event_id uuid not null,

  point_project_id uuid not null references public.point_projects(id) on delete cascade,

  -- SET NULL, а не CASCADE: история переживает удаление станции. Ровно так
  -- же устроен arena_tech_logs.station_id в существующей схеме.
  company_id uuid null references public.companies(id) on delete set null,
  station_id uuid null references public.arena_stations(id) on delete set null,
  device_id uuid null references public.arena_station_devices(id) on delete set null,

  -- Имя станции на момент события. Без него удалённая станция превращает
  -- историю в набор пустых ссылок.
  station_name_snapshot text null,

  event_type text not null,

  -- Когда произошло по часам устройства и когда сервер это получил.
  -- Хронологию строим по первому, доверие к свежести — по второму.
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),

  source text not null default 'arena_probe',
  source_instance_id text null,
  source_seq bigint null,

  payload jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,

  created_at timestamptz not null default now()
);

comment on table public.arena_station_events is
  'Что происходило со станцией. Только добавление: это улики, а не выводы.';
comment on column public.arena_station_events.occurred_at is
  'По часам устройства. Хронология строится по нему, но доверие к свежести — по received_at.';

-- Защита от повторной доставки.
--
-- Ключом взят проект, а не станция, хотя напрашивается (station_id, event_id).
-- Причина: station_id обнуляется при удалении станции, а в Postgres два NULL
-- считаются разными значениями — уникальность бесшумно перестала бы работать
-- ровно тогда, когда история важнее всего.
create unique index if not exists uq_arena_station_events_dedup
  on public.arena_station_events (point_project_id, event_id);

-- Лента событий станции — основной запрос при разборе случая.
create index if not exists idx_arena_station_events_station_time
  on public.arena_station_events (station_id, occurred_at desc)
  where station_id is not null;

-- Лента по всему проекту.
create index if not exists idx_arena_station_events_project_time
  on public.arena_station_events (point_project_id, occurred_at desc);

-- ═════════════════════════════════════════════════════════════════════════
-- 4. ЗАЩИТА
-- ═════════════════════════════════════════════════════════════════════════
-- RLS включена, политик для браузера НЕТ — ровно как у arena_stations,
-- arena_zones, arena_tariffs и arena_sessions в существующей схеме.
--
-- Это не забывчивость, а самый строгий вариант: без политик через
-- authenticated не читается ничего. Единственный путь к данным — service role
-- из серверных маршрутов Next.js. То же самое правило действует и для
-- устройств: агент никогда не получает ключей Supabase и ходит только в API.

alter table public.arena_station_devices enable row level security;
alter table public.arena_station_runtime enable row level security;
alter table public.arena_station_events  enable row level security;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ
-- ═════════════════════════════════════════════════════════════════════════
-- Ожидается: три новые таблицы существуют и пусты, объёмы существующих
-- совпадают с тем, что было до миграции.
--
-- select to_regclass('public.arena_station_devices') as devices,
--        to_regclass('public.arena_station_runtime') as runtime,
--        to_regclass('public.arena_station_events')  as events,
--        (select count(*) from public.arena_stations) as станций,
--        (select count(*) from public.arena_zones)    as зон,
--        (select count(*) from public.arena_sessions) as сессий;
--
-- До миграции было: станций 77, зон 8, сессий 353.
