-- Одноразовая чинилка: для каждой роли, где есть включенный <page>.<action>
-- (action != 'view'), но <page>.view выключен → включить <page>.view.
--
-- Причина: auto-deps на API работают только при включении нового capability.
-- Если до auto-deps уже была роль где `expenses.create=true` и
-- `expenses.view=false` (выключили вручную) — middleware блокирует
-- /expenses/new с «Нет доступа к странице», хотя у роли есть create.
--
-- Этот скрипт находит такие случаи и включает соответствующие view.
-- Идемпотентный — можно прогонять много раз.

with action_to_view as (
  -- Для каждой записи где есть granted=true action (не view), вычисляем нужный view
  select
    role,
    split_part(capability, '.', 1) as page_id,
    split_part(capability, '.', 1) || '.view' as view_capability
  from role_capabilities
  where granted = true
    and capability not like '%.view'
    and split_part(capability, '.', 2) <> 'view'
)
update role_capabilities rc
set granted = true,
    updated_at = now()
from action_to_view atv
where rc.role = atv.role
  and rc.capability = atv.view_capability
  and rc.granted = false;

-- Также вставить отсутствующие view-capabilities (если их вообще нет в таблице)
insert into role_capabilities (role, capability, granted)
select distinct
  rc.role,
  split_part(rc.capability, '.', 1) || '.view' as view_cap,
  true
from role_capabilities rc
where rc.granted = true
  and rc.capability not like '%.view'
  and split_part(rc.capability, '.', 2) <> 'view'
on conflict (role, capability) do nothing;

-- Сводка после прогона
do $$
declare
  v_fixed int;
begin
  select count(*) into v_fixed
  from role_capabilities
  where capability like '%.view' and granted = true;
  raise notice 'View-capabilities включено: %', v_fixed;
end $$;

notify pgrst, 'reload schema';
