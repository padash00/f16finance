-- Physical split: warehouse + point_display, remove catalog/backroom.

-- 1) Fill point_display from old virtual showcase formula.
insert into public.inventory_balances (location_id, item_id, quantity, updated_at)
select
  pd.id as location_id,
  ib_w.item_id,
  greatest(0, ib_w.quantity - coalesce(ib_b.quantity, 0)) as quantity,
  now()
from public.inventory_locations pd
join public.inventory_locations wh
  on wh.company_id = pd.company_id
 and wh.location_type = 'warehouse'
join public.inventory_balances ib_w on ib_w.location_id = wh.id
left join public.inventory_locations br
  on br.company_id = pd.company_id
 and br.location_type = 'backroom'
left join public.inventory_balances ib_b
  on ib_b.location_id = br.id
 and ib_b.item_id = ib_w.item_id
where pd.location_type = 'point_display'
  and pd.company_id is not null
on conflict (location_id, item_id)
  do update set quantity = excluded.quantity, updated_at = now();

-- 2) Re-point warehouse balances to old backroom quantity.
update public.inventory_balances ib
set quantity = coalesce((
  select ib_b.quantity
  from public.inventory_locations br
  join public.inventory_balances ib_b
    on ib_b.location_id = br.id
   and ib_b.item_id = ib.item_id
  where br.company_id = wh.company_id
    and br.location_type = 'backroom'
  limit 1
), 0), updated_at = now()
from public.inventory_locations wh
where ib.location_id = wh.id
  and wh.location_type = 'warehouse';

-- 3) Remove balances for deprecated location types.
delete from public.inventory_balances
where location_id in (
  select id from public.inventory_locations
  where location_type in ('backroom', 'catalog')
);

-- 4) Keep history by remapping deprecated locations to warehouse.
update public.inventory_movements m
set from_location_id = wh.id
from public.inventory_locations old, public.inventory_locations wh
where m.from_location_id = old.id
  and old.location_type in ('backroom', 'catalog')
  and wh.company_id = old.company_id
  and wh.location_type = 'warehouse';

update public.inventory_movements m
set to_location_id = wh.id
from public.inventory_locations old, public.inventory_locations wh
where m.to_location_id = old.id
  and old.location_type in ('backroom', 'catalog')
  and wh.company_id = old.company_id
  and wh.location_type = 'warehouse';

update public.inventory_receipts r
set location_id = wh.id
from public.inventory_locations old, public.inventory_locations wh
where r.location_id = old.id
  and old.location_type in ('backroom', 'catalog')
  and wh.company_id = old.company_id
  and wh.location_type = 'warehouse';

update public.inventory_writeoffs w
set location_id = wh.id
from public.inventory_locations old, public.inventory_locations wh
where w.location_id = old.id
  and old.location_type in ('backroom', 'catalog')
  and wh.company_id = old.company_id
  and wh.location_type = 'warehouse';

update public.inventory_stocktakes s
set location_id = wh.id
from public.inventory_locations old, public.inventory_locations wh
where s.location_id = old.id
  and old.location_type in ('backroom', 'catalog')
  and wh.company_id = old.company_id
  and wh.location_type = 'warehouse';

-- 5) Remove deprecated locations.
delete from public.inventory_locations
where location_type in ('backroom', 'catalog');

alter table public.inventory_locations
  drop constraint if exists inventory_locations_location_type_check;

alter table public.inventory_locations
  add constraint inventory_locations_location_type_check
  check (location_type in ('warehouse', 'point_display'));
