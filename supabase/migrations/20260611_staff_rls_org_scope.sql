-- УТЕЧКА: на staff висела политика SELECT `using (true)` (из 20260417) →
-- любой authenticated читал ВСЕХ сотрудников ВСЕХ организаций через браузерный
-- anon-клиент (видно на /access: владелец Test засветился в списке F16).
-- После включения изоляции (LEGACY=false) это стало настоящей межтенантной утечкой.
--
-- Скоупим чтение staff по организации: член активной орг видит только её сотрудников.
-- can_access_organization(org) = «текущий auth-юзер — активный член этой орг»
-- (SECURITY DEFINER, по organization_members.user_id/email). Запись staff —
-- по-прежнему только через service_role (API), отдельной write-политики нет.

drop policy if exists staff_select_authenticated on public.staff;

create policy staff_select_own_org
  on public.staff
  for select
  to authenticated
  using (public.can_access_organization(organization_id));
