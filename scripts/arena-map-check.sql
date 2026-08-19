-- Почему карта в Orda выглядит иначе, чем в операторской программе.
-- Только чтение.

-- 1. Сколько станций вообще размещено на карте Orda.
--    Если размещено мало — карта просто не заполнена, и это не поломка.
select count(*)                                                      as всего,
       count(*) filter (where grid_x is not null and grid_y is not null) as на_карте,
       count(*) filter (where grid_x is null or grid_y is null)          as без_координат
  from public.arena_stations
 where point_project_id = '5ff1c91d-92d1-4a38-ad53-347df71e0bf2';

-- 2. Не наложены ли станции друг на друга.
--    Две станции в одной клетке визуально сливаются в одну.
select grid_x, grid_y, count(*) as станций, string_agg(name, ', ' order by name) as какие
  from public.arena_stations
 where point_project_id = '5ff1c91d-92d1-4a38-ad53-347df71e0bf2'
   and grid_x is not null and grid_y is not null
 group by grid_x, grid_y
having count(*) > 1
 order by count(*) desc
 limit 20;

-- 3. Не вышли ли координаты за пределы сетки 24 x 14.
--    Всё, что за границей, рисуется за краем экрана и выглядит как пропажа.
select name, grid_x, grid_y
  from public.arena_stations
 where point_project_id = '5ff1c91d-92d1-4a38-ad53-347df71e0bf2'
   and (grid_x >= 24 or grid_y >= 14 or grid_x < 0 or grid_y < 0)
 order by grid_x, grid_y;

-- 4. Где стоят зоны и попадают ли станции внутрь своих зон.
select z.name                              as зона,
       z.grid_x, z.grid_y, z.grid_w, z.grid_h,
       count(s.id)                         as станций_в_зоне,
       count(s.id) filter (
         where s.grid_x between z.grid_x and z.grid_x + z.grid_w - 1
           and s.grid_y between z.grid_y and z.grid_y + z.grid_h - 1
       )                                   as попадают_внутрь
  from public.arena_zones z
  left join public.arena_stations s on s.zone_id = z.id and s.grid_x is not null
 where z.point_project_id = '5ff1c91d-92d1-4a38-ad53-347df71e0bf2'
 group by z.id, z.name, z.grid_x, z.grid_y, z.grid_w, z.grid_h
 order by z.name;
