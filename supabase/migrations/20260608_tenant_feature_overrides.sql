-- Per-tenant переопределения функций (entitlement overrides).
--
-- Эффективные права организации = features тарифа + эти overrides.
-- enabled=true принудительно включает фичу, enabled=false — выключает,
-- отсутствие строки = берётся из тарифа.
-- Пока только хранение/управление из панели; принудительное блокирование (enforcement) — отдельная фаза.

create table if not exists public.tenant_feature_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature text not null,
  enabled boolean not null,
  reason text null,
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, feature)
);

create index if not exists tenant_feature_overrides_org_idx
  on public.tenant_feature_overrides (organization_id);

alter table public.tenant_feature_overrides enable row level security;

drop policy if exists tenant_feature_overrides_select on public.tenant_feature_overrides;
create policy tenant_feature_overrides_select on public.tenant_feature_overrides for select using (true);

drop policy if exists tenant_feature_overrides_insert on public.tenant_feature_overrides;
create policy tenant_feature_overrides_insert on public.tenant_feature_overrides for insert with check (true);

drop policy if exists tenant_feature_overrides_update on public.tenant_feature_overrides;
create policy tenant_feature_overrides_update on public.tenant_feature_overrides for update using (true) with check (true);

drop policy if exists tenant_feature_overrides_delete on public.tenant_feature_overrides;
create policy tenant_feature_overrides_delete on public.tenant_feature_overrides for delete using (true);

notify pgrst, 'reload schema';
