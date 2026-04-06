-- Link Supabase auth users to loyalty/customer rows for the guest (client) app contour.
-- Binding auth_user_id is expected via service role / staff flows, not by the end user.

alter table public.customers
  add column if not exists auth_user_id uuid null references auth.users (id) on delete set null;

create unique index if not exists customers_company_auth_user_uidx
  on public.customers (company_id, auth_user_id)
  where auth_user_id is not null and company_id is not null;

create index if not exists customers_auth_user_id_idx
  on public.customers (auth_user_id)
  where auth_user_id is not null;

comment on column public.customers.auth_user_id is 'Supabase auth user linked to this customer (guest login); set via admin/service.';

drop policy if exists customers_select_self on public.customers;
create policy customers_select_self
on public.customers
for select
to authenticated
using (auth_user_id is not null and auth_user_id = auth.uid());
