-- Онбординг SaaS: владелец организации должен управлять СВОИМИ точками и
-- категориями. Раньше /settings (Компании и справочники) был де-факто только у
-- супер-админа → у роли owner не было settings.* → новый владелец не видел
-- «Настройки» и не мог добавить точку. Выдаём роли owner права на настройки.
-- (delete+insert — без зависимости от наличия unique-constraint.)

delete from public.role_capabilities
where role = 'owner'
  and capability in ('settings.view', 'settings.manage_companies', 'settings.manage_categories');

insert into public.role_capabilities (role, capability, granted) values
  ('owner', 'settings.view', true),
  ('owner', 'settings.manage_companies', true),
  ('owner', 'settings.manage_categories', true);
