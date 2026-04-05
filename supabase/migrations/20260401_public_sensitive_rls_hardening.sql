create or replace function public.can_access_company(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.companies c
    where c.id = target_company_id
      and c.organization_id is not null
      and public.can_access_organization(c.organization_id)
  )
$$;

create or replace function public.can_access_inventory_location(target_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.inventory_locations l
    where l.id = target_location_id
      and public.can_access_organization(l.organization_id)
  )
$$;

create or replace function public.can_access_inventory_item(target_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.inventory_items i
    where i.id = target_item_id
      and public.can_access_organization(i.organization_id)
  )
$$;

create or replace function public.can_access_inventory_receipt(target_receipt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.inventory_receipts r
    join public.inventory_locations l on l.id = r.location_id
    where r.id = target_receipt_id
      and public.can_access_organization(l.organization_id)
  )
$$;

create or replace function public.can_access_inventory_request(target_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.inventory_requests r
    where r.id = target_request_id
      and (
        public.can_access_company(r.requesting_company_id)
        or public.can_access_inventory_location(r.source_location_id)
        or public.can_access_inventory_location(r.target_location_id)
      )
  )
$$;

create or replace function public.can_access_inventory_stocktake(target_stocktake_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.inventory_stocktakes s
    where s.id = target_stocktake_id
      and public.can_access_inventory_location(s.location_id)
  )
$$;

create or replace function public.can_access_inventory_writeoff(target_writeoff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.inventory_writeoffs w
    where w.id = target_writeoff_id
      and public.can_access_inventory_location(w.location_id)
  )
$$;

create or replace function public.can_access_point_device(target_device_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.point_devices d
    where d.id = target_device_id
      and public.can_access_company(d.company_id)
  )
$$;

create or replace function public.can_access_point_sale(target_sale_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.point_sales s
    where s.id = target_sale_id
      and (
        public.can_access_company(s.company_id)
        or public.can_access_inventory_location(s.location_id)
      )
  )
$$;

create or replace function public.can_access_point_return(target_return_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.point_returns r
    where r.id = target_return_id
      and (
        public.can_access_company(r.company_id)
        or public.can_access_inventory_location(r.location_id)
      )
  )
$$;

create or replace function public.can_access_salary_week(target_salary_week_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.operator_salary_week_company_allocations a
    where a.salary_week_id = target_salary_week_id
      and public.can_access_company(a.company_id)
  )
$$;

create or replace function public.can_access_salary_payment(target_payment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.operator_salary_week_payments p
    where p.id = target_payment_id
      and public.can_access_salary_week(p.salary_week_id)
  )
$$;

alter table if exists public.companies enable row level security;
alter table if exists public.subscription_plans enable row level security;
alter table if exists public.customers enable row level security;
alter table if exists public.discounts enable row level security;
alter table if exists public.loyalty_config enable row level security;
alter table if exists public.point_devices enable row level security;
alter table if exists public.point_products enable row level security;
alter table if exists public.point_debt_items enable row level security;
alter table if exists public.inventory_categories enable row level security;
alter table if exists public.inventory_suppliers enable row level security;
alter table if exists public.inventory_items enable row level security;
alter table if exists public.inventory_locations enable row level security;
alter table if exists public.inventory_balances enable row level security;
alter table if exists public.inventory_receipts enable row level security;
alter table if exists public.inventory_receipt_items enable row level security;
alter table if exists public.inventory_requests enable row level security;
alter table if exists public.inventory_request_items enable row level security;
alter table if exists public.inventory_movements enable row level security;
alter table if exists public.inventory_stocktakes enable row level security;
alter table if exists public.inventory_stocktake_items enable row level security;
alter table if exists public.inventory_writeoffs enable row level security;
alter table if exists public.inventory_writeoff_items enable row level security;
alter table if exists public.invoice_name_mappings enable row level security;
alter table if exists public.telegram_invoice_sessions enable row level security;
alter table if exists public.telegram_chat_history enable row level security;
alter table if exists public.low_stock_alert_log enable row level security;
alter table if exists public.point_sales enable row level security;
alter table if exists public.point_sale_items enable row level security;
alter table if exists public.point_returns enable row level security;
alter table if exists public.point_return_items enable row level security;
alter table if exists public.shift_week_publications enable row level security;
alter table if exists public.shift_operator_week_responses enable row level security;
alter table if exists public.shift_change_requests enable row level security;
alter table if exists public.operator_salary_weeks enable row level security;
alter table if exists public.operator_salary_week_company_allocations enable row level security;
alter table if exists public.operator_salary_week_payments enable row level security;
alter table if exists public.operator_salary_week_payment_expenses enable row level security;
alter table if exists public.app_settings enable row level security;
alter table if exists public.report_snapshots enable row level security;
alter table if exists public.audit_log enable row level security;
alter table if exists public.notification_log enable row level security;
alter table if exists public.arena_tech_logs enable row level security;

drop policy if exists companies_select_same_org on public.companies;
create policy companies_select_same_org
on public.companies
for select
to authenticated
using (
  organization_id is not null
  and public.can_access_organization(organization_id)
);

drop policy if exists subscription_plans_select_authenticated on public.subscription_plans;
create policy subscription_plans_select_authenticated
on public.subscription_plans
for select
to authenticated
using (true);

drop policy if exists customers_select_same_company on public.customers;
create policy customers_select_same_company
on public.customers
for select
to authenticated
using (
  company_id is not null
  and public.can_access_company(company_id)
);

drop policy if exists discounts_select_same_company on public.discounts;
create policy discounts_select_same_company
on public.discounts
for select
to authenticated
using (
  company_id is not null
  and public.can_access_company(company_id)
);

drop policy if exists loyalty_config_select_same_company on public.loyalty_config;
create policy loyalty_config_select_same_company
on public.loyalty_config
for select
to authenticated
using (public.can_access_company(company_id));

drop policy if exists point_devices_select_same_company on public.point_devices;
create policy point_devices_select_same_company
on public.point_devices
for select
to authenticated
using (public.can_access_company(company_id));

drop policy if exists point_products_select_same_company on public.point_products;
create policy point_products_select_same_company
on public.point_products
for select
to authenticated
using (public.can_access_company(company_id));

drop policy if exists point_debt_items_select_same_company on public.point_debt_items;
create policy point_debt_items_select_same_company
on public.point_debt_items
for select
to authenticated
using (public.can_access_company(company_id));

drop policy if exists inventory_categories_select_same_org on public.inventory_categories;
create policy inventory_categories_select_same_org
on public.inventory_categories
for select
to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists inventory_suppliers_select_same_org on public.inventory_suppliers;
create policy inventory_suppliers_select_same_org
on public.inventory_suppliers
for select
to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists inventory_items_select_same_org on public.inventory_items;
create policy inventory_items_select_same_org
on public.inventory_items
for select
to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists inventory_locations_select_same_org on public.inventory_locations;
create policy inventory_locations_select_same_org
on public.inventory_locations
for select
to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists inventory_balances_select_same_location on public.inventory_balances;
create policy inventory_balances_select_same_location
on public.inventory_balances
for select
to authenticated
using (public.can_access_inventory_location(location_id));

drop policy if exists inventory_receipts_select_same_org on public.inventory_receipts;
create policy inventory_receipts_select_same_org
on public.inventory_receipts
for select
to authenticated
using (public.can_access_inventory_receipt(id));

drop policy if exists inventory_receipt_items_select_same_org on public.inventory_receipt_items;
create policy inventory_receipt_items_select_same_org
on public.inventory_receipt_items
for select
to authenticated
using (public.can_access_inventory_receipt(receipt_id));

drop policy if exists inventory_requests_select_same_org on public.inventory_requests;
create policy inventory_requests_select_same_org
on public.inventory_requests
for select
to authenticated
using (public.can_access_inventory_request(id));

drop policy if exists inventory_request_items_select_same_org on public.inventory_request_items;
create policy inventory_request_items_select_same_org
on public.inventory_request_items
for select
to authenticated
using (public.can_access_inventory_request(request_id));

drop policy if exists inventory_movements_select_same_org on public.inventory_movements;
create policy inventory_movements_select_same_org
on public.inventory_movements
for select
to authenticated
using (
  public.can_access_inventory_item(item_id)
  or (from_location_id is not null and public.can_access_inventory_location(from_location_id))
  or (to_location_id is not null and public.can_access_inventory_location(to_location_id))
);

drop policy if exists inventory_stocktakes_select_same_org on public.inventory_stocktakes;
create policy inventory_stocktakes_select_same_org
on public.inventory_stocktakes
for select
to authenticated
using (public.can_access_inventory_stocktake(id));

drop policy if exists inventory_stocktake_items_select_same_org on public.inventory_stocktake_items;
create policy inventory_stocktake_items_select_same_org
on public.inventory_stocktake_items
for select
to authenticated
using (public.can_access_inventory_stocktake(stocktake_id));

drop policy if exists inventory_writeoffs_select_same_org on public.inventory_writeoffs;
create policy inventory_writeoffs_select_same_org
on public.inventory_writeoffs
for select
to authenticated
using (public.can_access_inventory_writeoff(id));

drop policy if exists inventory_writeoff_items_select_same_org on public.inventory_writeoff_items;
create policy inventory_writeoff_items_select_same_org
on public.inventory_writeoff_items
for select
to authenticated
using (public.can_access_inventory_writeoff(writeoff_id));

drop policy if exists invoice_name_mappings_select_same_org on public.invoice_name_mappings;
create policy invoice_name_mappings_select_same_org
on public.invoice_name_mappings
for select
to authenticated
using (public.can_access_inventory_item(item_id));

drop policy if exists telegram_invoice_sessions_select_same_org on public.telegram_invoice_sessions;
create policy telegram_invoice_sessions_select_same_org
on public.telegram_invoice_sessions
for select
to authenticated
using (
  warehouse_location_id is not null
  and public.can_access_inventory_location(warehouse_location_id)
);

drop policy if exists low_stock_alert_log_select_same_org on public.low_stock_alert_log;
create policy low_stock_alert_log_select_same_org
on public.low_stock_alert_log
for select
to authenticated
using (
  public.can_access_inventory_item(item_id)
  or public.can_access_inventory_location(location_id)
);

drop policy if exists point_sales_select_same_org on public.point_sales;
create policy point_sales_select_same_org
on public.point_sales
for select
to authenticated
using (public.can_access_point_sale(id));

drop policy if exists point_sale_items_select_same_org on public.point_sale_items;
create policy point_sale_items_select_same_org
on public.point_sale_items
for select
to authenticated
using (public.can_access_point_sale(sale_id));

drop policy if exists point_returns_select_same_org on public.point_returns;
create policy point_returns_select_same_org
on public.point_returns
for select
to authenticated
using (public.can_access_point_return(id));

drop policy if exists point_return_items_select_same_org on public.point_return_items;
create policy point_return_items_select_same_org
on public.point_return_items
for select
to authenticated
using (public.can_access_point_return(return_id));

drop policy if exists shift_week_publications_select_same_company on public.shift_week_publications;
create policy shift_week_publications_select_same_company
on public.shift_week_publications
for select
to authenticated
using (public.can_access_company(company_id));

drop policy if exists shift_operator_week_responses_select_same_company on public.shift_operator_week_responses;
create policy shift_operator_week_responses_select_same_company
on public.shift_operator_week_responses
for select
to authenticated
using (public.can_access_company(company_id));

drop policy if exists shift_change_requests_select_same_company on public.shift_change_requests;
create policy shift_change_requests_select_same_company
on public.shift_change_requests
for select
to authenticated
using (public.can_access_company(company_id));

drop policy if exists operator_salary_weeks_select_same_org on public.operator_salary_weeks;
create policy operator_salary_weeks_select_same_org
on public.operator_salary_weeks
for select
to authenticated
using (public.can_access_salary_week(id));

drop policy if exists operator_salary_week_company_allocations_select_same_org on public.operator_salary_week_company_allocations;
create policy operator_salary_week_company_allocations_select_same_org
on public.operator_salary_week_company_allocations
for select
to authenticated
using (public.can_access_company(company_id));

drop policy if exists operator_salary_week_payments_select_same_org on public.operator_salary_week_payments;
create policy operator_salary_week_payments_select_same_org
on public.operator_salary_week_payments
for select
to authenticated
using (public.can_access_salary_payment(id));

drop policy if exists operator_salary_week_payment_expenses_select_same_org on public.operator_salary_week_payment_expenses;
create policy operator_salary_week_payment_expenses_select_same_org
on public.operator_salary_week_payment_expenses
for select
to authenticated
using (
  public.can_access_salary_payment(payment_id)
  or public.can_access_company(company_id)
);

drop policy if exists arena_tech_logs_select_same_company on public.arena_tech_logs;
drop policy if exists "point device full access" on public.arena_tech_logs;
create policy arena_tech_logs_select_same_company
on public.arena_tech_logs
for select
to authenticated
using (
  company_id is not null
  and public.can_access_company(company_id)
);
