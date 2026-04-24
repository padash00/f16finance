-- TZ inventory catalog model: Step 1 (DB migration only)
-- 1) Add location_type='catalog_total'
-- 2) Create catalog_total location per company with active point_display
-- 3) Zero out point_display balances (showcase becomes derived)

-- Expand allowed location types
alter table public.inventory_locations
  drop constraint if exists inventory_locations_location_type_check;

alter table public.inventory_locations
  add constraint inventory_locations_location_type_check
  check (location_type in ('warehouse', 'point_display', 'catalog_total'));

-- One catalog_total per company
create unique index if not exists inventory_locations_catalog_total_company_uidx
  on public.inventory_locations (company_id, location_type)
  where location_type = 'catalog_total' and company_id is not null;

-- Create catalog_total locations for companies where showcase is enabled
insert into public.inventory_locations (
  company_id,
  organization_id,
  name,
  code,
  location_type,
  is_active
)
select distinct
  pd.company_id,
  pd.organization_id,
  'Каталог - ' || coalesce(c.name, 'компания'),
  case
    when coalesce(c.code, '') <> '' then 'CT-' || c.code
    else 'CT-' || left(pd.company_id::text, 8)
  end,
  'catalog_total',
  true
from public.inventory_locations pd
left join public.companies c on c.id = pd.company_id
where pd.location_type = 'point_display'
  and pd.company_id is not null
  and pd.is_active = true
on conflict do nothing;

-- Normalize existing catalog_total rows (safe even if they were created earlier)
update public.inventory_locations ct
set
  organization_id = pd.organization_id,
  name = 'Каталог - ' || coalesce(c.name, 'компания'),
  code = case
    when coalesce(c.code, '') <> '' then 'CT-' || c.code
    else 'CT-' || left(pd.company_id::text, 8)
  end,
  is_active = true,
  updated_at = timezone('utc', now())
from public.inventory_locations pd
left join public.companies c on c.id = pd.company_id
where ct.company_id = pd.company_id
  and ct.location_type = 'catalog_total'
  and pd.location_type = 'point_display'
  and pd.company_id is not null
  and pd.is_active = true;

-- Clear physical showcase balances (showcase is derived from catalog_total - warehouse)
delete from public.inventory_balances
where location_id in (
  select id
  from public.inventory_locations
  where location_type = 'point_display'
);
