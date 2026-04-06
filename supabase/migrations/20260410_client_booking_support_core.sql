-- Phase 4: dedicated customer bookings and support tickets with statuses.

create or replace function public.customer_link_matches_auth(target_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.customers c
    where c.id = target_customer_id
      and c.auth_user_id = auth.uid()
      and c.is_active = true
  )
$$;

create table if not exists public.client_bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz null,
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'cancelled', 'completed', 'rejected')),
  notes text null,
  source text not null default 'client_app',
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.client_support_tickets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  subject text null,
  message text not null,
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  created_by uuid null references auth.users(id) on delete set null,
  assigned_staff_id uuid null references public.staff(id) on delete set null,
  resolved_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.client_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  ticket_id uuid null references public.client_support_tickets(id) on delete cascade,
  channel text not null check (channel in ('push', 'telegram', 'email', 'in_app')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  last_error text null,
  scheduled_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_client_bookings_customer_starts
  on public.client_bookings(customer_id, starts_at desc);
create index if not exists idx_client_bookings_company_status
  on public.client_bookings(company_id, status);

create index if not exists idx_client_support_tickets_customer_created
  on public.client_support_tickets(customer_id, created_at desc);
create index if not exists idx_client_support_tickets_company_status
  on public.client_support_tickets(company_id, status);

create index if not exists idx_client_notification_outbox_ticket
  on public.client_notification_outbox(ticket_id);
create index if not exists idx_client_notification_outbox_customer_status
  on public.client_notification_outbox(customer_id, status, scheduled_at);

drop trigger if exists trg_client_bookings_updated_at on public.client_bookings;
create trigger trg_client_bookings_updated_at
before update on public.client_bookings
for each row
execute function public.update_updated_at_column();

drop trigger if exists trg_client_support_tickets_updated_at on public.client_support_tickets;
create trigger trg_client_support_tickets_updated_at
before update on public.client_support_tickets
for each row
execute function public.update_updated_at_column();

alter table if exists public.client_bookings enable row level security;
alter table if exists public.client_support_tickets enable row level security;
alter table if exists public.client_notification_outbox enable row level security;

-- customer policies

drop policy if exists client_bookings_customer_select on public.client_bookings;
create policy client_bookings_customer_select
on public.client_bookings
for select
to authenticated
using (public.customer_link_matches_auth(customer_id));

drop policy if exists client_bookings_customer_insert on public.client_bookings;
create policy client_bookings_customer_insert
on public.client_bookings
for insert
to authenticated
with check (
  public.customer_link_matches_auth(customer_id)
  and company_id is not null
  and public.can_access_company(company_id)
);

drop policy if exists client_bookings_customer_update on public.client_bookings;
create policy client_bookings_customer_update
on public.client_bookings
for update
to authenticated
using (public.customer_link_matches_auth(customer_id))
with check (public.customer_link_matches_auth(customer_id));

drop policy if exists client_support_tickets_customer_select on public.client_support_tickets;
create policy client_support_tickets_customer_select
on public.client_support_tickets
for select
to authenticated
using (public.customer_link_matches_auth(customer_id));

drop policy if exists client_support_tickets_customer_insert on public.client_support_tickets;
create policy client_support_tickets_customer_insert
on public.client_support_tickets
for insert
to authenticated
with check (
  public.customer_link_matches_auth(customer_id)
  and company_id is not null
  and public.can_access_company(company_id)
);

drop policy if exists client_notification_outbox_customer_select on public.client_notification_outbox;
create policy client_notification_outbox_customer_select
on public.client_notification_outbox
for select
to authenticated
using (public.customer_link_matches_auth(customer_id));

-- staff/operator/super-admin policies via company access

drop policy if exists client_bookings_company_select on public.client_bookings;
create policy client_bookings_company_select
on public.client_bookings
for select
to authenticated
using (public.can_access_company(company_id));

drop policy if exists client_bookings_company_update on public.client_bookings;
create policy client_bookings_company_update
on public.client_bookings
for update
to authenticated
using (public.can_access_company(company_id))
with check (public.can_access_company(company_id));

drop policy if exists client_support_tickets_company_select on public.client_support_tickets;
create policy client_support_tickets_company_select
on public.client_support_tickets
for select
to authenticated
using (public.can_access_company(company_id));

drop policy if exists client_support_tickets_company_update on public.client_support_tickets;
create policy client_support_tickets_company_update
on public.client_support_tickets
for update
to authenticated
using (public.can_access_company(company_id))
with check (public.can_access_company(company_id));

drop policy if exists client_notification_outbox_company_select on public.client_notification_outbox;
create policy client_notification_outbox_company_select
on public.client_notification_outbox
for select
to authenticated
using (
  customer_id is not null
  and exists (
    select 1
    from public.customers c
    where c.id = client_notification_outbox.customer_id
      and c.company_id is not null
      and public.can_access_company(c.company_id)
  )
);

drop policy if exists client_notification_outbox_company_insert on public.client_notification_outbox;
create policy client_notification_outbox_company_insert
on public.client_notification_outbox
for insert
to authenticated
with check (
  customer_id is not null
  and exists (
    select 1
    from public.customers c
    where c.id = client_notification_outbox.customer_id
      and c.company_id is not null
      and public.can_access_company(c.company_id)
  )
);
