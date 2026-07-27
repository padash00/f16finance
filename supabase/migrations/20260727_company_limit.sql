-- Лимит точек (компаний) на организацию: пакет = N точек, «+1 точка» докупается.
-- Технический потолок — число company_limit. Энфорсмент: нельзя создать компанию
-- сверх лимита. Грандфазер: всем существующим орг = текущему числу компаний (мин 1),
-- чтобы никто не потерял уже созданные точки.
alter table public.organizations
  add column if not exists company_limit int not null default 1;

update public.organizations o
set company_limit = greatest(
  1,
  (select count(*) from public.companies c where c.organization_id = o.id)
);
