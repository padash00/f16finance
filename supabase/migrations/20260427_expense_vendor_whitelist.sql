-- Whitelist of trusted vendors for which expenses can be created without a receipt
-- (cleaner, doorman, regular utility services, etc.). Edited only by owner/superadmin.

create table if not exists public.expense_vendor_whitelist (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null,
  company_id uuid null,
  vendor_name text not null,
  default_category_id uuid null references public.expense_categories(id) on delete set null,
  notes text null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null
);

create index if not exists expense_vendor_whitelist_active_idx
  on public.expense_vendor_whitelist (organization_id, company_id)
  where archived_at is null;

create index if not exists expense_vendor_whitelist_vendor_idx
  on public.expense_vendor_whitelist (lower(vendor_name))
  where archived_at is null;

alter table public.expense_vendor_whitelist enable row level security;

drop policy if exists expense_vendor_whitelist_admin_all on public.expense_vendor_whitelist;
create policy expense_vendor_whitelist_admin_all
  on public.expense_vendor_whitelist
  for all
  to service_role
  using (true)
  with check (true);
