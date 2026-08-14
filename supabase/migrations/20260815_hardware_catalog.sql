-- Справочник железа: видеокарты, процессоры, память, мониторы, периферия, кресла.
--
-- Раньше характеристики зоны вводились строкой руками, и в базе оказывалось
-- «rtx4060», «RTX 4060», «RTX4060 8gb» — по таким данным ни вопрос собрать, ни
-- клиенту ответить. Здесь общий каталог моделей: выбираешь из списка, а своё
-- значение всё равно можно вписать — новинки выходят чаще, чем мы обновляем
-- справочник.

create table if not exists public.hardware_catalog (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('gpu', 'cpu', 'ram', 'monitor', 'mouse', 'keyboard', 'headset', 'chair')),
  brand       text not null,
  model       text not null,
  -- Для мониторов: { "hz": 240, "resolution": "QHD" } — частота подставляется
  -- в зону автоматически, чтобы её не вбивали второй раз руками.
  meta        jsonb not null default '{}'::jsonb,
  is_active   boolean not null default true,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now()
);

comment on table public.hardware_catalog is 'Общий справочник моделей железа для карточек зон';

create unique index if not exists hardware_catalog_kind_model_uidx
  on public.hardware_catalog (kind, model);
create index if not exists hardware_catalog_kind_idx
  on public.hardware_catalog (kind, brand, sort_order);

alter table public.hardware_catalog enable row level security;

-- Справочник общий для всех организаций: моделью видеокарты никто не владеет.
drop policy if exists hardware_catalog_read on public.hardware_catalog;
create policy hardware_catalog_read
  on public.hardware_catalog for select
  to authenticated
  using (true);

-- Периферия по отдельности: «мышь, клава, гарнитура» одной строкой не годится
-- ни для выбора из списка, ни для вопроса «какая мышь в этой зоне».
alter table public.arena_zones
  add column if not exists mouse text,
  add column if not exists keyboard text,
  add column if not exists headset text,
  add column if not exists chair text;
