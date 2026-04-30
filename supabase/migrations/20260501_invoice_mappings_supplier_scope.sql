-- Расширение invoice_name_mappings до per-organization + per-supplier обучения.
--
-- До: глобальная таблица (один alias — все тенанты, все поставщики).
-- После: алиасы привязаны к (organization_id, supplier_id, raw_name) и помнят
-- последние закупочную/розничную цены от данного поставщика.

alter table public.invoice_name_mappings
  add column if not exists organization_id uuid null references public.organizations(id) on delete cascade,
  add column if not exists supplier_id uuid null references public.inventory_suppliers(id) on delete set null,
  add column if not exists last_unit_cost numeric(12, 2) null,
  add column if not exists last_sale_price numeric(12, 2) null,
  add column if not exists last_seen_at timestamptz null;

-- Бэкфилл organization_id через item_id -> inventory_items.organization_id.
update public.invoice_name_mappings m
   set organization_id = i.organization_id
  from public.inventory_items i
 where m.organization_id is null
   and m.item_id = i.id;

-- Если у item не нашлось org (legacy null) — сносим запись (она бесполезна без скоупа).
delete from public.invoice_name_mappings where organization_id is null;

alter table public.invoice_name_mappings
  alter column organization_id set not null;

-- Дроп старого глобального уникального индекса по lower(invoice_name).
drop index if exists public.invoice_name_mappings_name_uidx;

-- Новый составной uniq: (org, supplier_or_sentinel, lower(invoice_name)).
-- Используем coalesce с sentinel uuid, чтобы NULL supplier_id участвовал в уникальности
-- (Postgres по умолчанию NULL != NULL в unique-индексах).
create unique index if not exists invoice_name_mappings_org_supplier_name_uidx
  on public.invoice_name_mappings (
    organization_id,
    coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(invoice_name)
  );

-- Индекс для быстрого тянуть все алиасы поставщика.
create index if not exists invoice_name_mappings_org_supplier_idx
  on public.invoice_name_mappings (organization_id, supplier_id);

-- Индекс по last_seen_at для приоритезации в промпте (свежие первые).
create index if not exists invoice_name_mappings_last_seen_idx
  on public.invoice_name_mappings (organization_id, last_seen_at desc nulls last);

-- RLS: повторяем модель supplier_debts — открытые политики (фильтрация на API).
alter table public.invoice_name_mappings enable row level security;

drop policy if exists invoice_name_mappings_select on public.invoice_name_mappings;
create policy invoice_name_mappings_select on public.invoice_name_mappings
  for select using (true);

drop policy if exists invoice_name_mappings_insert on public.invoice_name_mappings;
create policy invoice_name_mappings_insert on public.invoice_name_mappings
  for insert with check (true);

drop policy if exists invoice_name_mappings_update on public.invoice_name_mappings;
create policy invoice_name_mappings_update on public.invoice_name_mappings
  for update using (true) with check (true);

drop policy if exists invoice_name_mappings_delete on public.invoice_name_mappings;
create policy invoice_name_mappings_delete on public.invoice_name_mappings
  for delete using (true);
