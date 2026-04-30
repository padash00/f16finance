-- Allow receipt purchase prices to keep fractional unit cost precision.
-- Line totals, expenses, and debts still round to 2 decimals in the posting RPC.

alter table if exists public.inventory_receipt_items
  alter column unit_cost type numeric(14, 4)
  using round(unit_cost::numeric, 4);

alter table if exists public.inventory_movements
  alter column unit_cost type numeric(14, 4)
  using case when unit_cost is null then null else round(unit_cost::numeric, 4) end;

alter table if exists public.inventory_items
  alter column default_purchase_price type numeric(14, 4)
  using round(default_purchase_price::numeric, 4);

alter table if exists public.inventory_writeoff_items
  alter column unit_cost type numeric(14, 4)
  using round(unit_cost::numeric, 4);
