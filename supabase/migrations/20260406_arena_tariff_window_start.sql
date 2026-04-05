-- Начало окна для пакетов «день / ночь» (вместе с window_end_time)
alter table public.arena_tariffs
  add column if not exists window_start_time text null;

comment on column public.arena_tariffs.window_start_time is 'Начало окна HH:MM (локально), для tariff_type=time_window; ночь 22:00–10:00 — start > end по часам';
