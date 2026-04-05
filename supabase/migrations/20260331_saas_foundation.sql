create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  legal_name text,
  status text not null default 'active',
  branding jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_status_check check (status in ('active', 'trial', 'suspended', 'archived'))
);

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  status text not null default 'active',
  price_monthly numeric(12,2) not null default 0,
  price_yearly numeric(12,2),
  currency text not null default 'KZT',
  limits jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_plans_status_check check (status in ('active', 'archived'))
);

create table if not exists public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status text not null default 'active',
  billing_period text not null default 'monthly',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  cancel_at timestamptz,
  external_customer_id text,
  external_subscription_id text,
  limits_override jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_subscriptions_status_check check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  constraint organization_subscriptions_period_check check (billing_period in ('monthly', 'yearly', 'custom'))
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  role text not null default 'other',
  status text not null default 'active',
  is_default boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_members_role_check check (role in ('owner', 'manager', 'marketer', 'other')),
  constraint organization_members_status_check check (status in ('invited', 'active', 'inactive'))
);

create table if not exists public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  host text not null unique,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_organization_subscriptions_org_id
  on public.organization_subscriptions(organization_id);

create index if not exists idx_organization_members_org_id
  on public.organization_members(organization_id);

create index if not exists idx_organization_members_user_id
  on public.organization_members(user_id);

create index if not exists idx_organization_members_staff_id
  on public.organization_members(staff_id);

create unique index if not exists idx_organization_members_org_staff_unique
  on public.organization_members(organization_id, staff_id)
  where staff_id is not null;

create unique index if not exists idx_organization_members_org_user_unique
  on public.organization_members(organization_id, user_id)
  where user_id is not null;

create unique index if not exists idx_organization_members_org_email_unique
  on public.organization_members(organization_id, lower(email))
  where email is not null;

create unique index if not exists idx_tenant_domains_primary_unique
  on public.tenant_domains(organization_id)
  where is_primary = true;

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at
before update on public.organizations
for each row
execute function public.update_updated_at_column();

drop trigger if exists trg_subscription_plans_updated_at on public.subscription_plans;
create trigger trg_subscription_plans_updated_at
before update on public.subscription_plans
for each row
execute function public.update_updated_at_column();

drop trigger if exists trg_organization_subscriptions_updated_at on public.organization_subscriptions;
create trigger trg_organization_subscriptions_updated_at
before update on public.organization_subscriptions
for each row
execute function public.update_updated_at_column();

drop trigger if exists trg_organization_members_updated_at on public.organization_members;
create trigger trg_organization_members_updated_at
before update on public.organization_members
for each row
execute function public.update_updated_at_column();

drop trigger if exists trg_tenant_domains_updated_at on public.tenant_domains;
create trigger trg_tenant_domains_updated_at
before update on public.tenant_domains
for each row
execute function public.update_updated_at_column();

alter table if exists public.companies
  add column if not exists organization_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'companies_organization_id_fkey'
  ) then
    alter table public.companies
      add constraint companies_organization_id_fkey
      foreign key (organization_id)
      references public.organizations(id)
      on delete restrict;
  end if;
end $$;

create index if not exists idx_companies_organization_id
  on public.companies(organization_id);

insert into public.organizations (
  name,
  slug,
  legal_name,
  status,
  branding,
  settings
)
values (
  'F16',
  'f16',
  'F16',
  'active',
  jsonb_build_object('product_name', 'Orda Control', 'legacy_brand', 'F16'),
  jsonb_build_object('bootstrap_source', 'legacy-single-tenant')
)
on conflict (slug) do update
set
  name = excluded.name,
  legal_name = excluded.legal_name,
  status = excluded.status,
  branding = public.organizations.branding || excluded.branding,
  settings = public.organizations.settings || excluded.settings;

with f16_org as (
  select id
  from public.organizations
  where slug = 'f16'
  limit 1
)
update public.companies c
set organization_id = f16_org.id
from f16_org
where c.organization_id is null;

insert into public.subscription_plans (
  code,
  name,
  description,
  status,
  price_monthly,
  price_yearly,
  currency,
  limits,
  features
)
values
  (
    'starter',
    'Starter',
    'Базовый тариф для одной организации с ограниченным числом точек.',
    'active',
    49000,
    490000,
    'KZT',
    jsonb_build_object('companies', 3, 'staff', 25, 'operators', 60),
    jsonb_build_object('telegram', true, 'excel_exports', true, 'web_pos', false, 'inventory', false)
  ),
  (
    'growth',
    'Growth',
    'Основной тариф для растущей сети точек.',
    'active',
    99000,
    990000,
    'KZT',
    jsonb_build_object('companies', 10, 'staff', 80, 'operators', 200),
    jsonb_build_object('telegram', true, 'excel_exports', true, 'web_pos', true, 'inventory', true, 'ai_reports', true)
  ),
  (
    'enterprise',
    'Enterprise',
    'Расширенный тариф без жёстких лимитов для сети и франшиз.',
    'active',
    199000,
    1990000,
    'KZT',
    jsonb_build_object('companies', 999, 'staff', 999, 'operators', 9999),
    jsonb_build_object('telegram', true, 'excel_exports', true, 'web_pos', true, 'inventory', true, 'ai_reports', true, 'custom_branding', true)
  )
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  price_monthly = excluded.price_monthly,
  price_yearly = excluded.price_yearly,
  currency = excluded.currency,
  limits = excluded.limits,
  features = excluded.features;

insert into public.organization_subscriptions (
  organization_id,
  plan_id,
  status,
  billing_period,
  starts_at,
  metadata
)
select
  org.id,
  plan.id,
  'active',
  'monthly',
  now(),
  jsonb_build_object('bootstrap_source', 'legacy-f16')
from public.organizations org
join public.subscription_plans plan
  on plan.code = 'growth'
where org.slug = 'f16'
  and not exists (
    select 1
    from public.organization_subscriptions existing
    where existing.organization_id = org.id
      and existing.status in ('trialing', 'active', 'past_due')
  );

insert into public.organization_members (
  organization_id,
  staff_id,
  email,
  role,
  status,
  is_default,
  metadata
)
select
  org.id,
  s.id,
  nullif(lower(trim(coalesce(s.email, ''))), ''),
  case
    when s.role in ('owner', 'manager', 'marketer', 'other') then s.role
    else 'other'
  end,
  case
    when coalesce(s.is_active, true) then 'active'
    else 'inactive'
  end,
  true,
  jsonb_build_object('bootstrap_source', 'legacy-staff-sync')
from public.organizations org
cross join public.staff s
where org.slug = 'f16'
  and not exists (
    select 1
    from public.organization_members om
    where om.organization_id = org.id
      and om.staff_id = s.id
  );

insert into public.tenant_domains (
  organization_id,
  host,
  is_primary
)
select
  org.id,
  'f16',
  true
from public.organizations org
where org.slug = 'f16'
  and not exists (
    select 1
    from public.tenant_domains td
    where td.organization_id = org.id
      and td.host = 'f16'
  );
