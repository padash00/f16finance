do $$
declare
  default_org_id uuid;
begin
  select id
    into default_org_id
  from public.organizations
  order by created_at asc
  limit 1;

  if default_org_id is null then
    raise exception 'inventory organization scope requires at least one organization';
  end if;

  alter table public.inventory_categories
    add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

  alter table public.inventory_suppliers
    add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

  alter table public.inventory_items
    add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

  alter table public.inventory_locations
    add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

  update public.inventory_categories
     set organization_id = coalesce(organization_id, default_org_id)
   where organization_id is null;

  update public.inventory_suppliers
     set organization_id = coalesce(organization_id, default_org_id)
   where organization_id is null;

  update public.inventory_items
     set organization_id = coalesce(organization_id, default_org_id)
   where organization_id is null;

  update public.inventory_locations loc
     set organization_id = coalesce(
       loc.organization_id,
       comp.organization_id,
       default_org_id
     )
    from public.companies comp
   where loc.organization_id is null
     and comp.id = loc.company_id;

  update public.inventory_locations
     set organization_id = default_org_id
   where organization_id is null;

  alter table public.inventory_categories
    alter column organization_id set not null;

  alter table public.inventory_suppliers
    alter column organization_id set not null;

  alter table public.inventory_items
    alter column organization_id set not null;

  alter table public.inventory_locations
    alter column organization_id set not null;

  create index if not exists inventory_categories_organization_id_idx
    on public.inventory_categories (organization_id);

  create index if not exists inventory_suppliers_organization_id_idx
    on public.inventory_suppliers (organization_id);

  create index if not exists inventory_items_organization_id_idx
    on public.inventory_items (organization_id);

  create index if not exists inventory_locations_organization_id_idx
    on public.inventory_locations (organization_id);
end $$;
