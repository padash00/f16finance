-- Этап 3 фичи «поставщики»: заявки поставщикам (заказы на закуп).
--
-- Отдельная сущность от inventory_requests (те — перемещение склад→витрина).
-- Заявка поставщику = «надо докупить эти позиции у этого поставщика».
-- Создаётся вручную (этап 3) или автоматически кроном по остаткам (этап 4).
-- Отправляется торгпреду через WhatsApp-ссылку (этап 5).

create table if not exists public.inventory_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.inventory_suppliers(id) on delete restrict,
  organization_id uuid null references public.organizations(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'received', 'cancelled')),
  is_auto boolean not null default false,
  comment text null,
  created_by uuid null,
  sent_at timestamptz null,
  received_at timestamptz null,
  cancelled_at timestamptz null,
  cancel_reason text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists inventory_purchase_orders_supplier_idx
  on public.inventory_purchase_orders (supplier_id, created_at desc);

create index if not exists inventory_purchase_orders_org_status_idx
  on public.inventory_purchase_orders (organization_id, status, created_at desc);

create table if not exists public.inventory_purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.inventory_purchase_orders(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  current_qty numeric(14, 3) not null default 0,   -- остаток на момент создания заявки
  threshold numeric(14, 3) null,                    -- порог, который сработал (для авто-заявок)
  suggested_qty numeric(14, 3) not null check (suggested_qty > 0),  -- сколько заказать
  comment text null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists inventory_purchase_order_items_order_idx
  on public.inventory_purchase_order_items (order_id);

drop trigger if exists trg_inventory_purchase_orders_updated_at on public.inventory_purchase_orders;
create trigger trg_inventory_purchase_orders_updated_at
before update on public.inventory_purchase_orders
for each row
execute function public.inventory_set_updated_at();

notify pgrst, 'reload schema';
