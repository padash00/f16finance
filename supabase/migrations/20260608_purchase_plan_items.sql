-- Планировщик закупа на следующую неделю.
--
-- Лёгкая «напоминалка»: что докупить, по дням недели и по точкам.
-- Подшивается отдельной страницей в недельный PDF (weekly-report).
-- НЕ связано с inventory_purchase_orders (тяжёлый закуп по остаткам) — живёт рядом.
-- item_id / supplier_id оставлены nullable на будущее (превращение плана в реальный заказ).

create table if not exists public.purchase_plan_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete cascade,
  week_start date not null,                              -- понедельник недели плана
  day_of_week smallint not null check (day_of_week between 1 and 7), -- 1=Пн .. 7=Вс
  category text null,
  title text not null,                                   -- что закупаем (Coca-Cola / доставка)
  supplier text null,
  item_id uuid null references public.inventory_items(id) on delete set null,
  supplier_id uuid null references public.inventory_suppliers(id) on delete set null,
  quantity numeric(14, 3) null,
  amount numeric(14, 2) null,
  comment text null,
  status text not null default 'planned' check (status in ('planned', 'bought')),
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists purchase_plan_items_week_idx
  on public.purchase_plan_items (week_start, company_id);

create index if not exists purchase_plan_items_org_week_idx
  on public.purchase_plan_items (organization_id, week_start);

-- RLS: повторяем модель остальных таблиц (service-role обходит; доступ через API).
alter table public.purchase_plan_items enable row level security;

drop policy if exists purchase_plan_items_select on public.purchase_plan_items;
create policy purchase_plan_items_select on public.purchase_plan_items
  for select using (true);

drop policy if exists purchase_plan_items_insert on public.purchase_plan_items;
create policy purchase_plan_items_insert on public.purchase_plan_items
  for insert with check (true);

drop policy if exists purchase_plan_items_update on public.purchase_plan_items;
create policy purchase_plan_items_update on public.purchase_plan_items
  for update using (true) with check (true);

drop policy if exists purchase_plan_items_delete on public.purchase_plan_items;
create policy purchase_plan_items_delete on public.purchase_plan_items
  for delete using (true);

notify pgrst, 'reload schema';
