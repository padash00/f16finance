-- ─────────────────────────────────────────────────────────────────────────
-- Настраиваемая подписка/триал + онбординг-тур (управление с /platform).
--
-- Аддитивно и идемпотентно. Существующие статусы переиспользуем:
--   organizations.status:               active | suspended (гейт доступа)
--   organization_subscriptions.status:  trialing | active | past_due(=grace) | expired(=suspended) | canceled
--
-- БЕЗОПАСНОСТЬ: все существующие организации помечаем billing_exempt = true
-- (F16 и любые текущие клиенты остаются вне подписочной блокировки). Новые орг
-- (созданные после миграции) идут по подписочному циклу.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Организация: исключение из биллинга + тумблер онбординг-тура
alter table public.organizations
  add column if not exists billing_exempt boolean not null default false;

alter table public.organizations
  add column if not exists onboarding_tour_enabled boolean not null default false;

-- Грандфазер: всё, что уже существует, — вне подписочной блокировки.
update public.organizations set billing_exempt = true where billing_exempt = false;

-- 2. Подписка: явные даты триала и конца grace-периода
alter table public.organization_subscriptions
  add column if not exists trial_ends_at timestamptz;

alter table public.organization_subscriptions
  add column if not exists grace_until timestamptz;

-- 3. Членство пользователя: флаг «онбординг пройден»
alter table public.organization_members
  add column if not exists onboarding_done boolean not null default false;

-- Индекс для крона: быстро найти подписки, у которых пора двигать статус.
create index if not exists idx_org_subscriptions_status_dates
  on public.organization_subscriptions(status, ends_at, trial_ends_at, grace_until);
