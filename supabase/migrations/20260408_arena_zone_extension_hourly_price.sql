-- Базовая ставка ₸/час для продления сессии по сумме — на уровне зоны (все станции зоны).
alter table public.arena_zones
  add column if not exists extension_hourly_price numeric null;

comment on column public.arena_zones.extension_hourly_price is
  '₸ за 60 мин при расчёте продления по сумме; при null — fallback на tariff.extension_hourly_price или пропорция к пакету';
