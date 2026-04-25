-- Phase 1: привязка операций к смене.
-- shift_id добавляется как nullable (исторические данные останутся без него).

alter table public.point_sales
  add column if not exists shift_id uuid null references public.point_shifts(id) on delete set null;

alter table public.point_returns
  add column if not exists shift_id uuid null references public.point_shifts(id) on delete set null;

alter table public.inventory_requests
  add column if not exists shift_id uuid null references public.point_shifts(id) on delete set null;

alter table public.inventory_movements
  add column if not exists shift_id uuid null references public.point_shifts(id) on delete set null;

create index if not exists idx_point_sales_shift on public.point_sales(shift_id) where shift_id is not null;
create index if not exists idx_point_returns_shift on public.point_returns(shift_id) where shift_id is not null;
create index if not exists idx_inventory_requests_shift on public.inventory_requests(shift_id) where shift_id is not null;
create index if not exists idx_inventory_movements_shift on public.inventory_movements(shift_id) where shift_id is not null;
