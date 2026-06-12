-- Restaurant Production (MVP): техкарты (рецептуры) + состав + food cost.
-- Изоляция по организации с первого дня. Ингредиенты — из inventory_items;
-- полуфабрикаты — вложенные техкарты (component_recipe_id).
-- Доступ только через service-role API. Гейт фичей restaurant.recipes_lite.

create table if not exists public.recipes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  company_id       uuid null references public.companies(id) on delete set null,
  name             text not null,
  category         text null,
  output_qty       numeric(12, 3) not null default 1,        -- выход (порций/кг/шт)
  output_unit      text not null default 'порц',
  yield_factor     numeric(6, 4) not null default 1,         -- коэф. выхода (0.97 = 3% потерь)
  sale_item_id     uuid null references public.inventory_items(id) on delete set null, -- блюдо в продаже (для автосписания позже)
  is_semi_finished boolean not null default false,           -- полуфабрикат (тесто, соус)
  is_active        boolean not null default true,
  notes            text null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists recipes_org_idx on public.recipes (organization_id, is_active);
create index if not exists recipes_sale_item_idx on public.recipes (sale_item_id);

create table if not exists public.recipe_components (
  id                  uuid primary key default gen_random_uuid(),
  recipe_id           uuid not null references public.recipes(id) on delete cascade,
  item_id             uuid null references public.inventory_items(id) on delete set null,  -- ингредиент со склада
  component_recipe_id uuid null references public.recipes(id) on delete set null,          -- или полуфабрикат
  name                text null,                              -- свободное имя если не из склада
  qty                 numeric(12, 4) not null default 0,      -- норма на ВЕСЬ выход техкарты
  unit                text not null default 'г',
  waste_pct           numeric(6, 3) not null default 0,       -- технологические потери, %
  sort_order          int not null default 0,
  created_at          timestamptz not null default now()
);

create index if not exists recipe_components_recipe_idx on public.recipe_components (recipe_id);

alter table public.recipes enable row level security;
alter table public.recipe_components enable row level security;
