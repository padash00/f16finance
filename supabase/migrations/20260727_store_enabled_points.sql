-- «Точка = магазин»: явный флаг на компании. Раньше это решалось двумя
-- расходящимися способами — одиночный store_settings.store_company_id и выведенный
-- из наличия витринных локаций (point_display). Сводим к одному флагу store_enabled.
-- Магазином может быть несколько точек орг; между ними всё изолируется по company_id.

alter table public.companies
  add column if not exists store_enabled boolean not null default false;

-- Бэкфилл: магазином считаем тех, кто уже был назначен store_settings.store_company_id
-- ИЛИ уже имеет витринную локацию (де-факто работал как магазин).
update public.companies c
set store_enabled = true
where c.store_enabled = false and (
  exists (select 1 from public.store_settings s where s.store_company_id = c.id)
  or exists (
    select 1 from public.inventory_locations l
    where l.company_id = c.id and l.location_type = 'point_display'
  )
);

notify pgrst, 'reload schema';
