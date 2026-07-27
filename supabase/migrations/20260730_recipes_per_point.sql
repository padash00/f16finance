-- Фаза 2: техкарты по точке. Колонка recipes.company_id уже существует
-- (20260612_production_recipes), но чтение её игнорировало. Бэкфиллим на
-- точку-магазин орг (как каталог), дальше код фильтрует по company_id.

with shop_point as (
  select o.id as organization_id,
         coalesce(ss.store_company_id,
           (select (array_agg(c.id))[1] from public.companies c where c.organization_id = o.id and c.store_enabled having count(*) = 1),
           (select l.company_id from public.inventory_locations l join public.companies c2 on c2.id = l.company_id where c2.organization_id = o.id and l.location_type = 'point_display' order by l.created_at limit 1)
         ) as company_id
  from public.organizations o left join public.store_settings ss on ss.organization_id = o.id
)
update public.recipes r set company_id = sp.company_id
  from shop_point sp
 where r.organization_id = sp.organization_id and r.company_id is null and sp.company_id is not null;

create index if not exists recipes_company_idx on public.recipes (company_id);

notify pgrst, 'reload schema';
