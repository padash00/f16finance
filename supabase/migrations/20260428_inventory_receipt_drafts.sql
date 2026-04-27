create table if not exists public.inventory_receipt_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null,
  created_by uuid null,
  title text null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  posted_receipt_id uuid null references public.inventory_receipts(id) on delete set null
);

create index if not exists inventory_receipt_drafts_org_status_created_idx
  on public.inventory_receipt_drafts (organization_id, status, created_at desc);

create index if not exists inventory_receipt_drafts_created_by_idx
  on public.inventory_receipt_drafts (created_by, created_at desc);

drop trigger if exists trg_inventory_receipt_drafts_updated_at on public.inventory_receipt_drafts;
create trigger trg_inventory_receipt_drafts_updated_at
before update on public.inventory_receipt_drafts
for each row
execute function public.inventory_set_updated_at();
