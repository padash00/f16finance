-- Остатки ингредиентов на кухне + журнал движений (для теория vs факт / недостача).
-- Поток: ревизия (баланс) → приход → списание по продажам (теор. расход) → ревизия
-- → расхождение = факт − ожидаемый остаток.

alter table public.ingredients
  add column if not exists stock_qty numeric(14, 4) not null default 0;

create table if not exists public.ingredient_movements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  ingredient_id    uuid not null references public.ingredients(id) on delete cascade,
  kind             text not null check (kind in ('receipt', 'count', 'sale_writeoff', 'manual')),
  qty_delta        numeric(14, 4) not null default 0,   -- изменение остатка (+приход / −расход)
  balance_after    numeric(14, 4) not null default 0,   -- остаток после операции
  variance         numeric(14, 4) null,                 -- для count: факт − ожидаемый
  comment          text null,
  period_from      date null,
  period_to        date null,
  created_by       uuid null,
  created_at       timestamptz not null default now()
);

create index if not exists ingredient_movements_ing_idx
  on public.ingredient_movements (ingredient_id, created_at desc);
create index if not exists ingredient_movements_org_idx
  on public.ingredient_movements (organization_id, created_at desc);

alter table public.ingredient_movements enable row level security;
