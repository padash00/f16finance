-- =============================================================================
-- RLS для 6 таблиц без Row Level Security (Supabase Security Advisor)
-- Все API routes используют createAdminSupabaseClient() (service role) —
-- RLS не влияет на работу API. Закрываем прямой доступ через PostgREST.
-- =============================================================================

-- ─── 1. arena_games_catalog ───────────────────────────────────────────────────
-- Каталог игр привязан к company_id. Читают только сотрудники своей компании.
alter table if exists public.arena_games_catalog enable row level security;

drop policy if exists arena_games_catalog_select_same_company on public.arena_games_catalog;
create policy arena_games_catalog_select_same_company
  on public.arena_games_catalog
  for select
  to authenticated
  using (
    company_id is not null
    and public.can_access_company(company_id)
  );

-- ─── 2. arena_station_games ───────────────────────────────────────────────────
-- Игры на станциях — тоже company_id.
alter table if exists public.arena_station_games enable row level security;

drop policy if exists arena_station_games_select_same_company on public.arena_station_games;
create policy arena_station_games_select_same_company
  on public.arena_station_games
  for select
  to authenticated
  using (
    company_id is not null
    and public.can_access_company(company_id)
  );

-- ─── 3. kiosk_client_tokens ───────────────────────────────────────────────────
-- Токены авторизации клиентов киоска. ОЧЕНЬ чувствительно.
-- Никаких политик — доступ только через service role (наш API).
-- Authenticated/anon пользователи не могут читать чужие токены.
alter table if exists public.kiosk_client_tokens enable row level security;

-- Намеренно не добавляем SELECT policy — только service role имеет доступ.

-- ─── 4. positions ─────────────────────────────────────────────────────────────
-- Глобальный справочник должностей (не привязан к компании).
-- Читать могут все авторизованные сотрудники.
alter table if exists public.positions enable row level security;

drop policy if exists positions_select_authenticated on public.positions;
create policy positions_select_authenticated
  on public.positions
  for select
  to authenticated
  using (true);

-- ─── 5. staff_adjustments ─────────────────────────────────────────────────────
-- Корректировки зарплаты сотрудников. Финансово чувствительно.
-- Только service role (наш API с createAdminSupabaseClient).
alter table if exists public.staff_adjustments enable row level security;

-- Намеренно не добавляем SELECT policy.

-- ─── 6. staff_payments ────────────────────────────────────────────────────────
-- Выплаты сотрудникам. Финансово чувствительно.
-- Только service role.
alter table if exists public.staff_payments enable row level security;

-- Намеренно не добавляем SELECT policy.
