-- Фикс Supabase database linter для миграций фичи «поставщики»:
--   1. inventory_consumption_rates — был SECURITY DEFINER view → переводим
--      на security_invoker (вью применяет RLS вызывающего, а не создателя).
--   2. inventory_purchase_orders / _items — не было RLS → включаем + SELECT
--      политика для authenticated по организации. Мутации идут через
--      service-role (admin client), который RLS обходит.

-- 1. View → security_invoker
alter view public.inventory_consumption_rates set (security_invoker = true);

-- 2. RLS на inventory_purchase_orders
alter table public.inventory_purchase_orders enable row level security;
drop policy if exists inventory_purchase_orders_select_same_org on public.inventory_purchase_orders;
create policy inventory_purchase_orders_select_same_org
on public.inventory_purchase_orders
for select
to authenticated
using (public.can_access_organization(organization_id));

-- 3. RLS на inventory_purchase_order_items (организация — через родительскую заявку)
alter table public.inventory_purchase_order_items enable row level security;
drop policy if exists inventory_purchase_order_items_select_same_org on public.inventory_purchase_order_items;
create policy inventory_purchase_order_items_select_same_org
on public.inventory_purchase_order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.inventory_purchase_orders o
    where o.id = order_id
      and public.can_access_organization(o.organization_id)
  )
);

notify pgrst, 'reload schema';
