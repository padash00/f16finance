-- Simpler inventory model:
-- warehouse  = total stock (import destination, existing data unchanged)
-- backroom   = new type: items physically kept in back storage (subset of warehouse)
-- showcase   = warehouse - backroom (virtual, computed)
--
-- No data migration needed: backroom starts empty → showcase = warehouse (all on display)

-- 1. Allow 'backroom' as location_type
alter table public.inventory_locations
  drop constraint if exists inventory_locations_location_type_check;

alter table public.inventory_locations
  add constraint inventory_locations_location_type_check
  check (location_type in ('warehouse', 'point_display', 'catalog', 'backroom'));

-- 2. Unique index: one backroom per company
create unique index if not exists inventory_locations_backroom_company_uidx
  on public.inventory_locations (company_id, location_type)
  where location_type = 'backroom' and company_id is not null;

-- 3. Create backroom location for every company that has a warehouse
insert into public.inventory_locations (company_id, organization_id, name, code, location_type, is_active)
select
  wh.company_id,
  wh.organization_id,
  'Подсобка — ' || c.name,
  'BR-' || coalesce(c.code, left(wh.company_id::text, 8)),
  'backroom',
  true
from public.inventory_locations wh
join public.companies c on c.id = wh.company_id
where wh.location_type = 'warehouse'
  and wh.company_id is not null
on conflict do nothing;
