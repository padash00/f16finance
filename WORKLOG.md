# Worklog

Этот файл ведётся как живой журнал изменений по проекту.

Как обновлять дальше:
- после каждого заметного блока работ добавлять новую запись в начало файла
- для каждой записи фиксировать дату, что сделано, какие риски закрыты, что осталось
- по возможности указывать ключевые коммиты
- если изменение влияет на SaaS, tenant-изоляцию, billing, роли, доступы или критичные API, это нужно записывать обязательно

## Текущее состояние

- Проект уже переведён из single-tenant логики в SaaS foundation с организациями, участниками организаций, подписками, тарифами и активной организацией в сессии.
- `/select-organization` теперь зарезервирован только для супер-админа.
- Обычные пользователи и операторы должны попадать только в свой контур и не видеть SaaS-хаб.
- Tenant-изоляция уже существенно усилена, но ещё остаются хвосты в глобальных настройках и shared-справочниках.

## 2026-04-01

### Аварийный откат входа к одному домену

Сделано:
- Вход и middleware возвращены к простому сценарию через `ordaops.kz`.
- Поддомены временно отключены как отдельные точки входа и перенаправляются на основной домен.
- `/platform` и `/select-organization` больше не используются как обязательные маршруты входа и редиректятся в обычный `defaultPath`.
- `app/api/auth/session-role/route.ts` возвращён к более простому варианту без tenant/platform контекста.
- `app/login/page.tsx` снова использует обычную форму входа без отдельного subdomain flow.

Проверка:
- `npm run typecheck` проходит.
- `npm run build` проходит.

Ожидаемый результат:
- Пользователь заходит только через `ordaops.kz`.
- Старый единый контур снова работает без SaaS-развилки на входе.

### Tenant bootstrap для super-admin на поддоменах

Сделано:
- Добавлен отдельный server-side bootstrap маршрут `app/auth/tenant-entry/route.ts`.
- На `*.ordaops.kz` он:
  - проверяет текущий host,
  - резолвит организацию по поддомену,
  - выставляет `oc_org`,
  - и одним redirect переводит пользователя в tenant workspace без старого platform-flow.
- `app/login/LoginForm.tsx` для tenant-поддоменов после успешного входа теперь всегда ведёт в `/auth/tenant-entry`, а не пытается вычислять tenant-home на клиенте.
- `app/platform/layout.tsx` на tenant-поддоменах теперь тоже уводит в `/auth/tenant-entry`, чтобы `/platform` не жил как отдельный контур внутри tenant host.
- `proxy.ts` и `api/auth/session-role` синхронизированы с этим сценарием и больше не используют `/welcome` как special home для `super-admin` на tenant host.

Проверка:
- `npm run typecheck` проходит.
- `npm run build` проходит.

Ожидаемый результат:
- `super-admin` может входить на любой `*.ordaops.kz` своим аккаунтом.
- Поддомен ведёт в tenant workspace конкретной организации, а не в platform/dashboard loop.

### Разделение platform и tenant для super-admin

Сделано:
- В `proxy.ts` введён `effectiveDefaultPath`, чтобы на tenant-поддоменах любой внутренний redirect для `super-admin` вёл в tenant workspace, а не в `/platform`.
- Любые server-side redirect'ы на поддомене теперь используют tenant-safe путь по умолчанию.
- `app/platform/layout.tsx` переведён в server-side guard:
  - на `ordaops.kz` работает normal platform shell
  - на `*.ordaops.kz` маршрут `/platform*` больше не существует как контур платформы и сразу редиректит в `/dashboard` конкретной организации
- Клиентская часть platform layout вынесена в `app/platform/PlatformShell.tsx`, чтобы server redirect не смешивался с client hooks.

Проверка:
- `npm run build` проходит.
- `npm run typecheck` проходит.

Ожидаемый результат:
- С одного `super-admin` аккаунта можно заходить на любой tenant-поддомен.
- `ordaops.kz` остаётся owner/platform-контуром.
- `f16.ordaops.kz/platform` больше не должен уходить в redirect-loop и вместо этого должен приводить в tenant dashboard F16.

### Tenant login redirect loop на `*.ordaops.kz`

Сделано:
- Исправлен post-login flow в `app/login/LoginForm.tsx` для tenant-поддоменов.
- После `signInWithPassword` переход в tenant workspace теперь идёт через полную браузерную навигацию (`window.location.assign(...)`), а не через `router.push(...)`.
- Это убирает race-condition, когда middleware ещё не видит свежие Supabase SSR cookies во время мгновенного RSC-перехода на `/dashboard`, из-за чего появлялась петля `ERR_TOO_MANY_REDIRECTS`.

Проверка:
- `npm run build` проходит.

Ожидаемый результат:
- `f16.ordaops.kz/login` после успешного входа должен стабильно открывать tenant dashboard даже в обычной сессии браузера, не только в инкогнито.

### Supabase security hardening после alert по public tables

Сделано:
- Добавлена отдельная bulk-RLS миграция для чувствительных и tenant-scoped таблиц:
  - `companies`
  - `customers`
  - `discounts`
  - `loyalty_config`
  - `point_devices`
  - `point_products`
  - `point_debt_items`
  - `inventory_*`
  - `point_sales` / `point_returns`
  - `shift_*`
  - `operator_salary_*`
  - `arena_tech_logs`
- Добавлены SQL helper-функции для RLS-проверок через:
  - `organization`
  - `company`
  - `inventory_location`
  - `point_device`
  - `point_sale`
  - `point_return`
  - `salary_week/payment`
- Закрыт старый опасный policy на `arena_tech_logs`, где раньше был `using (true)`.
- Admin-only таблицы (`app_settings`, `report_snapshots`, `audit_log`, `notification_log`, `telegram_chat_history`) переведены под RLS, чтобы они больше не торчали наружу через public API без защиты.
- После получения конкретного списка из Supabase Security Advisor добавлена ещё одна catch-up миграция под legacy-таблицы:
  - `incomes`
  - `expense_categories`
  - `operators`, `operator_profiles`, `operator_*`
  - `salary_calculation_*`
  - `point_projects`, `point_project_companies`, `arena_map_decorations`
  - `tasks/projects`-suite
  - и старые public-таблицы, которые есть в боевой БД, но не все описаны в текущих миграциях репозитория
- В этой миграции:
  - на все таблицы из Security Advisor включается `RLS`
  - для таблиц с понятной tenant-связью автоматически создаются `select` policies
  - для legacy-таблиц с неясной схемой включается `RLS` без открывающих policy, то есть они закрываются deny-by-default до ручного разбора

Важно:
- После применения миграции нужно повторно проверить Security Advisor в Supabase.
- Если Advisor после этого всё ещё ругнётся, следующим этапом надо отдельно пройти legacy-таблицы, которые были созданы до текущих миграций и не описаны в repo полностью.

### Multi-tenant изоляция — финальный проход

Сделано:
- **Tenant-aware login page** — `app/login/page.tsx` переведён в server component, `LoginForm.tsx` — client. На поддомене `f16.ordaops.kz` страница входа показывает брендинг организации (название, иконка). На `ordaops.kz` — общий Orda Control.
- **proxy.ts** — host-организация теперь резолвится до проверки авторизации. На tenant-поддомене неавторизованные пользователи не видят маркетинговую страницу, а сразу уходят на `/login`.
- **point/all-operators** — операторы теперь фильтруются по `operator_company_assignments.company_id IN [device.company_ids]`. Больше не возвращаются операторы других организаций.
- **admin/shifts — findOperatorForShiftName** — scoped по companyId через `operator_company_assignments`.
- **pos/bootstrap** — `inventory_balances` фильтруются по `location_id IN [allowed locations]` (двухэтапный запрос). `discounts` фильтруются по `allowedCompanyIds` в запросе к БД.
- **admin/profitability** — `point_devices` и `incomes` фильтруются через `listOrganizationCompanyIds`.
- **admin/settings** — при создании company/staff/expense_category добавляется `organization_id`.
- **admin/organizations** — создание домена `tenant_domains` больше не silent-skip, бросает ошибку. Домен создаётся всегда при создании организации.
- **proxy.ts и active-organization** — `httpOnly: true` на cookie активной организации (был false — XSS).
- **lib/server/organizations** — suspended-организации фильтруются в resolveUserOrganizations.
- **lib/core/site.ts** — `APEX_MAINTENANCE_MODE` из env-переменной вместо хардкода.
- **lib/server/tenant-hosts.ts** — in-memory TTL-кеш 60s на резолв host→organization.

Ключевые коммиты:
- `8328aa7` `fix(saas): harden tenant isolation and cookie security`
- `00f8a01` `fix(tenant): close remaining cross-org data leaks and add host cache`
- `896be13` `feat(saas): tenant-aware login page and platform/tenant mode routing`

Платформенная логика:
- `ordaops.kz` → owner dashboard (`/select-organization`) только для super-admin
- `f16.ordaops.kz` → tenant login с брендингом F16 → workspace F16
- Данные между организациями не пересекаются на уровне API

### Что осталось

Критично:
- RLS (Row Level Security) в Supabase по organization_id — текущая изоляция на уровне app (service role bypasses RLS), но DB-уровень не защищён
- Проверить `point/*`, `pos/*` хвосты на финальную изоляцию

Высокий приоритет:
- Реальный billing flow с оплатой, просрочкой, апгрейдом и историей платежей
- Owner dashboard UX improvements (более premium SaaS вид)
- Финальный onboarding после создания организации

Ниже приоритетом:
- White-label / branding на уровне организаций (логотип, цвета)
- Тесты на tenant-изоляцию, тарифы, login flow
- Добавить `APEX_MAINTENANCE_MODE=true` в Vercel env при необходимости

## 2026-03-31

## 2026-04-01

### Platform / tenant UX split

Сделано:
- Tenant-поддомены перестали вести себя как копия основного маркетингового домена.
- На `*.ordaops.kz` публичные платформенные страницы теперь не показываются — вместо них пользователь уходит в tenant login flow.
- Страница входа `app/login` теперь различает:
  - platform mode на `ordaops.kz`
  - tenant mode на `client.ordaops.kz`
- Для tenant-поддомена добавлен отдельный branded login experience:
  - название организации
  - домен организации
  - отдельный блок “доступ только для вашей команды”
  - различение входа для staff и операторов
- Для неизвестного tenant-поддомена добавлен отдельный экран, который не показывает платформенный контент и уводит на основной домен.

Важно:
- Теперь `f16.ordaops.kz` должен ощущаться как клиентский кабинет, а не как та же самая платформа на другом host.
- `ordaops.kz` остаётся platform/owner-контуром.

### Host-based tenant routing

Сделано:
- Добавлен runtime-resolver организации по `Host`:
  - новый helper `lib/server/tenant-hosts.ts`
  - поддерживается прямой поиск по полному host в `tenant_domains`
  - поддерживается fallback для старых записей, где в `tenant_domains.host` раньше хранился только `slug`
- `request-auth` теперь учитывает поддомен как источник активной организации.
- `proxy` теперь:
  - при заходе на поддомен принудительно использует организацию из host
  - не показывает `/select-organization`, если организация уже выбрана поддоменом
  - выкидывает пользователя на `/login` с очисткой auth-cookie, если он зашёл на чужой поддомен
  - сохраняет active organization cookie в соответствии с поддоменом
- Подготовлен сценарий:
  - `f16.ordaops.kz` -> автоматически открывает контур `F16`
  - без ручного переключения организации
  - без доступа к чужой организации через неверный subdomain

Важно:
- Кодовая часть host-based tenant routing уже внедрена.
- Финальное поведение начнёт работать после того, как wildcard `*.ordaops.kz` в Vercel станет `Valid Configuration` после DNS-пропагации.

### Apex maintenance отключён

Сделано:
- Временный maintenance-режим для `ordaops.kz` и `www.ordaops.kz` выключен.
- Основной домен больше не уводится принудительно на страницу техработ.

Важно:
- Страница `maintenance` и логика в middleware сохранены в проекте как резервный сценарий.
- При необходимости режим можно быстро включить обратно через `APEX_MAINTENANCE_MODE`.

### Owner flow и поддомены

Сделано:
- Улучшен стартовый owner-flow на `/select-organization` для супер-админа.
- Если организаций ещё нет, страница больше не показывает ложный сценарий про “нет доступа”, а ведёт к созданию первой организации как к главному действию.
- Добавлена автогенерация клиентского адреса из slug.
- Теперь при создании организации сразу рассчитываются:
  - `primaryDomain`
  - `appUrl`
- В `tenant_domains` теперь сохраняется полноценный host вида `f16.ordaops.kz`, а не просто `slug`.
- В SaaS-хабе и в форме создания теперь показывается будущий рабочий адрес клиента.
- Добавлен общий helper для tenant-domain логики:
  - базовый домен
  - host клиента
  - URL клиента
  - нормализация старых записей, где в `tenant_domains.host` лежал только slug

Важно:
- Автогенерация и сохранение поддомена уже подготовлены в коде.
- Для реальной работы поддоменов в браузере ещё потребуется инфраструктура:
  - wildcard DNS `*.ordaops.kz`
  - настройка хостинга / reverse proxy / Vercel domain routing
  - финальный host-based tenant resolution в runtime

### Maintenance-режим на основном домене

Сделано:
- Для основного домена `ordaops.kz` и `www.ordaops.kz` включён временный maintenance-режим.
- При заходе на основной домен пользователь перенаправляется на отдельную страницу техработ.
- На этом маршруте middleware принудительно очищает:
  - Supabase auth cookies
  - cookie активной организации
- Это временная мера на период переноса DNS, wildcard-доменов и поддоменного tenant-routing.

Важно:
- Режим включён флагом `APEX_MAINTENANCE_MODE = true` в `lib/core/site.ts`.
- После завершения инфраструктурного перехода флаг нужно будет выключить.

### SaaS, tenant и доступы

Сделано:
- Добавлен SaaS foundation:
  - `organizations`
  - `organization_members`
  - `subscription_plans`
  - `organization_subscriptions`
  - `tenant_domains`
  - `companies.organization_id`
- Текущие точки были подготовлены к модели:
  - `organization = F16`
  - `companies = точки внутри F16`
- Введён server-side organization context и active organization через cookie.
- Добавлен project hub и smart onboarding для организаций.
- Добавлены:
  - создание организации
  - создание точек внутри организации
  - приглашение участников организации
  - управление тарифами
  - billing lifecycle workspace
  - лимиты тарифа
  - доступы к страницам по подписке
- `/select-organization` переведён в full-page SaaS workspace и локализован на русский.
- Хаб выбора организаций и SaaS overview ограничены только супер-админом.
- Обычные пользователи теперь не должны:
  - попадать в `/select-organization`
  - переключать организации через sidebar
  - переключать организации через `/api/auth/active-organization`
  - получать SaaS overview через `/api/admin/organizations`
- Усилена tenant-изоляция операторского контура:
  - страницы операторов и доступов перестали читать чувствительные данные напрямую с клиента
  - отправка логинов и смена логина оператора теперь проверяют принадлежность к активной организации

Ключевые коммиты:
- `755b4d1` `feat(saas): add organization access foundation`
- `a7ae3c8` `feat(saas): harden remaining tenant-scoped APIs`
- `d88449b` `feat(auth): enforce organization selection on login`
- `0b89d37` `feat(auth): add project hub before workspace entry`
- `f45b07b` `feat(saas): add organization and project onboarding hub`
- `bb56b24` `feat(saas): add subscription management to project hub`
- `d10766e` `feat(saas): add organization invite flow`
- `1c2878b` `feat(saas): gate pages by subscription features`
- `049805b` `feat(saas): explain subscription upgrade requirements`
- `a27a0da` `feat(saas): redesign organization onboarding flow`
- `3fa44c3` `feat(saas): enforce tenant limits and settings`
- `e14de67` `feat(saas): add smart tariff management`
- `8e12281` `feat(saas): add billing lifecycle workspace`
- `de77eb5` `feat(saas): expand organization hub layout`
- `1ea50e7` `feat(saas): localize organization hub ui`
- `8743982` `fix(saas): prevent operator data leakage across organizations`
- `c421da2` `fix(saas): reserve organization hub for super admin`
- `8e208c3` `fix(saas): lock organization hub to super admin`

### Excel-экспорты

Сделано:
- Старые CSV/plain-xlsx экспорты заменены на styled ExcelJS export.
- В общий Excel-движок добавлены:
  - более сильное оформление
  - KPI-блоки
  - диаграммы
  - дашборды
  - оглавление
  - навигация по книге
  - скрытые raw-листы
  - формулы итогов
  - условное форматирование
- Крупные отчёты получили отдельные dashboard-листы.

Ключевые коммиты:
- `58f511f` `feat(excel): replace all CSV/plain-xlsx exports with styled ExcelJS`
- `313bd15` `fix(excel): add boolean to SheetRow index signature`
- `37f496c` `feat(excel): upgrade exports with dashboards and charts`
- `2e27290` `feat(excel): add workbook navigation and audit sheets`

### Telegram и AI-чек

Сделано:
- Добавлено распознавание photo receipt через GPT-4o vision.
- Отключён старый PDF parsing flow, пользователь переведён на фото-чек.
- Починен retry-loop и дедупликация обработки Telegram-документов.
- Улучшены voice/AI функции и финансовые инструменты в Telegram-контуре.

Ключевые коммиты:
- `4874782` `fix(telegram): deduplicate PDF processing to stop Telegram retry loop`
- `3f8ecd3` `feat(telegram): photo receipt parsing via GPT-4o vision`
- `d007188` `fix(telegram): remove PDF parsing, redirect to photo receipt`
- `70592c0` `fix(telegram): replace pdf-parse with native PDF text extraction`
- `3eaa281` `feat(telegram): PDF receipt → auto expense entry`
- `f85d59e` `feat(telegram): enhanced voice — auto lang detection, TTS reply, beautiful display`
- `f6d4dee` `feat(telegram): query_financials tool — exact data for any period/company`
- `9bd8df4` `fix(telegram): add voice type to message union for TypeScript`
- `623f0fa` `feat: voice messages, AI memory, realtime dashboard, shift reminders, fixed cron time`
- `2d89f2f` `fix(ai): include all companies and all expense categories in snapshots`

### Что осталось

Критично:
- добить tenant-изоляцию в `app/api/admin/settings/route.ts`
- пройти shared-справочники и решить, что должно стать `organization-scoped`
- внедрить полноценный `RLS` по `organization_id`
- проверить и дочистить оставшиеся `point/*`, `pos/*`, `telegram/*`, `operator/*` хвосты

Высокий приоритет:
- реальный billing flow с оплатой, просрочкой, апгрейдом и историей платежей
- owner dashboard для владельца SaaS
- доработка ролей и аудита действий
- финальный onboarding после создания организации

Ниже приоритетом:
- white-label и branding на уровне организаций
- тесты на tenant-изоляцию, тарифы и login flow

### 2026-04-01 — добивка tenant-изоляции

Сделано:
- `app/api/admin/settings/route.ts` теперь требует активную организацию и не позволяет супер-админу создавать или мутировать `companies`, `staff`, `expense_categories` вне выбранного tenant-контекста.
- `app/api/pos/bootstrap/route.ts` больше не отдаёт глобальные скидки и глобальный `loyalty_config` арендаторам без доступных компаний; пустой tenant scope больше не тянет общие данные кассы.
- `proxy.ts` теперь отфильтровывает `suspended` организации уже на edge-слое для staff/operator membership и tenant-host доступа.
- `lib/server/organizations.ts` теперь уважает выбранную активную организацию даже для super-admin: company/operator/staff scope больше не автоматически глобальный, если выбран tenant-контекст.
- `app/api/admin/profitability/route.ts` переведён в строгий org-context: без активной организации не читает и не пишет profitability inputs, а записи больше не создаются с `organization_id = null`.
- `app/api/admin/discounts/route.ts` перестал создавать и валидировать глобальные клиентские скидки без `company_id`; для не-super-admin скидка и промокод теперь всегда идут через tenant/company scope.
- `app/api/admin/staff/route.ts` теперь требует активную организацию для всех мутаций и всегда создаёт/синхронизирует `organization_members`, чтобы staff не появлялся в системе без org-привязки.
- Добавлена миграция `supabase/migrations/20260401_saas_core_rls.sql` с RLS для `organizations`, `organization_members`, `organization_subscriptions`, `tenant_domains`, `subscription_billing_events`.

Проверка:
- `npm run build` ✅
- `npm run typecheck` ✅

### 2026-04-02 — восстановление legacy data-flow после SaaS-поломок

Сделано:
- `lib/server/organizations.ts` временно переведён в `LEGACY_SINGLE_TENANT_MODE`, чтобы вернуть старое F16-поведение для общих helper'ов компаний, сотрудников, операторов и company-scope.
- `app/api/admin/settings/route.ts` больше не зависит только от service-role; добавлен fallback на request-scoped Supabase client, чтобы `/api/admin/settings` снова поднимал точки, команду и категории.
- `app/api/admin/expense-categories/route.ts` приведён к legacy-схеме без ожидания `organization_id`, чтобы экран расходов и справочник категорий перестали падать на старой базе.
- `app/(main)/categories/page.tsx` синхронизирован с legacy API категорий и больше не шлёт лишние SaaS-поля при создании/редактировании.
- `app/api/admin/operators/profile/route.ts` расширен: теперь сохраняет `telegram_chat_id` и весь профиль оператора через серверный API.
- `app/(main)/operators/[id]/profile/page.tsx` больше не пишет `operators` и `operator_profiles` напрямую из браузера при сохранении профиля.

Результат:
- проект снова ближе к досааS single-tenant F16-схеме
- критичные экраны, завязанные на `resolveCompanyScope` и `settings`, должны начать видеть старые данные как раньше
- операторский профиль перестаёт упираться в прямой browser-Supabase при сохранении

Проверка:
- `npm run build` ✅
- `npm run typecheck` ✅

### 2026-04-01 — восстановление данных на страницах после RLS

Сделано:
- `app/api/auth/session-role/route.ts` снова отдаёт полный набор полей, который ожидают старые страницы и сайдбар: `organizations`, `activeOrganization`, `activeSubscription`, `defaultPath`, `displayName`, `roleLabel`, флаги выбора организации.
- `lib/server/organizations.ts` получил legacy-fallback для single-tenant данных `F16`: если org-scoped записей нет, helpers подхватывают старые глобальные `companies`, `staff`, `operators`.
- `app/api/admin/settings/route.ts` получил `GET` и legacy fallback, чтобы точки, сотрудники и категории снова подтягивались даже из старых таблиц без `organization_id`.
- Добавлен маршрут `app/api/admin/expense-categories/route.ts` и через него переведены экраны категорий и формы расходов.
- На API переведены основные страницы, которые раньше читали Supabase напрямую и из-за RLS становились пустыми:
  - `app/(main)/dashboard/page.tsx`
  - `app/(main)/analytics/page.tsx`
  - `app/(main)/income/add/page.tsx`
  - `app/(main)/expenses/add/page.tsx`
  - `app/(main)/expenses/page.tsx`
  - `app/(main)/expenses/analysis/page.tsx`
  - `app/(main)/profitability/page.tsx`
  - `app/(main)/tax/page.tsx`
  - `app/(main)/settings/page.tsx`
  - `app/(main)/staff/page.tsx`
- `app/api/admin/companies/route.ts` и `app/api/admin/staff/route.ts` теперь умеют fallback на старые данные `F16`, если tenant-данных ещё нет.
- `app/api/admin/shifts/route.ts` расширен `includeSchedule=1` и теперь умеет серверно отдавать точки, операторов и смены; `app/(main)/shifts/page.tsx` переведён на этот API.

Проверка:
- `npm run typecheck` ✅
- `npm run build` ✅

### 2026-04-01 — super-admin вход на tenant-поддоменах

Сделано:
- `app/login/LoginForm.tsx` больше не уводит `super-admin` в `/platform`, если вход выполняется на tenant-поддомене организации.
- `proxy.ts` теперь принудительно выбрасывает любые попытки открыть `/platform` на tenant-host обратно в рабочий контур организации.
- Для `super-admin` на `f16.ordaops.kz` и других tenant-поддоменах платформа ведёт себя как вход в конкретную организацию, а не как глобальный SaaS-хаб.
- `app/api/auth/session-role/route.ts` теперь явно помечает `tenant context` и `platform context`.
- `components/sidebar.tsx` на tenant-поддоменах перестал показывать super-admin organization switcher и ведёт себя как контур конкретной организации.
- `lib/core/types.ts` расширен новыми полями контекста, чтобы UI мог жёстко разделять platform и tenant режимы.

Проверка:
- `npm run build` ✅
- `npm run typecheck` ✅

### 2026-04-01 — корень tenant-поддомена как точка входа

Сделано:
- `app/page.tsx` на tenant-поддоменах больше не показывает платформенный маркетинговый лендинг и сразу рендерит tenant-вход организации.
- `proxy.ts` перестал принудительно редиректить анонимного пользователя с tenant-root `/` на `/login`; теперь корень поддомена сам является branded entry page организации.
- Для `f16.ordaops.kz/` и остальных tenant-host теперь корректный UX: корень открывает вход организации, а не общий сайт платформы.

Проверка:
- `npm run build` ✅
- `npm run typecheck` ✅

### 2026-04-03 — расширен каталог страниц в матрице прав

Сделано:
- Экран `/access` переведён на общий каталог маршрутов из `lib/core/access.ts`, чтобы права брались из одного места для UI, сайдбара и middleware.
- В матрицу прав добавлены недостающие реальные маршруты проекта: `customers`, `discounts`, скрытые карточки операторов и зарплаты, `shifts/add`, `shifts/report`, `stations/*`, legacy-маршруты склада `/inventory/*`, старые operator-экраны, а также SaaS/platform-маршруты как отдельная группа.
- Теперь даже выключенные или пока не используемые страницы можно заранее видеть и включать из `/access`, а не ждать, пока они появятся в сайдбаре.

Проверка:
- `npm run typecheck` ✅
- `npm run build` ✅

### 2026-04-01 — временный rollback в single-tenant режим F16

Сделано:
- `ordaops.kz` временно переведён в тот же контур, что и `F16`: основной домен больше не считается отдельной SaaS-платформой и открывает вход в организацию `F16`.
- Добавлен fallback-resolver дефолтной организации по slug `f16` в `lib/server/tenant-hosts.ts`.
- `app/page.tsx` и `app/login/page.tsx` теперь рендерят tenant-login для `F16` и на apex-домене.
- `proxy.ts` больше не ведёт apex-пользователя в `/platform`; логика временно сведена к прямому входу в `F16` и редиректу `/platform -> /dashboard`.
- `app/api/auth/session-role/route.ts` и `app/platform/layout.tsx` синхронизированы с этим rollback-сценарием.

Проверка:
- `npm run build` ✅
- `npm run typecheck` ✅

### 2026-04-01 — полный rollback входа к apex-only режиму

Сделано:
- Полностью отключён активный subdomain split во входе: любые `*.ordaops.kz` теперь редиректятся обратно на `ordaops.kz`.
- `app/page.tsx` снова работает как обычная главная страница без tenant-подстановки по host.
- `app/login/page.tsx` снова работает как единый общий вход, без поддоменной логики и branded tenant-entry.
- `app/api/auth/session-role/route.ts` возвращён к общему apex-контексту без `tenant/platform` развилки.
- `app/platform/layout.tsx` снова работает как обычный layout платформы без host-based redirect.
- `proxy.ts` очищен от конфликтующей host-based логики и снова держит единый apex-flow.

Результат:
- рабочая точка входа снова одна: `ordaops.kz`
- поддомены временно не участвуют в логике входа
- цель этого отката: вернуть предсказуемый и стабильный доступ в систему

Проверка:
- `npm run build` ✅
- `npm run typecheck` ✅
