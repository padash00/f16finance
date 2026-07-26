-- Пакеты/аддоны управляют не только страницами, но и ДЕЙСТВИЯМИ (кнопками).
-- capability_codes = список ВЫКЛЮЧЕННЫХ действий для орг на этом пакете
-- (по умолчанию всё включено; сюда попадает то, что пакет НЕ даёт).
-- Применяется только когда у орг включён features_enforced (как и страницы).
alter table public.packages
  add column if not exists capability_codes text[] not null default '{}';

alter table public.addons
  add column if not exists capability_codes text[] not null default '{}';
