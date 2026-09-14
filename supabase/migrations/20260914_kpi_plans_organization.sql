-- Общие цели организации на /goals.
--
-- У kpi_plans не было организации: общий план (company_id = null) ни к кому не
-- привязывался, поэтому его отключили всем, кроме суперадмина, — иначе одна
-- организация видела и перезаписывала цели другой. Теперь общий план
-- принадлежит организации.
--
-- RLS-политику kpi_plans_all (using true) здесь НЕ трогаем: в таблицу ещё пишут
-- ключом пользователя /api/kpi/generate-january и инструменты копилота —
-- закрытие политики их сломает. Это отдельная задача.

alter table public.kpi_plans
  add column if not exists organization_id uuid null;

do $$ begin
  if not exists (select 1 from information_schema.table_constraints
    where table_name = 'kpi_plans' and constraint_name = 'kpi_plans_organization_id_fkey') then
    alter table public.kpi_plans
      add constraint kpi_plans_organization_id_fkey
      foreign key (organization_id) references public.organizations(id) on delete cascade;
  end if;
end $$;

-- Планы точек получают организацию своей точки
update public.kpi_plans p
set organization_id = c.organization_id
from public.companies c
where p.company_id = c.id
  and p.organization_id is null
  and c.organization_id is not null;

create index if not exists idx_kpi_plans_organization
  on public.kpi_plans (organization_id, period_start);

-- Один общий план организации на период и показатель
create unique index if not exists kpi_plans_org_period_uidx
  on public.kpi_plans (organization_id, period_start, kind)
  where company_id is null and organization_id is not null;

notify pgrst, 'reload schema';
