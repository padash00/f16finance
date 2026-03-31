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

## 2026-03-31

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
