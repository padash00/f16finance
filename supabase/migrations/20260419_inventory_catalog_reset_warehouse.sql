-- After catalog migration: reset warehouse balances to 0
-- In the new model: catalog = total, warehouse = physical back-room allocation (default: 0)
-- showcase = catalog - warehouse (default: all stock on showcase)
--
-- WHY: previously "warehouse" held ALL stock (including display items).
-- Now "warehouse" means ONLY items physically kept in back storage.
-- Users will manually set warehouse allocation via the UI.

DELETE FROM public.inventory_balances
WHERE location_id IN (
  SELECT id FROM public.inventory_locations
  WHERE location_type = 'warehouse'
    AND company_id IS NOT NULL
);
