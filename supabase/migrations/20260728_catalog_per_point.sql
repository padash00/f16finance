-- Фаза 1: каталог по точке. Товары/категории/поставщики получают company_id —
-- у каждого магазина свой каталог. Бэкфилл существующих → на точку-магазин орг
-- (store_settings.store_company_id, иначе единственная store_enabled, иначе
-- единственная витринная локация). «Общий» = все магазины (company_id in (...)).
--
-- БЕЗОПАСНОСТЬ РАЗВЁРТКИ:
--  * Старый barcode-индекс (organization_id, barcode) НЕ дропаем здесь — код
--    addStock развязан от onConflict (явный find-then-write), поэтому оба индекса
--    временно сосуществуют без 42P10. Старый индекс дропнет отдельная миграция
--    20260729_catalog_drop_org_barcode ПОСЛЕ деплоя.
--  * Категории/поставщики создаются обычным insert (без onConflict), поэтому их
--    уникальные индексы можно менять сразу.

-- 1) Колонки (nullable; NOT NULL позже, когда все орг разрешат точку-магазин).
alter table public.inventory_items      add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.inventory_categories add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.inventory_suppliers  add column if not exists company_id uuid references public.companies(id) on delete set null;

-- 2) Бэкфилл: точка-магазин орг. «Единственная store_enabled» через
--    array_agg + having count(*)=1 (оконные функции в HAVING в PG запрещены).
with shop_point as (
  select o.id as organization_id,
         coalesce(
           ss.store_company_id,
           (select (array_agg(c.id))[1] from public.companies c
             where c.organization_id = o.id and c.store_enabled
             having count(*) = 1),
           (select l.company_id from public.inventory_locations l
             join public.companies c2 on c2.id = l.company_id
            where c2.organization_id = o.id and l.location_type = 'point_display'
            order by l.created_at limit 1)
         ) as company_id
  from public.organizations o
  left join public.store_settings ss on ss.organization_id = o.id
)
update public.inventory_items i set company_id = sp.company_id
  from shop_point sp
 where i.organization_id = sp.organization_id and i.company_id is null and sp.company_id is not null;

with shop_point as (
  select o.id as organization_id,
         coalesce(ss.store_company_id,
           (select (array_agg(c.id))[1] from public.companies c where c.organization_id = o.id and c.store_enabled having count(*) = 1),
           (select l.company_id from public.inventory_locations l join public.companies c2 on c2.id = l.company_id where c2.organization_id = o.id and l.location_type = 'point_display' order by l.created_at limit 1)
         ) as company_id
  from public.organizations o left join public.store_settings ss on ss.organization_id = o.id
)
update public.inventory_categories i set company_id = sp.company_id
  from shop_point sp where i.organization_id = sp.organization_id and i.company_id is null and sp.company_id is not null;

with shop_point as (
  select o.id as organization_id,
         coalesce(ss.store_company_id,
           (select (array_agg(c.id))[1] from public.companies c where c.organization_id = o.id and c.store_enabled having count(*) = 1),
           (select l.company_id from public.inventory_locations l join public.companies c2 on c2.id = l.company_id where c2.organization_id = o.id and l.location_type = 'point_display' order by l.created_at limit 1)
         ) as company_id
  from public.organizations o left join public.store_settings ss on ss.organization_id = o.id
)
update public.inventory_suppliers i set company_id = sp.company_id
  from shop_point sp where i.organization_id = sp.organization_id and i.company_id is null and sp.company_id is not null;

-- 3) Новый barcode-индекс по точке (старый (organization_id, barcode) пока живёт).
create unique index if not exists inventory_items_company_barcode_uidx
  on public.inventory_items (company_id, barcode)
  where barcode is not null;

-- 4) Категории: глобальный lower(name)-индекс был кросс-тенантным багом → по-точечно.
drop index if exists public.inventory_categories_name_uidx;
create unique index if not exists inventory_categories_company_name_uidx
  on public.inventory_categories (company_id, lower(name));

-- 5) Поставщики: (organization_id, lower(name)) → (company_id, lower(name)).
drop index if exists public.inventory_suppliers_org_name_uidx;
create unique index if not exists inventory_suppliers_company_name_uidx
  on public.inventory_suppliers (company_id, lower(name));

create index if not exists inventory_items_company_idx      on public.inventory_items (company_id);
create index if not exists inventory_categories_company_idx on public.inventory_categories (company_id);
create index if not exists inventory_suppliers_company_idx  on public.inventory_suppliers (company_id);

notify pgrst, 'reload schema';
