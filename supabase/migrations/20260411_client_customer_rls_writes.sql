-- Client bookings/support inserts use the end-user JWT. `can_access_company` depends on
-- `organization_members` and is false for customers, so inserts always failed RLS.
-- Tie writes to the customer's own `customers.company_id` instead.

create or replace function public.customer_own_company_row(p_customer_id uuid, p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.customers c
    where c.id = p_customer_id
      and c.auth_user_id = auth.uid()
      and c.is_active = true
      and c.company_id is not null
      and c.company_id = p_company_id
  );
$$;

drop policy if exists client_bookings_customer_insert on public.client_bookings;
create policy client_bookings_customer_insert
on public.client_bookings
for insert
to authenticated
with check (
  company_id is not null
  and public.customer_own_company_row(customer_id, company_id)
);

drop policy if exists client_support_tickets_customer_insert on public.client_support_tickets;
create policy client_support_tickets_customer_insert
on public.client_support_tickets
for insert
to authenticated
with check (
  company_id is not null
  and public.customer_own_company_row(customer_id, company_id)
);

-- Outbox rows are created by the same customer session; there was no INSERT policy for customers.
drop policy if exists client_notification_outbox_customer_insert on public.client_notification_outbox;
create policy client_notification_outbox_customer_insert
on public.client_notification_outbox
for insert
to authenticated
with check (public.customer_link_matches_auth(customer_id));
