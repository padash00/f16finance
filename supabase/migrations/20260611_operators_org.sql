-- operators скоупились ТОЛЬКО через operator_company_assignments → оператор без
-- назначения на точку был невидим своей орг (баг «Сергей»), а новый оператор
-- создавался без привязки вообще. Добавляем organization_id (как у staff):
-- проставляется при создании, скоуп идёт по нему ∪ назначениям.

alter table public.operators add column if not exists organization_id uuid;

create index if not exists operators_org_idx on public.operators (organization_id);

-- Бэкфилл: организация = организация точки, к которой оператор назначен.
update public.operators o
set organization_id = c.organization_id
from public.operator_company_assignments a
join public.companies c on c.id = a.company_id
where o.organization_id is null
  and a.operator_id = o.id
  and c.organization_id is not null;

-- Остаток (операторы без назначений, напр. «Сергей») → F16.
update public.operators
set organization_id = '447fdc6d-f3bd-453a-b471-465eb3c81e99'
where organization_id is null;
