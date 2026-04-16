-- Allow per-company warehouse locations (one warehouse per company)
-- Previously warehouse uniqueness was only by name (global); now each company can have its own warehouse.

-- Drop the old global-warehouse-name unique index (it prevented per-company warehouses)
drop index if exists public.inventory_locations_warehouse_name_uidx;

-- Add unique index: one warehouse per company (company_id + location_type)
-- Partial index: only when company_id is not null (global warehouses without company_id remain allowed)
create unique index if not exists inventory_locations_warehouse_company_uidx
  on public.inventory_locations (company_id, location_type)
  where location_type = 'warehouse' and company_id is not null;

-- Keep a unique name index for global warehouses (company_id is null)
create unique index if not exists inventory_locations_warehouse_global_name_uidx
  on public.inventory_locations (lower(name), location_type)
  where location_type = 'warehouse' and company_id is null;
