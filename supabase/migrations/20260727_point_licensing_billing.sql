-- Точки как часть биллинга: пакет включает N точек, аддон «+1 точка» докупает.
-- Эффективный лимит орг = max(точки_пакета + Σ(аддон.included_companies × quantity),
--                            ручной organizations.company_limit).
-- Ручное поле остаётся как override/fallback (орг без пакета, освобождённые от
-- биллинга, индив. сделки). Аддитивно и обратно-совместимо: пока значения не
-- проставлены, резолвер отдаёт ручной лимит (как было).

-- 1) Точек включено в пакет (по умолчанию 1).
alter table public.packages
  add column if not exists included_companies integer not null default 1;

-- 2) Сколько точек даёт аддон (по умолчанию 0; у «+1 точка» = 1).
alter table public.addons
  add column if not exists included_companies integer not null default 0;

-- 3) Количество купленных единиц аддона у организации (для «+N точек»).
alter table public.organization_addons
  add column if not exists quantity integer not null default 1 check (quantity > 0);

-- 4) Каталожный аддон «Доп. точка» (+1 точка, тарифицируется по точке).
insert into public.addons (code, name, description, feature_codes, price_kzt, billing_unit, included_companies)
values ('extra_point', 'Доп. точка', 'Ещё одна точка (компания) сверх пакета', '{}', 9900, 'company', 1)
on conflict (code) do update set included_companies = excluded.included_companies;

notify pgrst, 'reload schema';
