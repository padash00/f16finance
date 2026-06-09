-- БЕЗОПАСНОСТЬ: закрываем USING(true)/WITH CHECK(true) на биллинге и entitlements.
--
-- Миграции 20260608_* создали таблицы счетов/пакетов/модулей/прав с политиками
-- `for all using (true) with check (true)` (а features/tenant_feature_overrides —
-- с `using (true)` без `to authenticated`, т.е. для роли PUBLIC, включая anon).
--
-- Так как приложение ходит в Supabase через service-role ключ (минует RLS),
-- RLS — единственная защита от прямого обращения к PostgREST с публичным anon-ключом
-- и JWT обычного пользователя. С permissive-политикой любой залогиненный пользователь
-- ЛЮБОГО тенанта мог читать и ПИСАТЬ счета/права всех организаций напрямую, минуя
-- проверки суперадмина в Next.js.
--
-- Приводим к эталону (20260401_saas_core_rls / public_sensitive_rls_hardening):
--   • тенант-данные  → `for select to authenticated using (can_access_*)` (только своё, только чтение)
--   • глобальные каталоги → `for select to authenticated using (true)` (только чтение, без записи)
--   • запись во все эти таблицы — ТОЛЬКО через service-role (он обходит RLS).
-- F16 не затронут: его API работает через admin-клиент (service role).

-- ── invoices: счета по организации (тенант-данные) ──
drop policy if exists invoices_all on public.invoices;
drop policy if exists invoices_select_same_org on public.invoices;
create policy invoices_select_same_org
on public.invoices
for select
to authenticated
using (public.can_access_organization(organization_id));

-- ── company_features: гранты фич на точку (company-scoped) ──
drop policy if exists company_features_all on public.company_features;
drop policy if exists company_features_select_same_company on public.company_features;
create policy company_features_select_same_company
on public.company_features
for select
to authenticated
using (public.can_access_company(company_id));

-- ── tenant_feature_overrides: переопределения прав по организации (тенант-данные) ──
drop policy if exists tenant_feature_overrides_select on public.tenant_feature_overrides;
drop policy if exists tenant_feature_overrides_insert on public.tenant_feature_overrides;
drop policy if exists tenant_feature_overrides_update on public.tenant_feature_overrides;
drop policy if exists tenant_feature_overrides_delete on public.tenant_feature_overrides;
drop policy if exists tenant_feature_overrides_select_same_org on public.tenant_feature_overrides;
create policy tenant_feature_overrides_select_same_org
on public.tenant_feature_overrides
for select
to authenticated
using (public.can_access_organization(organization_id));

-- ── organization_packages: назначенный пакет организации (тенант-данные) ──
drop policy if exists organization_packages_all on public.organization_packages;
drop policy if exists organization_packages_select_same_org on public.organization_packages;
create policy organization_packages_select_same_org
on public.organization_packages
for select
to authenticated
using (public.can_access_organization(organization_id));

-- ── organization_addons: подключённые модули организации (тенант-данные) ──
drop policy if exists organization_addons_all on public.organization_addons;
drop policy if exists organization_addons_select_same_org on public.organization_addons;
create policy organization_addons_select_same_org
on public.organization_addons
for select
to authenticated
using (public.can_access_organization(organization_id));

-- ── Глобальные каталоги: читать можно всем залогиненным, писать — только service-role ──
-- features (каталог фич)
drop policy if exists features_select on public.features;
drop policy if exists features_select_authenticated on public.features;
create policy features_select_authenticated
on public.features
for select
to authenticated
using (true);

-- packages (каталог пакетов) — был `for all`, оставляем только select
drop policy if exists packages_all on public.packages;
drop policy if exists packages_select_authenticated on public.packages;
create policy packages_select_authenticated
on public.packages
for select
to authenticated
using (true);

-- addons (каталог модулей) — был `for all`, оставляем только select
drop policy if exists addons_all on public.addons;
drop policy if exists addons_select_authenticated on public.addons;
create policy addons_select_authenticated
on public.addons
for select
to authenticated
using (true);

notify pgrst, 'reload schema';
