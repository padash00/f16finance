alter table public.inventory_requests
  add column if not exists received_by uuid null;

