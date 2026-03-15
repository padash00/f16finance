create table if not exists public.point_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  barcode text not null,
  price integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists point_products_company_barcode_uidx
  on public.point_products(company_id, barcode);

create index if not exists point_products_company_active_idx
  on public.point_products(company_id, is_active, name);

create or replace function public.set_point_products_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_point_products_updated_at on public.point_products;
create trigger trg_point_products_updated_at
before update on public.point_products
for each row
execute function public.set_point_products_updated_at();
