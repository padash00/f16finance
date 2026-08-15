-- ─────────────────────────────────────────────────────────────────────────
-- Эффективность продавцов: внешние события рядом с точкой.
-- ─────────────────────────────────────────────────────────────────────────
-- Концерт, городской праздник, перекрытие улицы, студенческое мероприятие —
-- всё это меняет поток покупателей, но к работе продавца отношения не имеет.
--
-- Как и остальные деловые события, внешнее не меняет балл: оно снижает
-- уверенность в оценке и попадает в разбор смены. Автоматического поиска
-- событий в интернете нет и не планируется: непроверенное событие не должно
-- двигать оценку людей, а проверять его всё равно придётся человеку.

alter table public.store_kpi_business_events
  drop constraint if exists store_kpi_business_events_event_type_check;

alter table public.store_kpi_business_events
  add constraint store_kpi_business_events_event_type_check
  check (event_type in (
    'STOCKOUT', 'PROMOTION', 'PRICE_CHANGE', 'NEW_PRODUCT',
    'TECHNICAL_DOWNTIME', 'PARTIAL_CLOSURE', 'FULL_CLOSURE',
    -- Новое: то, что происходит снаружи и на что точка не влияет.
    'EXTERNAL_EVENT', 'ROAD_CLOSURE',
    'CUSTOM'
  ));
