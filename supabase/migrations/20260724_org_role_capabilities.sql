-- ─────────────────────────────────────────────────────────────────────────
-- Трёхслойные права (RBAC) для мультитенанта.
-- ─────────────────────────────────────────────────────────────────────────
-- Слой 1 — role_capabilities (ГЛОБАЛЬНЫЙ, только суперадмин): платформенный
--   дефолт роли для ВСЕХ организаций. Уже существует (20260506).
-- Слой 2 — org_role_capabilities (ЭТА миграция): каждая организация режет/
--   включает права своих ролей ТОЛЬКО внутри себя. Не влияет на другие орг
--   и не трогает глобальный дефолт.
-- Слой 3 — user_capability_overrides (по человеку): точечно. Уже существует.
--
-- Эффективное право = глобал (слой 1) → правка орг (слой 2) → правка человека
-- (слой 3). Поверх — гейт пакета организации (какие страницы вообще есть).
--
-- Идемпотентно. Стартует пустой — никто ещё не кастомизировал роли,
-- поведение не меняется до первой записи.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists org_role_capabilities (
  organization_id uuid not null references organizations(id) on delete cascade,
  role text not null,
  capability text not null,
  granted boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, role, capability)
);

create index if not exists idx_org_role_caps_org on org_role_capabilities(organization_id);
create index if not exists idx_org_role_caps_org_role on org_role_capabilities(organization_id, role);

alter table org_role_capabilities enable row level security;

drop policy if exists "service_role full access org role caps" on org_role_capabilities;
create policy "service_role full access org role caps" on org_role_capabilities
  to service_role
  using (true) with check (true);

drop policy if exists "authenticated read org role caps" on org_role_capabilities;
create policy "authenticated read org role caps" on org_role_capabilities
  for select to authenticated
  using (true);

create or replace function touch_org_role_capabilities_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_org_role_capabilities_updated_at on org_role_capabilities;
create trigger trg_org_role_capabilities_updated_at
  before update on org_role_capabilities
  for each row execute function touch_org_role_capabilities_updated_at();

notify pgrst, 'reload schema';
