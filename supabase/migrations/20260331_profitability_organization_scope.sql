alter table if exists public.monthly_profitability_inputs
  add column if not exists organization_id uuid;

with first_org as (
  select id
  from public.organizations
  order by created_at asc, id asc
  limit 1
)
update public.monthly_profitability_inputs mpi
set organization_id = first_org.id
from first_org
where mpi.organization_id is null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'monthly_profitability_inputs'
      and column_name = 'organization_id'
  ) then
    alter table public.monthly_profitability_inputs
      alter column organization_id set not null;
  end if;
exception when others then
  null;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'monthly_profitability_inputs_organization_id_fkey'
  ) then
    alter table public.monthly_profitability_inputs
      add constraint monthly_profitability_inputs_organization_id_fkey
      foreign key (organization_id)
      references public.organizations(id)
      on delete cascade;
  end if;
end $$;

create index if not exists idx_monthly_profitability_inputs_organization_id
  on public.monthly_profitability_inputs(organization_id);

create unique index if not exists idx_monthly_profitability_inputs_org_month_unique
  on public.monthly_profitability_inputs(organization_id, month);
