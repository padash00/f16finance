-- Характеристики зала и темы экзамена.
--
-- Оператор обязан отвечать клиенту, что стоит в PRO и чем он отличается от
-- обычной зоны. Раньше эти данные жили только в голове управляющего, поэтому
-- и спросить их на аттестации было неоткуда.
--
-- Характеристики привязаны к зоне, а не к станции: внутри зоны железо
-- одинаковое, и заполнять 71 карточку вручную никто не станет.

alter table public.arena_zones
  add column if not exists cpu text,
  add column if not exists gpu text,
  add column if not exists ram text,
  add column if not exists monitor text,
  add column if not exists refresh_hz smallint,
  add column if not exists peripherals text,
  add column if not exists specs_note text;

comment on column public.arena_zones.refresh_hz is 'Частота монитора, Гц — спрашивается на аттестации и показывается клиенту';
comment on column public.arena_zones.peripherals is 'Мышь, клавиатура, гарнитура, кресло — одной строкой';

-- Из чего собирать билет: регламенты, товары и цены, тарифы, техника и т.д.
-- Пусто = только регламенты, как было до появления тем.
alter table public.operator_exams
  add column if not exists topics text[] not null default '{}';

comment on column public.operator_exams.topics is
  'Темы билета: rules, catalog, tariffs, hardware, stations, warehouse';
