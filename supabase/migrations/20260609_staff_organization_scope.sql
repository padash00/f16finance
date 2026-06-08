-- staff не был скоуплен по организации, хотя код (listOrganizationStaffIds) ожидает staff.organization_id.
-- Добавляем колонку + бэкфилл всех текущих сотрудников в организацию F16 (как companies в saas_foundation).
-- Пререкизит изоляции тенантов и модели «клиент-владелец = staff его организации».
-- Аддитивно и идемпотентно. F16 не затрагивается (просто проставляется его orgId существующим staff).

alter table public.staff
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

create index if not exists idx_staff_organization_id on public.staff(organization_id);

-- Бэкфилл: существующие сотрудники без орг → F16 (текущий единственный тенант).
update public.staff s
set organization_id = (select id from public.organizations where slug = 'f16' limit 1)
where s.organization_id is null
  and exists (select 1 from public.organizations where slug = 'f16');

notify pgrst, 'reload schema';
