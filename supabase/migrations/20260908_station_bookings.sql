-- ─────────────────────────────────────────────────────────────────────────
-- Бронь конкретной станции оператором.
-- ─────────────────────────────────────────────────────────────────────────
-- До сих пор бронь существовала только как заявка клиента из приложения: она
-- знала точку и время, но не знала компьютер. Ответить «какие ПК заняты к
-- девяти вечера» было невозможно в принципе.
--
-- ГЛАВНОЕ ПРАВИЛО: бронь и сессия — разные вещи, и смешивать их нельзя.
--
-- Бронь — это обещание на будущее. Сессия — факт использования сейчас. Если
-- бронь начнёт создавать сессию, в отчётах появятся часы, которых не было:
-- человек забронировал и не пришёл, а система записала занятость. Поэтому
-- бронь НИКОГДА не трогает arena_sessions, не обращается к SENET и не меняет
-- состояние станции в мониторинге. Она только окрашивает карту и
-- предупреждает оператора.

-- ── Кого бронируем ────────────────────────────────────────────────────────
-- Телефон становится главным, а карточка клиента — необязательной.
--
-- Оператору звонят люди, которых в базе нет, и требовать заранее заведённого
-- клиента значит либо мешать работе, либо плодить пустые карточки на каждый
-- звонок. Если номер уже известен, связь с клиентом проставляется — это и даёт
-- «человек звонил раньше, вот его история».
alter table public.client_bookings
  alter column customer_id drop not null;

alter table public.client_bookings
  add column if not exists station_id uuid null references public.arena_stations(id) on delete set null,
  add column if not exists point_project_id uuid null references public.point_projects(id) on delete cascade,
  add column if not exists contact_phone text null,
  add column if not exists contact_name text null,
  -- Тариф, который обещали по телефону. Справочно: денег бронь не считает.
  add column if not exists tariff_id uuid null references public.arena_tariffs(id) on delete set null,
  add column if not exists created_by_operator_id uuid null references public.operators(id) on delete set null,
  add column if not exists shift_id uuid null references public.point_shifts(id) on delete set null,
  -- Имя станции на момент брони: станцию могут удалить, а история должна
  -- остаться читаемой. Тот же приём, что в журнале наблюдений.
  add column if not exists station_name_snapshot text null;

comment on column public.client_bookings.station_id is
  'Забронированная станция. NULL — старая заявка из клиентского приложения, без привязки к ПК.';
comment on column public.client_bookings.contact_phone is
  'Телефон для связи. Главный признак: клиента в базе может не быть.';
comment on column public.client_bookings.tariff_id is
  'Тариф, обещанный при бронировании. Справочно — бронь денег не считает.';

-- Бронь станции обязана иметь и телефон, и время окончания.
--
-- Время окончания раньше было необязательным, и для заявки «хочу прийти
-- вечером» этого хватало. Для брони конкретного ПК — нет: без него нельзя
-- ответить, когда машина освободится, а в этом вся ценность.
--
-- Старые строки не затрагиваются: проверка срабатывает только когда указана
-- станция.
alter table public.client_bookings
  drop constraint if exists client_bookings_station_requires_contact;

alter table public.client_bookings
  add constraint client_bookings_station_requires_contact check (
    station_id is null
    or (
      ends_at is not null
      and ends_at > starts_at
      and (contact_phone is not null or customer_id is not null)
    )
  );

-- ── Индексы под реальные запросы ──────────────────────────────────────────

-- Главный вопрос карты: что забронировано на этой точке в такой-то день.
create index if not exists idx_client_bookings_project_time
  on public.client_bookings (point_project_id, starts_at)
  where station_id is not null;

-- Второй вопрос: что забронировано на конкретной станции.
create index if not exists idx_client_bookings_station_time
  on public.client_bookings (station_id, starts_at)
  where station_id is not null;

-- Поиск по телефону: «этот номер уже звонил».
create index if not exists idx_client_bookings_phone
  on public.client_bookings (company_id, contact_phone)
  where contact_phone is not null;

-- ── Почему нет запрета пересечений на уровне базы ─────────────────────────
-- Напрашивается ограничение EXCLUDE, которое физически запретило бы две брони
-- одной станции на пересекающееся время. Оно требует расширения btree_gist, а
-- включать расширение на боевой базе ради одной проверки — решение, которое
-- должен принимать владелец, а не миграция.
--
-- Поэтому пересечения проверяются в API перед вставкой. Это слабее: при двух
-- одновременных запросах теоретически пройдут оба. На практике брони заводит
-- один оператор в одной программе, и гонка здесь маловероятна.
--
-- Если владелец включит btree_gist, ограничение добавляется отдельной
-- миграцией и станет настоящей гарантией.

-- ── ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ ─────────────────────────────────────────────
-- select count(*) as всего_броней,
--        count(*) filter (where station_id is not null) as со_станцией
--   from public.client_bookings;
--
-- Ожидается: общее число не изменилось, со станцией — ноль.
