-- =====================================================================
-- Изоляция RBAC: таблица positions (определения ролей) становится per-org.
--
-- Проблема: positions была ГЛОБАЛЬНОЙ. GET /api/admin/positions отдавал роли
-- ВСЕХ организаций, а UPDATE/DELETE били по id без проверки орг — владелец одной
-- организации ВИДЕЛ и мог УДАЛИТЬ/переименовать кастомные роли другой (напр.
-- роли F16 «smm», «завхоз», «оператор» были видны на тест-организации). Это
-- кросс-тенантная утечка чтения И деструктивной записи.
--
-- Решение: organization_id на positions.
--   • Встроенные роли (owner/manager/marketer/other) — organization_id = null
--     (общие системные роли, видны всем, не правятся из орг).
--   • Кастомные роли — привязаны к организации-владельцу; читаются/правятся/
--     удаляются только своей орг (скоуп в /api/admin/positions).
--
-- Имя роли остаётся глобально-уникальным: потребители по имени (гидрация ролей,
-- position_paths, role_capabilities) не меняются, enforcement не рискует. Слой
-- capability-правок уже изолирован (org_role_capabilities по organization_id).
--
-- Аддитивно и идемпотентно.
-- =====================================================================

alter table public.positions
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

create index if not exists idx_positions_organization_id on public.positions(organization_id);

-- Бэкфилл: все кастомные (не встроенные) роли → организация F16 (текущий тенант).
-- Встроенные (is_builtin=true) остаются с organization_id = null (общие).
update public.positions p
set organization_id = (select id from public.organizations where slug = 'f16' limit 1)
where p.is_builtin = false
  and p.organization_id is null
  and exists (select 1 from public.organizations where slug = 'f16');

notify pgrst, 'reload schema';
