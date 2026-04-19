-- Add 'catalog' location type: stores total stock (imported from Wipon/external POS)
-- showcase_qty = catalog_qty - warehouse_qty (virtual, computed on read)

-- 1. Expand CHECK constraint to allow 'catalog'
alter table public.inventory_locations
  drop constraint if exists inventory_locations_location_type_check;

alter table public.inventory_locations
  add constraint inventory_locations_location_type_check
  check (location_type in ('warehouse', 'point_display', 'catalog'));

-- 2. Unique index: one catalog per company
create unique index if not exists inventory_locations_catalog_company_uidx
  on public.inventory_locations (company_id, location_type)
  where location_type = 'catalog' and company_id is not null;

-- 3. Create catalog locations for every company that already has a warehouse
insert into public.inventory_locations (company_id, organization_id, name, code, location_type, is_active)
select
  wh.company_id,
  wh.organization_id,
  'Каталог — ' || c.name,
  'CAT-' || coalesce(c.code, left(wh.company_id::text, 8)),
  'catalog',
  true
from public.inventory_locations wh
join public.companies c on c.id = wh.company_id
where wh.location_type = 'warehouse'
  and wh.company_id is not null
on conflict do nothing;

-- 4. Migrate balances: catalog = warehouse + point_display per item per company
insert into public.inventory_balances (location_id, item_id, quantity, updated_at)
select
  cat.id              as location_id,
  ib.item_id,
  sum(ib.quantity)    as quantity,
  now()
from public.inventory_locations cat
join public.inventory_locations loc
  on loc.company_id = cat.company_id
 and loc.location_type in ('warehouse', 'point_display')
join public.inventory_balances ib on ib.location_id = loc.id
where cat.location_type = 'catalog'
  and cat.company_id is not null
group by cat.id, ib.item_id
on conflict (location_id, item_id)
do update set quantity = excluded.quantity, updated_at = now();
