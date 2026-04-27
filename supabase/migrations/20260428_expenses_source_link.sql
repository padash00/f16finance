alter table if exists public.expenses
  add column if not exists source_type text null,
  add column if not exists source_id uuid null;

create index if not exists expenses_source_idx
  on public.expenses (source_type, source_id);

create unique index if not exists expenses_inventory_receipt_source_uidx
  on public.expenses (source_type, source_id)
  where source_type = 'inventory_receipt' and source_id is not null;
