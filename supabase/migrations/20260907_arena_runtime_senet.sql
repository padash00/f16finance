-- ─────────────────────────────────────────────────────────────────────────
-- Наблюдения о сессии SENET: кто за компьютером и по какому счёту.
-- ─────────────────────────────────────────────────────────────────────────
-- До этого момента система знала только, КАКАЯ учётная запись Windows
-- залогинена: клиентская, техническая или никакой. Этого хватало, чтобы
-- сказать «занято», но не хватало, чтобы сказать «занято кем».
--
-- Разведка на боевых станциях нашла, откуда это читать. Служба SENET (вендор
-- Enestech) пишет в C:\ProgramData\Enestech\Logs\senet-credential.log строку
-- вида «Authorize username: olzhas, password=... type: 4», а рядом результат
-- «auth result status: 0». Пароль наблюдателю не нужен и не читается.
--
-- Номер станции берётся из C:\ProgramData\Enestech\Service\State.json. Проверка
-- на трёх машинах показала, что он у каждой свой и совпадает с тем, что видит
-- сервер SENET, — в отличие от имени компьютера, которое на одной из машин
-- осталось от мастер-образа и указывало на чужую станцию.
--
-- Всё это по-прежнему НАБЛЮДЕНИЯ, а не истина: поля названы observed_ и живут
-- рядом с остальными, каждое со своей отметкой времени.

alter table public.arena_station_runtime
  add column if not exists observed_senet_login text null,
  add column if not exists observed_senet_account_type integer null,
  add column if not exists observed_senet_at timestamptz null,
  -- Номер станции, как его называет сама машина. Справочно: привязку к
  -- станции по-прежнему создаёт человек, а не совпадение номеров.
  add column if not exists observed_senet_ws_num integer null;

comment on column public.arena_station_runtime.observed_senet_login is
  'Логин клиента из журнала SENET. Наблюдение, а не проверенная личность.';
comment on column public.arena_station_runtime.observed_senet_account_type is
  'Тип счёта SENET: -4 безлимит, 0 чек, 1 обычный, 2 школьный, 3 сотрудник, 4 постоплата.';
comment on column public.arena_station_runtime.observed_senet_ws_num is
  'Номер станции по данным самой машины. Имя компьютера ненадёжно: на одной из станций оно осталось от мастер-образа.';

-- Заявки устройств тоже хранят номер: он приходит при регистрации и помогает
-- подсказать нужную станцию человеку, который подтверждает привязку.
comment on column public.arena_station_devices.reported_senet_ws_num is
  'Номер станции в SENET со слов устройства, из State.json. Основа для подсказки при подтверждении.';

-- ─────────────────────────────────────────────────────────────────────────
-- ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ
-- ─────────────────────────────────────────────────────────────────────────
-- select column_name from information_schema.columns
--  where table_name = 'arena_station_runtime'
--    and column_name like 'observed_senet%';
--
-- Ожидается четыре строки.
