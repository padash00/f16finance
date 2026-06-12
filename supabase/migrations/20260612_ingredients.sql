-- Каталог ИНГРЕДИЕНТОВ ресторана (мука, сыр, тесто) — отдельно от товаров магазина
-- (inventory_items = готовая продукция на продажу). Техкарта собирается из ингредиентов.
-- Изоляция по орг. Доступ через service-role API.

create table if not exists public.ingredients (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  unit             text not null default 'г',            -- базовая ед.: г, мл, шт
  purchase_price   numeric(12, 4) not null default 0,    -- цена за базовую ед.
  category         text null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists ingredients_org_idx on public.ingredients (organization_id, is_active);

alter table public.ingredients enable row level security;

-- Состав техкарты теперь ссылается на ингредиент (а не на товар магазина).
alter table public.recipe_components
  add column if not exists ingredient_id uuid null references public.ingredients(id) on delete set null;
