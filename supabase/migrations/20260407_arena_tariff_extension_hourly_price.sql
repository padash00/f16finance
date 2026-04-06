-- Цена за 60 мин для расчёта продления по сумме, когда сумма меньше цены пакета (скидочный пакет 2+1 и т.п.)
alter table public.arena_tariffs
  add column if not exists extension_hourly_price numeric null;

comment on column public.arena_tariffs.extension_hourly_price is
  '₸ за 60 мин при доплате меньше цены пакета; при null — как раньше: пропорция к цене/длительности пакета';
