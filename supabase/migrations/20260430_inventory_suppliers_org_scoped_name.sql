-- Replace global supplier-name uniqueness with organization-scoped uniqueness.
-- The legacy `inventory_suppliers_name_uidx` (lower(name) globally) blocked
-- different tenants from registering suppliers with the same name and also
-- blocked same-tenant suppliers that share a name but differ by BIN/IIN.

drop index if exists public.inventory_suppliers_name_uidx;

create unique index if not exists inventory_suppliers_org_name_uidx
  on public.inventory_suppliers (organization_id, lower(name));
