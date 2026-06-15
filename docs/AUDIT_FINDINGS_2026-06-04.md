# Аудит Orda Point — находки и план фиксов (2026-06-04)

Полный анализ актуальной версии (280 роутов) силами 20 агентов. Ниже — приоритизированный список того, что чинить. Каждый пункт со ссылками `файл:строка`.

Стек: Next.js 16.0.7, React 19.2, Supabase, 280 API-роутов, 155 страниц, 203 миграции, 2 Electron-приложения.

Статус: **ничего ещё не исправлено** — это бэклог на потом.

---

## ✅ ИСПРАВЛЕНО (2026-06-04): занижение цифр на дашборде reports

**Баг:** `/api/admin/reports/bundle` грузил доходы и расходы одним запросом `.range(0, 9999)` без чанковой пагинации, упираясь в PostgREST `db-max-rows` (~1000). Так как запрос тянул текущий + предыдущий период, отсортированные по дате по возрастанию, обрезались самые свежие даты. Дашборд «Центр управления» занижал выручку и расходы и завышал маржу.

**Подтверждено данными** (период 01.01–31.05.2026, реальная БД):
- Доход: страница income/БД = 65 054 394, reports показывал 60 165 937 (терял 4.9M — половину мая).
- Расход: страница expenses/БД = 55 320 993, reports показывал 37 609 441 (терял 17.7M — весь май + апрель + часть марта).
- Расходы резались сильнее доходов, т.к. строк больше (≈256/мес против ≈151), и общий лимит исчерпывался на 2 месяца раньше. Оба запроса обрывались ровно на ~690 строках текущего периода — это и есть лимит БД.

**Фикс:** `app/api/admin/reports/bundle/route.ts` — добавлен `fetchAllRows()` с чанковой загрузкой по 1000 и стабильной сортировкой `(date, id)`; income/expense тянутся полностью. Typecheck + eslint зелёные. Деплой на стороне владельца.

---

## 🔴 P0 — критично (до продакшена / включения SaaS)

### Системные дыры авторизации
- [ ] **C1. `requireStaffCapabilityRequest` — no-op** (`lib/server/request-auth.ts:285`): `if (staffRole) return null`, проверка прав недостижима. Заменить вызовы на реальный `requireCapability(access, '<page>.view')`. Затронуты GET-роуты с PII/зарплатами: `app/api/admin/operators/route.ts:53`, `admin/salary/route.ts:549,624`, `admin/shifts/route.ts:624`.
- [ ] **C2. Оператор проходит staff-guard**: `normalizeStaffRole(null)='other'` (truthy) (`lib/core/access.ts:572`). Ввести `requireStaff(access) = isSuperAdmin || !!staffMember` и заменить все `!!access.staffRole` (напр. `app/api/admin/store/warehouse/route.ts:16-23`).
- [ ] **C3. `proxy.ts:95-97` пропускает все `/api/*`** без RBAC. Добавить минимальный гард (отсечь не-staff на `/api/admin/*`, не-operator на `/api/operator/*`) как defense-in-depth.
- [ ] **LEGACY_SINGLE_TENANT_MODE=true** (`lib/server/organizations.ts:53`) делает `resolveCompanyScope` no-op — вся защита по company_id неактивна. Перед SaaS — сплошной аудит + RLS на legacy-таблицах. Сейчас задокументировать как known-limitation.

### Эскалация привилегий (любой залогиненный → больше прав)
- [ ] **`reset-password`** (`app/api/reset-password/route.ts:8`) — `requireAdminRequest` не проверяет роль → любой меняет пароль любому. Добавить `isSuperAdmin`/owner-гард.
- [ ] **`telegram/allowed-users` + `telegram/setup`** (`app/api/telegram/allowed-users/route.ts:29`, `setup/route.ts:5`) — любой авторизованный добавляет себя с `can_finance:true` → super_admin в боте. Закрыть на `isSuperAdmin`.
- [ ] **`positions` POST `seed:'open'`** (`app/api/admin/positions/route.ts:80`) — любой staff создаёт роль с 265 capabilities. → super-admin only.
- [ ] **`settings` POST entity=staff** (`app/api/admin/settings/route.ts:204`) — смена `role` без capability. Добавить `requireCapability('staff.edit')`.
- [ ] **`operator-career` POST** (`app/api/admin/operator-career/route.ts:50`) и **`operators/profile` GET/PATCH** (`app/api/admin/operators/profile/route.ts:11`) — создание staff-роли / перезапись чужого профиля без прав.
- [ ] **`update-operator-login`** (`app/api/admin/update-operator-login/route.ts:8`) — смена email оператора в Auth без capability.
- [ ] **`api/goals` POST** (`app/api/goals/route.ts:27`) и **`tax/910-form` POST** (`app/api/admin/tax/910-form/route.ts:42`) и **`valuation` GET** (`app/api/admin/valuation/route.ts:47`) и **`kpi-plans` POST/DELETE** — без capability.

### PostgREST-инъекция в `.or()` (неэкранированный ввод)
- [ ] `app/api/kiosk/client/login/route.ts:32`, `app/api/point/customers/route.ts:29`, `app/api/admin/arena/route.ts:671,694` (ещё и без company_id!), `app/api/team-chat/route.ts:56`, `kiosk/register/route.ts:59`, `kiosk/heartbeat/route.ts:80`, `kiosk/debug/route.ts:34`. Фикс: раздельные `.eq()` (паттерн `findCustomerByLogin` из `qr-login`) или экранирование `,()%*.:`.

### Kiosk RCE
- [ ] `desktop/kiosk/main/main.js:568` → `launcher.js:14` `spawn(gamePath)` — путь EXE из неаутентифицированной broadcast/WS-команды, под Администратором. Запускать только из одобренного каталога по `gameId`; аутентифицировать команды канала; приватные Realtime-каналы Supabase для `kiosk:*`. Те же `shutdown_pc`/`reboot_pc`.

### RLS using(true) на новых модулях (межтенантное чтение)
- [ ] Заменить на tenant-scoped: `team_chat_messages` (`20260509_team_chat.sql:38`), `direct_messages` (`:40`), `supplier_debts` (`20260430_supplier_debts.sql:125`), `ai_memory/reminders/goals` (`20260507_copilot_tools_schema.sql:34,67,100`), `salary_calculation_*` (`20260508:23,29`), `news_posts`. Особенно важно из-за Realtime-публикаций.

### AI-копилот без company-scope
- [ ] `lib/ai/copilot/*` tools используют admin-клиент без `resolveCompanyScope`: `query-revenue.ts:71`, `add-expense.ts:35`, `refund-sale.ts:22`. `ai_memory` читается без org-фильтра (`engine.ts:663`). Скоупить по `ctx.organizationId`.

### IDOR в чатах
- [ ] `direct-messages` POST — ЛС любому `recipientUserId` без проверки орг (`app/api/direct-messages/route.ts:78`); `reactions/polls/pin` без org-scope; `team-chat/profile` отдаёт PII любого оператора (`team-chat/profile/route.ts:33`).

### Приватные данные в git
- [ ] `git rm expenses_2026-05-11.xlsx`, добавить `*.xlsx` в `.gitignore`. История на GitHub (commit `e8fc0713`) — рассмотреть filter-repo + ротацию данных. Также вынести `orda_electron/`.

---

## 🟠 P1 — высокий

- [ ] **admin-tokens на serverless — функциональный баг** (`lib/server/admin-tokens.ts:9`): токен с одного инстанса невалиден на другом → ломает super-admin point-API. → Vercel KV / БД / stateless JWT.
- [ ] **rate-limit неэффективен** (`lib/server/rate-limit.ts:9`): in-memory Map, обход через `x-forwarded-for`. → Upstash/KV. Добавить лимит в `kiosk/client/login`, `point/login`, `public/*`.
- [ ] **Cron fail-open**: `expire-pins:16`, `chat-moderation:78`, `hr-daily-digest:61`, `inventory-integrity:62` — при пустом `CRON_SECRET` открыты; доверие к `User-Agent: vercel-cron`. → везде `requiredEnv('CRON_SECRET')`.
- [ ] **Зарплата — занижение оборота**: `lib/server/repositories/salary.ts:206` не выбирает `online_amount` → занижаются авто-бонусы (расхождение web vs Telegram). Также `repositories/salary.ts:216` — фильтр корректировок по `date` теряет авансы.
- [ ] **netAmount — две формулы** (`lib/domain/salary.ts:894-925`): per-company не включает autoBonus, агрегат включает → аллокации не сходятся с итогом.
- [ ] **Electron plaintext-токены**: `clientSecret`/`deviceToken` в `config.json` → `safeStorage` (DPAPI). `desktop/kiosk/main/config-store.js:19`.
- [ ] **cancelReceipt не сторнирует** `expenses`/`supplier_debts` (`app/api/admin/store/receipts/route.ts:222`) → расхождение учёта.
- [ ] **Прямые upsert inventory_balances** в обход RPC (Excel-импорт, addStock set) — могут нарушить инвариант резервов. `store/warehouse/route.ts`, `inventory/catalog/route.ts:615`.
- [ ] **writeoffs без capability** (`app/api/admin/store/writeoffs/route.ts:89`) — только `canManageStore`.
- [ ] **shift/close без проверки владельца** (`app/api/operator/shift/close/route.ts:88`) — любой оператор компании закрывает чужую смену.
- [ ] **CSP + HSTS** в `next.config.mjs` (остальные заголовки есть). **timingSafeEqual** для всех секретов (webhook, cron) вместо `===`.
- [ ] **N+1 в getRequestAccessContext** (`request-auth.ts:136-188`): 6-9 последовательных Supabase-запросов на web-запрос. → Promise.all + React.cache.
- [ ] **123 роута возвращают сырой `error.message`** клиенту → обобщённый код + лог через `writeSystemErrorLogSafe`.

---

## 🟡 P2 — качество кода

### Монстры-компоненты (разбить)
- `stations/[projectId]/page.tsx` — 3471 строк (83 useState!), `reports` 2989, `operators/[id]/profile` 2756, `inventory` 2580, `expenses` 2393, `salary/rules` 2186, `salary` 2102, `income` 1996, `profitability` 1899, `dashboard` 1790.

### Прочее
- [ ] Добавить `error.tsx` в финансовые сегменты (шаблон — `profitability/error.tsx`); подключить `components/error-boundary.tsx` (сейчас не используется).
- [ ] Удалить мёртвый код (~4000 строк): `inventory/abc` (654, дубль `store/abc`), орфан `inventory/page.tsx`, `components/ui/sidebar.tsx` (726), `AvatarUpload/DocumentUpload/DocumentList` (635), ~12 неиспользуемых shadcn ui/.
- [ ] Чаты на Supabase Realtime вместо `setInterval(3000)` (`team-chat/page.tsx:115`, `messages/page.tsx:80`).
- [ ] Дубли: 3 AI-чата → `useAssistantChat()`; fetch-логика → `useApi` (используют 2 из 18); `roundMoney` в 3 местах → `lib/core`; локальные `todayISO` → импорт `lib/core/date`.
- [ ] AbortController во все fetch-страницы (сейчас ~15); убрать `: any` (stations 44, salary 22); `key={index}` → стабильные id в динамических списках.

### Инфраструктура
- [ ] Унифицировать пакетный менеджер (`packageManager: pnpm`, но CI+установка npm; `pnpm-lock.yaml` — заглушка).
- [ ] `.env.example`: добавить `CRON_SECRET`, `KIOSK_PROVISIONING_KEY`, `KIOSK_HEARTBEAT_SECRET`, `OPENAI_API_KEY`+`OPENAI_*`.
- [ ] Доки: CLAUDE.md/README врут — AI на **OpenAI** (`gpt-4o-mini`), не Anthropic. Версия operator 2.7.0 (не 2.3.x). Заголовки kiosk `x-kiosk-secret` (не `x-device-token`).
- [ ] `usage-tracker.ts:22` cost-map не содержит реальную модель → учёт затрат AI сломан. Унифицировать дефолт модели (3 разных: gpt-4o-mini / gpt-5-mini).
- [ ] `xlsx@0.18.5` — CVE (Prototype Pollution + ReDoS), фикса в npm нет → мигрировать на `exceljs` или SheetJS CDN.
- [ ] Code signing для NSIS-сборок (operator + kiosk).
- [ ] `assistant.ts:15` хардкод `DEFAULT_DATE='2026-03-15'` → текущий период.

### База данных
- [ ] `audit_log` без `organization_id` (не изолирован по арендатору).
- [ ] `inventory_items.barcode` глобально unique при per-org каталоге → `(organization_id, barcode)`.
- [ ] FK на `auth.users` для `created_by`/`approved_by`/`actor_user_id` (сейчас nullable без FK).
- [ ] Покрыть `inventory_decide_request` (6+ багфиксов) и домен зарплаты unit-тестами — инфраструктуры тестов в проекте нет.

---

## Что сделано хорошо (не трогать)
- Чистый домен зарплаты (`lib/domain/salary.ts`) — тестируемые функции, корректная денежная арифметика, версионирование правил.
- Транзакционные RPC склада с `FOR UPDATE` (`inventory_decide_request`, `inventory_apply_balance_delta`, `kiosk_deduct_balance`).
- RLS-фундамент ядра (companies/inventory/POS/salary) через security-definer хелперы; `search_path` hardening; закрыты исторические `anon INSERT`.
- Нет захардкоженных секретов; токены киоска/клиента — sha256-хеши с TTL.
- Эталонные страницы: `reports` (memo+виртуализация), `store/warehouse` (abort+debounce), `app/operator/page.tsx`.
- Telegram webhook — обязательный секрет, fail-closed (503).
