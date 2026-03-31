create table if not exists public.organization_billing_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.organization_subscriptions(id) on delete set null,
  event_type text not null,
  status text,
  amount numeric(12,2),
  currency text,
  billing_period text,
  note text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_organization_billing_events_org_created_at
  on public.organization_billing_events(organization_id, created_at desc);

create index if not exists idx_organization_billing_events_subscription
  on public.organization_billing_events(subscription_id);
