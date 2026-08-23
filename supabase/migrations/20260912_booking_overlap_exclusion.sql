-- ─────────────────────────────────────────────────────────────────────────
-- Две брони на один ПК в одно время — запрет на уровне базы.
-- ─────────────────────────────────────────────────────────────────────────
-- ВНИМАНИЕ: применять ТОЛЬКО осознанно. Миграция включает расширение
-- btree_gist на боевой базе. Код работает и без неё — пересечения
-- проверяются в API перед вставкой.
--
-- Зачем она нужна. Проверка в коде читает брони, а потом вставляет свою: между
-- этими двумя действиями может вклиниться чужая вставка, и обе пройдут. Пока
-- брони заводил один оператор в одной программе, это было умозрительно. Теперь
-- их снимают с сайта, заводят в кассе, а заявки идут ещё и из клиентского
-- приложения — три источника, и гонка становится вопросом времени.
--
-- Что делает ограничение: физически не даёт существовать двум активным броням
-- одной станции с пересекающимся временем. Впритык разрешено: 19:00–21:00 и
-- 21:00–23:00 уживаются, потому что интервал берётся полуоткрытым `[)`.
--
-- Отменённые и прошедшие брони под ограничение не попадают: место, с которого
-- бронь сняли, обязано снова бронироваться.

create extension if not exists btree_gist;

alter table public.client_bookings
  drop constraint if exists client_bookings_no_station_overlap;

alter table public.client_bookings
  add constraint client_bookings_no_station_overlap
  exclude using gist (
    station_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (
    station_id is not null
    and ends_at is not null
    and status in ('requested', 'confirmed')
  );

-- ── ЕСЛИ ПАДАЕТ ПРИ ПРИМЕНЕНИИ ────────────────────────────────────────────
-- Значит, пересечения в базе уже есть — их создали до запрета. Найти их:
--
-- select a.id, a.station_name_snapshot, a.starts_at, a.ends_at,
--        b.id, b.starts_at, b.ends_at
--   from public.client_bookings a
--   join public.client_bookings b
--     on a.station_id = b.station_id
--    and a.id < b.id
--    and a.status in ('requested','confirmed')
--    and b.status in ('requested','confirmed')
--    and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')
--  order by a.starts_at;
--
-- Лишнюю из пары отменить руками (status = 'cancelled'), потом применить снова.

-- ── ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ ─────────────────────────────────────────────
-- select conname from pg_constraint where conname = 'client_bookings_no_station_overlap';
-- Ожидается: одна строка.
