-- Брендинг компании для operator desktop:
-- — brand_color (hex) — основной акцент (заменяет emerald в кнопках)
-- — brand_logo_url — лого вместо OP-капсулы

alter table public.companies
  add column if not exists brand_color text null,
  add column if not exists brand_logo_url text null;

comment on column public.companies.brand_color is 'Акцентный цвет компании (hex). Применяется в operator desktop: gradient кнопки, активные элементы.';
comment on column public.companies.brand_logo_url is 'URL логотипа компании. Заменяет OP-капсулу в шапке operator desktop.';

notify pgrst, 'reload schema';
