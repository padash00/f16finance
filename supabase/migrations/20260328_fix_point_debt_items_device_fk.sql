-- Fix FK: point_debt_items.point_device_id was referencing point_devices(id)
-- but the system now uses point_projects(id) as the device identity.
-- Existing rows contain old point_devices UUIDs that don't exist in point_projects,
-- so we cannot add a new FK constraint without orphan cleanup.
-- Solution: drop the old FK and keep the column as a plain UUID reference.
-- The column still stores the point_projects.id for querying; just no DB-level constraint.

alter table public.point_debt_items
  drop constraint if exists point_debt_items_point_device_id_fkey;
