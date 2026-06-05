-- ============================================================================
-- Мультитенантная RLS: закрываем «открытые» политики using(true) на финансовых
-- и AI-таблицах. Заменяем на тенант-ограниченные — пользователь через
-- браузерный (anon) ключ видит ТОЛЬКО данные своей организации.
--
-- ВАЖНО: серверный код ходит в Supabase через service_role, который ПОЛНОСТЬЮ
-- обходит RLS. Поэтому API-роуты и крон не затрагиваются. Ограничивается только
-- прямой доступ из браузера по публичному anon-ключу (напр. страница
-- operator-analytics, которая читает debts клиентским клиентом — теперь она
-- видит только долги своих компаний).
--
-- Хелперы уже существуют (20260401_*):
--   can_access_company(uuid)      — company → organization → membership
--   can_access_organization(uuid) — проверка членства текущего auth.uid()
--
-- Идемпотентно: можно применять повторно.
-- Откат: вернуть `using (true) with check (true)` для нужной таблицы.
-- ============================================================================

-- ---------- debts (есть company_id и organization_id) -----------------------
alter table public.debts enable row level security;
drop policy if exists debts_all on public.debts;
drop policy if exists debts_tenant on public.debts;
create policy debts_tenant on public.debts
  for all
  using (
    public.can_access_company(company_id)
    or (organization_id is not null and public.can_access_organization(organization_id))
  )
  with check (
    public.can_access_company(company_id)
    or (organization_id is not null and public.can_access_organization(organization_id))
  );

-- ---------- ai_memory (есть organization_id) --------------------------------
alter table public.ai_memory enable row level security;
drop policy if exists ai_memory_all on public.ai_memory;
drop policy if exists ai_memory_tenant on public.ai_memory;
create policy ai_memory_tenant on public.ai_memory
  for all
  using (organization_id is not null and public.can_access_organization(organization_id))
  with check (organization_id is not null and public.can_access_organization(organization_id));
