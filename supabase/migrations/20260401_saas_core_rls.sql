create or replace function public.current_auth_email()
returns text
language sql
stable
as $$
  select nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')
$$;

create or replace function public.can_access_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = target_organization_id
      and om.status = 'active'
      and (
        om.user_id = auth.uid()
        or (
          public.current_auth_email() is not null
          and lower(coalesce(om.email, '')) = public.current_auth_email()
        )
      )
  )
$$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.tenant_domains enable row level security;
alter table if exists public.organization_billing_events enable row level security;

drop policy if exists organizations_select_same_org on public.organizations;
create policy organizations_select_same_org
on public.organizations
for select
to authenticated
using (public.can_access_organization(id));

drop policy if exists organization_members_select_same_org on public.organization_members;
create policy organization_members_select_same_org
on public.organization_members
for select
to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists organization_subscriptions_select_same_org on public.organization_subscriptions;
create policy organization_subscriptions_select_same_org
on public.organization_subscriptions
for select
to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists tenant_domains_select_same_org on public.tenant_domains;
create policy tenant_domains_select_same_org
on public.tenant_domains
for select
to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists organization_billing_events_select_same_org on public.organization_billing_events;
create policy organization_billing_events_select_same_org
on public.organization_billing_events
for select
to authenticated
using (public.can_access_organization(organization_id));
