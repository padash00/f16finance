# Orda — модульный SaaS: дорожная карта (из deep-research отчётов)

Перевод стратегии в конкретные задачи по нашему коду. Порядок = приоритет отчёта
(«инженерия до маркетинга»: сначала изоляция, потом тарифы, потом вертикали).

## P0 — Изоляция тенантов (фундамент) — ПОЧТИ ГОТОВО ✅
- [x] Флип `LEGACY_SINGLE_TENANT_MODE=false`
- [x] NEVER-pattern в `resolveCompanyScope` / `listOrganization*`
- [x] RLS фаза 1+2 (staff, operator_auth self-scope, expenses/debts/PII/чат/новости/смены…)
- [x] audit_log + organization_id, кроны по орг
- [x] Аудит admin/AI роутов (агент): role-bot, инвентарные каталоги, settings, notifications, valuation
- [x] Онбординг: точки/категории/сотрудники/операторы тегаются орг; автоген code
- [x] Создание владельца клиента в /platform; вход операторов (self-scope)
- [ ] Хвост: `chat_moderation_flags` (moderation) скоуп; `plans_daily` org-колонка
- [ ] Сплошной финальный прогон по оставшимся admin-роутам перед реальным клиентом

## P1 — Entitlements до конца (мы здесь)
- [x] Каталог features/packages/addons + company_features + legacy-гранты F16
- [x] Назначение пакета → materialize в company_features; ручная выдача (fix created_by)
- [x] Гейтинг сайдбара по фичам (orgFeatures + allAccess для F16/legacy/superadmin)
- [x] Витрина «Тарифы и пакеты» + пакет в блоке «Подписка» + русские названия
- [ ] **Составы пакетов**: каждый Orda-пакет грантит осмысленный набор фич (см. ниже)
- [ ] Развесить `feature` на остальные премиум-пункты сайдбара (Telegram, AI-разделы)
- [ ] `GET /api/me/entitlements` — явный резолв (сейчас внутри session-role)
- [ ] Включить enforcement на страницах/API (`requireFeature`) — после проверки логов
- [ ] Флип `ENTITLEMENTS_ENFORCE=true` (canary на Test, не F16)

## P1.5 — Биллинг (после того как entitlements реально гейтят)
- [ ] `BillingProvider` слой; `POST /api/billing/checkout`
- [ ] Webhooks: `/api/webhooks/kaspi`, `/api/webhooks/stripe` (idempotency table)
- [ ] Usage-метеринг: `usage_counters`, `/api/usage`, `/api/usage/consume` (AI/OCR квоты)
- [ ] `feature_audit_log` (история изменений прав)

## P2 — Restaurant Production (вход в horeca) — крупный отдельный модуль
- [ ] Домен `lib/domain/production/*`: ингредиенты, полуфабрикаты, техкарты, версии
- [ ] Дата-модель: recipe_books, recipes, recipe_versions, recipe_lines,
      semi_finished_batches, yield_profiles, production_orders, sale_writeoff_events,
      inventory_variances
- [ ] Связка «техкарта → продажа → автосписание → food cost (теория vs факт)»
- [ ] Страницы `app/(main)/production/*`, API `app/api/production/*`
- [ ] Recipes Pro как платный over-layer (batch, yield/waste, central kitchen)

## P2 — UX
- [ ] Свернуть меню в 6–7 доменов (Главная/Финансы/Продажи/Склад+Production/Команда/Автоматизация/Подписка)
- [ ] Переключатель «Классическое / Новое меню» на 60–90 дней для текущих клиентов
- [ ] Upsell-модалки по триггерам (3 ручных импорта → OCR; 2-я точка → Network; и т.д.)

## P3 — Franchise / сеть
- [ ] Franchise Hub: HQ-кабинет, общие меню/цены, сквозные отчёты, бенчмарк по точкам
- [ ] API/BI Export (webhooks, connectors)

## Состав оболочек (что грантит пакет) — по отчёту
| Пакет | Модули | feature_codes |
|---|---|---|
| Finance | Core + Finance | dashboard.owner, finance.base, finance.pnl |
| Club | + People + POS + Stock | + club.pos, shop.catalog |
| Restaurant | + Production basic | + club.pos, shop.catalog, restaurant.recipes_lite |
| Shop | Core + Finance + Stock + POS | + shop.catalog, club.pos |
| Service | + job-flow + Stock | + service.jobs, shop.catalog |

**Правило (Stripe/отчёт): не гейтить базовое** — продажи, простой склад, P&L/маржа,
базовые роли. Гейтить только AI, Telegram automation, OCR, Production-advanced,
multi-brand HQ, API/BI, advanced permissions.
