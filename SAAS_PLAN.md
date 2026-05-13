# Orda — План превращения F16 в SaaS

> **Концепция:** одна платформа `ordaops.kz`. Каждый клиент-компания получает свой поддомен `<slug>.ordaops.kz` и работает в едином рабочем портале. Внутри портала клиент видит только те модули, которые он купил. Продаём **3 продукта** (Club, Finance, AI) — можно купить любой по отдельности или все вместе как Suite со скидкой.

**Документ создан:** 2026-05-10
**Статус:** v2 — после уточнений (поддомен на тенанта, не на продукт; модульная покупка)

---

## Часть 1. Продуктовый портфель — 3 продукта

### Продукт 1: Orda Club (для игровых клубов)
- **Что внутри:** POS + склад + смены + операторы + клиенты + долги + Kiosk-терминал самообслуживания + Operator desktop приложение
- **Источник в коде:** `app/(main)/dashboard`, `shifts`, `operators`, `pos/`, `point/`, `app/api/point/*`, `app/api/kiosk/*`, `desktop/operator/`, `desktop/kiosk/`
- **Аналог:** Wipon, Umag, Senet (но целиком как продукт, не модулями)
- **ЦА:** игровые клубы, киберарены, PC-bang в KZ/СНГ (~3000+ клубов)
- **УТП:** AI-помощник оператора, готовый Kiosk с Kaspi QR, Telegram-отчёты владельцу, мультиточечность из коробки

### Продукт 2: Orda Finance (для любого малого бизнеса)
- **Что внутри:** доходы + расходы (с AI-распознаванием чеков) + зарплата + прогнозы + еженедельные AI-отчёты в Telegram + бюджеты + категории
- **Источник в коде:** `app/(main)/expenses`, `salary`, `incomes`, `dashboard` (финансовая часть), `lib/ai/forecast`, `cron/recurring-expenses`, `cron/telegram-daily`
- **Аналог:** Adesk, Финолог, ПланФакт
- **ЦА:** малый бизнес у кого уже есть касса где-то, но нет финучёта (кафе, барбершопы, СТО, автомойки, любые услуги)
- **УТП:** фото чека в Telegram → расход распознался → попал в категорию + еженедельный AI-разбор «куда уходят деньги»

### Продукт 3: Orda AI (Telegram-бот)
- **Что внутри:** Claude-powered Telegram-бот для владельца. Команды: `/доход`, `/расход`, `/прибыль`. Диалоговые запросы: «покажи худшие расходы за месяц». Голосовые команды (Whisper). Проактивные алерты («вчера было на 30% меньше выручки чем обычно»).
- **Источник в коде:** новый worker над `lib/ai/`, `app/api/cron/ai-insights`
- **ЦА:** владельцы Club/Finance + standalone — те у кого учёт ведётся в 1С/AmoCRM/Bitrix, и они хотят аналитику в Telegram
- **УТП:** «спроси бизнес как друга» — единственный диалоговый интерфейс к финансам в СНГ-сегменте

### Что НЕ отдельные продукты (важное уточнение)
- **Operator desktop** — компонент Orda Club. Доступен в тарифах Club Growth+. Не имеет смысла без склада и каталога товаров.
- **Kiosk** — компонент Orda Club. Доступен в Club Pro. Не имеет смысла без тарифов и клиентской БД.
- **Inventory / HR / CRM** — части Club или Finance, не самостоятельные SKU.

### На будущее (после 100 платящих клиентов)
- **Orda Connect** — публичный API + маркетплейс интеграций
- **Orda CRM** — выделить если CRM-функционал созреет
- **White-label** — отдельный Enterprise-tier для франшиз

---

## Часть 2. Pricing & Packaging

Двойная воронка: self-serve (одиночные точки) + sales-led (сети).

### Self-serve тарифы

| Тариф | Что включено | Цена |
|-------|--------------|------|
| **Finance Free** | 1 пользователь, 50 операций/мес — forever-free как lead magnet | $0 |
| **Finance Starter** | 3 пользователя, 1000 опер/мес, 1 компания | $9/мес |
| **Finance Growth** | 10 пользователей, AI-распознавание чеков, прогнозы, Telegram | $29/мес |
| **Finance Pro** | ∞ пользователей, мультикомпания, экспорт API | $69/мес |
| **Club Starter** | 1 точка, 3 оператора, POS+склад+смены — без Operator desktop, без Kiosk | $39/мес |
| **Club Growth** | 1 точка, ∞ операторов, Operator desktop, AI-помощник, **Finance Growth включён** | $89/мес |
| **Club Pro** | 3 точки, Kiosk, Telegram-отчёты, прогнозы, всё включено | $179/мес |
| **AI Add-on** | Telegram-бот привязан к Club или Finance | +$9-19/мес |
| **AI Standalone** | Бот без Club/Finance, через коннекторы к 1С/Adesk/AmoCRM | $19/мес |

### Bundle — Orda Suite

| Тариф | Что | Цена | Якорь скидки |
|-------|-----|------|-------|
| **Suite Starter** | Club Starter + Finance Starter + AI Add-on | $49/мес | вместо $57 |
| **Suite Growth** | Club Growth + AI Growth | $99/мес | вместо $108 (Finance уже в Club Growth) |
| **Suite Pro** | Club Pro + AI Growth | $189/мес | вместо $198 |

### Enterprise (sales-led)
- Custom от $500/мес
- Single Sign-On, dedicated БД-схема, white-label, SLA 99.9%, выделенный менеджер
- Подключаются: сети 5+ точек, франшизы, корпоративные клиенты

### Lead-magnet стратегия
- **Finance Free навсегда** — низкий порог входа, апсейл когда клиент перерастёт лимиты
- **AI Free** — 50 запросов/мес → конверсия в платный AI или Suite
- **F16 как кейс** — публичные цифры реальной точки → доверие

### Пример комбинаций (что покупает разный клиент)
- Кафе которому нужен только финучёт → Finance Starter ($9). Внутри `mycafe.ordaops.kz` видит только разделы доходы/расходы/зарплата.
- Игровой клуб целиком → Club Growth ($89). Внутри `cyberzone.ordaops.kz` видит POS, склад, смены, операторов, **финансы тоже** (потому что Finance Growth включён в Club Growth), но не видит Kiosk.
- Сеть из 3 клубов с премиум-фичами → Suite Pro ($189). Видит вообще всё.
- Клиент с Wipon у которого только финансы хромают → Finance Growth ($29). Покупает только финмодуль, остаётся на своей кассе.

---

## Часть 3. Технический фундамент — Multi-Tenancy

Цель: **строгая изоляция + zero data leak + zero performance cross-talk + один поддомен на тенанта**.

### 3.1 Модель поддоменов

```
ordaops.kz                  → главный лендинг (маркетинг, обзор продуктов)
ordaops.kz/club             → лендинг Orda Club
ordaops.kz/finance          → лендинг Orda Finance
ordaops.kz/ai               → лендинг Orda AI
ordaops.kz/pricing          → тарифы
ordaops.kz/signup           → регистрация
www.ordaops.kz              → редирект на apex
admin.ordaops.kz            → внутренняя superadmin-панель
status.ordaops.kz           → status page

*.ordaops.kz                → ТЕНАНТ-поддомены:
  major.ordaops.kz          → рабочий портал компании Major
  f16.ordaops.kz            → рабочий портал F16
  cyberzone.ordaops.kz      → рабочий портал Cyberzone
  mycafe.ordaops.kz         → рабочий портал MyCafe
```

**Один тенант = один поддомен.** Внутри портала клиент видит модули, которые купил. Продукт ≠ поддомен.

**DNS / Vercel:**
- В Vercel добавить `*.ordaops.kz` как domain (Vercel Pro даёт wildcard SSL)
- DNS: `*.ordaops.kz CNAME cname.vercel-dns.com`
- В `proxy.ts` уже есть `resolveOrganizationByHost` (`lib/server/tenant-hosts.ts`) — расширить чтобы поддерживало slug на apex (`major.ordaops.kz` → org с slug='major')
- Зарезервированные slug'и: `www`, `admin`, `status`, `api`, `app`, `mail`, `blog`, `docs`, `support`, `pricing`, `signup`, `login` — нельзя занимать клиентам

**Изменения в `proxy.ts`:**
```typescript
const hostname = request.headers.get('host') || ''
const apex = 'ordaops.kz'

if (hostname === apex || hostname === `www.${apex}`) {
  // маркетинговый сайт — никакой авторизации
  return NextResponse.next()
}

const subdomain = hostname.split('.')[0]
const RESERVED = new Set(['www', 'admin', 'status', 'api', 'app', 'mail', 'blog', 'docs', 'support'])

if (RESERVED.has(subdomain)) {
  // системные поддомены — своя логика
  return handleSystemSubdomain(subdomain, request)
}

const org = await resolveOrganizationBySlug(subdomain)
if (!org) {
  return NextResponse.redirect(`https://${apex}/404`)
}

if (org.status === 'suspended') {
  return NextResponse.redirect(`https://${apex}/billing/suspended`)
}

// прикрепляем тенанта к request
request.headers.set('x-tenant-org-id', org.id)
request.headers.set('x-tenant-slug', org.slug)
```

### 3.2 Видимость модулей через feature-flags

Каждая активная подписка содержит карту фич:

```typescript
// organization_subscriptions.features_jsonb
{
  // Orda Club модули
  pos: true,
  inventory: true,
  shifts: true,
  operators: true,
  customers: true,
  debts: true,
  operator_app: false,    // Operator desktop — только в Club Growth+
  kiosk: false,           // Kiosk — только в Club Pro

  // Orda Finance модули
  finance: true,          // доходы/расходы
  salary: true,           // зарплата
  forecasts: false,       // только в Growth+
  ai_receipts: false,     // только в Growth+

  // Orda AI
  ai_telegram_bot: 'starter',  // false | 'starter' | 'growth'

  // Лимиты
  limits: {
    companies: 1,
    operators: 3,
    users: 3,
    monthly_operations: 1000
  }
}
```

**В UI** sidebar и роуты гейтятся:
```typescript
// hooks/use-org-features.ts
export function useOrgFeatures() {
  const { activeSubscription } = useAccessContext()
  return activeSubscription?.features ?? defaultFeatures
}

// components/sidebar.tsx
const features = useOrgFeatures()
{features.pos && <SidebarItem href="/pos" label="Касса" />}
{features.finance && <SidebarItem href="/expenses" label="Финансы" />}
{features.kiosk && <SidebarItem href="/kiosk" label="Киоск" />}
```

**В API routes** проверяется capability:
```typescript
// app/api/admin/expenses/route.ts
const access = await getRequestAccessContext(request)
if (!hasFeature(access.activeSubscription, 'finance')) {
  return json({ error: 'feature_not_available', upsell: 'finance_starter' }, 403)
}
```

**Когда клиент апгрейдит подписку** → webhook от Stripe/Kaspi → обновляется `features_jsonb` → клиент перезагружает страницу → видит новые разделы. Без релиза кода.

### 3.3 F16 как Tenant Zero — миграция без потери данных

```sql
-- 20260512_f16_tenant_zero.sql
BEGIN;

-- 1. Создать организацию F16 (если ещё нет)
INSERT INTO organizations (id, slug, name, status, settings, branding)
VALUES (
  gen_random_uuid(),
  'f16',
  'F16 Arena',
  'active',
  '{}',
  '{"primary_color": "#0066FF"}'
)
ON CONFLICT (slug) DO NOTHING
RETURNING id;

-- 2. Привязать ВСЕ существующие companies к F16 (только те у кого NULL)
UPDATE companies
SET organization_id = (SELECT id FROM organizations WHERE slug='f16')
WHERE organization_id IS NULL;

-- 3. Аналогично для staff, operators
UPDATE staff SET organization_id = (SELECT id FROM organizations WHERE slug='f16')
WHERE organization_id IS NULL;

-- 4. Создать tenant_domain
INSERT INTO tenant_domains (organization_id, host, is_primary)
SELECT id, 'f16.ordaops.kz', true FROM organizations WHERE slug='f16'
ON CONFLICT (host) DO NOTHING;

-- 5. Внутренняя подписка Suite Pro Internal — без оплаты, навсегда
INSERT INTO organization_subscriptions (
  organization_id, plan_id, status, billing_period,
  starts_at, ends_at, features_jsonb, limits_override
)
SELECT
  o.id,
  'internal_suite_unlimited',
  'active',
  'custom',
  NOW(),
  NOW() + INTERVAL '100 years',
  '{"pos":true,"inventory":true,"shifts":true,"operators":true,"customers":true,"debts":true,"operator_app":true,"kiosk":true,"finance":true,"salary":true,"forecasts":true,"ai_receipts":true,"ai_telegram_bot":"growth"}'::jsonb,
  '{"companies":-1,"operators":-1,"users":-1}'::jsonb
FROM organizations o WHERE o.slug='f16'
ON CONFLICT DO NOTHING;

-- 6. Добавить себя как owner организации
INSERT INTO organization_members (organization_id, user_id, email, role, is_default)
SELECT
  o.id,
  (SELECT id FROM auth.users WHERE email='f16arena@gmail.com'),
  'f16arena@gmail.com',
  'owner',
  true
FROM organizations o WHERE o.slug='f16'
ON CONFLICT DO NOTHING;

COMMIT;
```

**Гарантии:**
- Только `INSERT` и `UPDATE`, никаких `DELETE`/`DROP`/`TRUNCATE`
- `ON CONFLICT DO NOTHING` — идемпотентно, можно перезапускать
- Транзакция → rollback если что-то упадёт
- Полный backup БД перед запуском (Supabase PITR)
- Сначала запустить на копии БД (staging) с проверкой что F16 продолжает работать

### 3.4 RLS на ВСЕ таблицы

Сейчас RLS только на 6 SaaS-таблицах. После flip `LEGACY_SINGLE_TENANT_MODE=false` все legacy-таблицы станут уязвимы.

**Миграция `20260513_rls_legacy_tables.sql`:**

```sql
-- Helper-функция: какие компании доступны текущему пользователю
CREATE OR REPLACE FUNCTION user_company_ids() RETURNS uuid[] AS $$
  SELECT COALESCE(ARRAY_AGG(c.id), ARRAY[]::uuid[])
  FROM companies c
  WHERE c.organization_id IN (
    SELECT om.organization_id
    FROM organization_members om
    WHERE om.user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_superadmin() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid() AND u.email = ANY(string_to_array(current_setting('app.superadmin_emails', true), ','))
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- companies — изоляция по organization_id
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "companies_tenant_isolation" ON companies
  USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
    OR is_superadmin()
  );

-- staff
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_tenant_isolation" ON staff
  USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
    OR is_superadmin()
  );

-- shifts, expenses, income, inventory_*, salary_*, point_*, supplier_debts ...
-- все через user_company_ids():
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shifts_tenant_isolation" ON shifts
  USING (company_id = ANY(user_company_ids()) OR is_superadmin());

-- ... повторить для всех 50+ таблиц с company_id
```

**Список таблиц нуждающихся в RLS** (нужно собрать полный из миграций):
- `companies`, `staff`, `operators`, `customers`
- `shifts`, `shift_week_publications`
- `expenses`, `income`, `recurring_expenses`
- `salary_*`, `weekly_salary_*`, `operator_salary_*`
- `inventory_items`, `inventory_locations`, `inventory_balances`, `inventory_movements`, `inventory_receipts`, `inventory_requests`, `inventory_request_items`
- `point_devices`, `point_projects`, `point_products`, `point_debt_items`
- `supplier_debts`
- `team_chat_*`, `news`, `direct_messages`
- `operator_*` (auth, salary, schedule, tasks)
- `client_*`, `bookings`

### 3.5 API audit — 252 routes

Скрипт-проверка:
```bash
# найти routes которые НЕ используют getRequestAccessContext или requirePointDevice
grep -L "getRequestAccessContext\|requirePointDevice\|requireOperatorAuth" app/api/**/route.ts
```

Каждый route должен:
1. Авторизоваться через стандартный механизм
2. Получить `companyScope` через `resolveCompanyScope()`
3. Все `supabase.from('table').select(...)` фильтровать по `companyScope.allowedCompanyIds`
4. На действия (POST/PUT/DELETE) проверять что ресурс принадлежит компании пользователя

Это **отдельный sprint на 1-2 недели** — самая критичная часть hardening'а.

### 3.6 Performance изоляция — «не грузить чужие данные»

Это твой ключевой реквест. Меры:

1. **Tenant-scoped query keys** в React Query / SWR:
```typescript
// hooks/use-shifts.ts
const { activeOrganization } = useAccessContext()
useQuery(['tenant', activeOrganization.id, 'shifts'], fetcher)
```
Разные тенанты → разные кеши, никогда не пересекаются на клиенте.

2. **Server Components scope:**
```typescript
// app/(main)/shifts/page.tsx
const access = await getRequestAccessContext()
const shifts = await db.shifts.findMany({
  where: { company_id: { in: access.allowedCompanyIds } }  // обязательно!
})
```

3. **Realtime channels per tenant:**
```typescript
// Не: supabase.channel('shifts')
// А: supabase.channel(`tenant:${orgId}:shifts`)
//    .on('postgres_changes', {
//       table: 'shifts',
//       filter: `company_id=in.(${userCompanyIds.join(',')})`
//    })
```
Канал привязан к тенанту, фильтр по company_id, RLS проверит на сервере.

4. **Index на каждую `company_id`/`organization_id`:**
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shifts_company ON shifts(company_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_company ON expenses(company_id);
-- и т.д. на все таблицы
```

5. **CDN-кэш per tenant:** Vercel Edge с `Vary: Host` → разные тенанты не пересекаются.

6. **Rate-limiting per tenant** (Upstash Redis): 100 req/min per org, защита от шумного соседа.

7. **Background jobs scoping:** все cron'ы (`vercel.json`) должны итерироваться по тенантам **только активным**, не глобально по всей БД:
```typescript
// app/api/cron/telegram-daily/route.ts
const orgs = await db.organizations.findMany({
  where: { status: 'active', subscription: { features_jsonb->'telegram_reports': true } }
})
for (const org of orgs) await sendDailyReport(org)
```

8. **Один тенант не может уронить другого:** очереди задач (Inngest / QStash) с tenant-tag, лимит конкуррентных задач per tenant.

### 3.7 Канареечный flip флага

Не выключать `LEGACY_SINGLE_TENANT_MODE` сразу. Поэтапно:

1. **Stage 1:** Добавить RLS, аудит API. Флаг остаётся `true`.
2. **Stage 2:** На staging БД flip → создать 3 тестовых тенанта → проверить отсутствие утечек (попытаться достать чужие данные через API, через Realtime, через клиент).
3. **Stage 3:** На prod — flip только для F16 через переменную `TENANCY_ENFORCED_FOR_ORGS=['f16-id']`. Остальные продолжают работать в legacy (если они есть).
4. **Stage 4:** Когда всё стабильно → flip глобально, удалить флаг из кода.

---

## Часть 4. Биллинг и онбординг

### 4.1 Платёжная инфраструктура
- **Kaspi Pay / CloudPayments** — KZ (KZT)
- **Stripe** — международные (USD)
- Абстракция: `lib/server/billing/provider.ts` с интерфейсом `BillingProvider` → две имплементации

### 4.2 Self-serve flow

```
ordaops.kz/signup
  ↓
[форма] email + password + название компании + желаемый slug
  ↓
проверка slug (не зарезервирован, свободен)
  ↓
создаётся organization(slug='major', status='trial')
создаётся organization_members(role=owner, user_id)
создаётся organization_subscriptions(plan='trial_suite', features=всё включено, ends_at=+14 дней)
  ↓
редирект на major.ordaops.kz/onboarding
  ↓
[wizard] 1. Выбор продукта (Club / Finance / AI / Suite)
         2. Создание первой компании/точки
         3. Приглашение коллег (опционально)
  ↓
работа в продукте
  ↓
[баннер] «Триал заканчивается через 3 дня»
email + Telegram уведомления
  ↓
checkout (Stripe или Kaspi widget)
  ↓
webhook → активация плана → features_jsonb обновился → новые модули доступны
```

### 4.3 Sales-led flow (Enterprise)
```
ordaops.kz/enterprise → форма «Опишите задачу, точек, бюджет»
  ↓
письмо + Telegram alert менеджеру
  ↓
Calendly демо (30 мин) → вход в HubSpot/Notion CRM
  ↓
договор → счёт через Kaspi Business
  ↓
admin.ordaops.kz → создание организации с custom features_jsonb
  ↓
менеджер делает onboarding (1-2 часа)
```

### 4.4 Что построить
- `/signup`, `/login`, `/forgot-password`
- `/billing/checkout?plan=club_growth` (Stripe Elements / Kaspi widget)
- `/billing` (внутри тенанта) — текущая подписка, история, апгрейд/даунгрейд, метод оплаты
- `/api/webhooks/stripe`, `/api/webhooks/kaspi` (события: subscription.created/updated/deleted, invoice.paid/failed)
- `/api/cron/check-subscriptions` (продлить, suspend, удалить — частично уже есть)
- Email infrastructure (Resend): templates trial-started, trial-ending-3d, trial-ending-1d, payment-failed, payment-success, suspended
- Telegram-уведомления (через `lib/server/telegram` который уже есть)
- Customer portal (Stripe Customer Portal или свой UI)

### 4.5 Динамическое обновление модулей
Когда подписка меняется (апгрейд / отмена add-on'а):
1. Webhook → обновляется `organization_subscriptions.features_jsonb`
2. Invalidate cache: `revalidateTag('org-features:${orgId}')`
3. Активные сессии при следующем запросе получают новые features
4. Sidebar и роуты автоматически перерисовываются

### 4.6 Гибкая покупка (модульно)
В checkout клиент может выбрать **любую комбинацию**:
```
[ ] Orda Club Starter         $39
[x] Orda Club Growth          $89
[ ] Orda Club Pro             $179

[x] Orda Finance Starter      $9   (или включён в Club Growth)
[ ] Orda Finance Growth       $29
[ ] Orda Finance Pro          $69

[x] AI Add-on (Telegram)      $9

────────────────────────────
ИТОГО без скидки:             $107
ИТОГО с Suite-скидкой:        $99 (экономия $8)

[Оформить как Suite Growth] [Оформить как отдельные продукты]
```
Suite-скидка применяется автоматически если выбрана определённая комбинация.

---

## Часть 5. Декомпозиция кода

**Не разделяем на отдельные репозитории.** Один Next.js, одна БД, разные модули включаются по подписке.

### Текущая структура → SaaS-структура (минимальные правки)

```
/                                  (текущий репо, переименовать в orda-platform)
├── app/
│   ├── (marketing)/               НОВОЕ — лендинги (orda.kz/club, /finance, /ai, /pricing)
│   │   ├── page.tsx               главный лендинг
│   │   ├── club/page.tsx
│   │   ├── finance/page.tsx
│   │   ├── ai/page.tsx
│   │   ├── pricing/page.tsx
│   │   ├── signup/page.tsx
│   │   └── enterprise/page.tsx
│   ├── (main)/                    ТЕНАНТСКИЙ ПОРТАЛ — то что сейчас
│   │   ├── dashboard/             общий + per-product виджеты по features
│   │   ├── pos/                   feature: pos
│   │   ├── shifts/                feature: shifts
│   │   ├── operators/             feature: operators
│   │   ├── store/                 feature: inventory
│   │   ├── expenses/              feature: finance
│   │   ├── salary/                feature: salary
│   │   ├── billing/               НОВОЕ — управление подпиской тенанта
│   │   └── settings/              профиль, slug, домены
│   ├── (admin)/                   НОВОЕ — superadmin панель (admin.ordaops.kz)
│   ├── (client)/                  как сейчас — публичный клубный портал
│   ├── pos/                       как сейчас — POS-терминал
│   ├── operator/                  как сейчас — кабинет оператора
│   └── api/                       как сейчас + новые routes
│       ├── billing/
│       │   ├── checkout/
│       │   └── portal/
│       ├── webhooks/
│       │   ├── stripe/
│       │   └── kaspi/
│       └── tenant/                управление организацией (slug, домены, members)
├── desktop/
│   ├── operator/                  как сейчас (Orda Operator — компонент Club)
│   └── kiosk/                     как сейчас (Kiosk — компонент Club)
├── workers/                       НОВОЕ
│   └── ai-telegram-bot/           Telegram-бот worker (Vercel Edge Function или отдельный сервис)
├── lib/
│   ├── core/                      как сейчас
│   ├── server/                    как сейчас + новое
│   │   ├── billing/               НОВОЕ — провайдеры Stripe/Kaspi
│   │   ├── features/              НОВОЕ — hasFeature(), useOrgFeatures()
│   │   └── tenant-resolver.ts     НОВОЕ — resolveOrganizationBySlug
│   ├── domain/                    как сейчас
│   └── ai/                        как сейчас
└── supabase/migrations/
    ├── 20260512_f16_tenant_zero.sql
    ├── 20260513_rls_legacy_tables.sql
    ├── 20260514_features_helpers.sql
    └── 20260515_billing_tables.sql  (платежи, инвойсы, события)
```

### Маршрутизация по поддоменам в Next.js

В `proxy.ts` (middleware):
- `ordaops.kz` или `www.ordaops.kz` → `/(marketing)/*`
- `<slug>.ordaops.kz` → `/(main)/*` с прикреплённым tenant
- `admin.ordaops.kz` → `/(admin)/*`
- API всегда доступен как `<slug>.ordaops.kz/api/*` (или единый `api.ordaops.kz/api/*`)

Использовать **rewrite** (не redirect) в middleware для подмены пути:
```typescript
if (subdomain && !RESERVED.has(subdomain)) {
  return NextResponse.rewrite(new URL(`/(main)${pathname}`, request.url), {
    request: { headers: requestHeaders }
  })
}
```

---

## Часть 6. Roadmap — 6 месяцев

### Месяц 1 — Tenancy Hardening
*Без новых фич, только фундамент.*
- [ ] Backup F16 production БД (Supabase PITR snapshot)
- [ ] Создать staging-копию БД для тестирования
- [ ] Миграция `20260512_f16_tenant_zero.sql` (создание org F16, привязка companies)
- [ ] Миграция `20260513_rls_legacy_tables.sql` (RLS на 50+ таблиц)
- [ ] Миграция `20260514_features_helpers.sql` (helper-функции, indexes)
- [ ] **Аудит 252 API routes** — добавить `resolveCompanyScope` где не хватает (1-2 недели работы)
- [ ] Index на `company_id`, `organization_id` во всех таблицах
- [ ] Realtime каналы переписать на `tenant:${orgId}:${table}`
- [ ] Тестирование на staging — 3 тестовых тенанта, попытка утечки данных
- [ ] Rate-limiting (Upstash Redis) на API routes
- [ ] Stage 3 flip: enforced для F16 на prod
- **Deliverable:** F16 работает в multi-tenant режиме, готов к подключению второго тенанта без рисков

### Месяц 2 — Биллинг + поддомены + signup
- [ ] Wildcard `*.ordaops.kz` в Vercel + DNS
- [ ] `proxy.ts` — slug-based routing (`major.ordaops.kz` → tenant)
- [ ] Stripe интеграция (test mode, потом live)
- [ ] Kaspi Pay интеграция (или CloudPayments)
- [ ] Webhooks обработка
- [ ] Signup flow (`/signup` на маркетинге)
- [ ] Onboarding wizard (`/onboarding` внутри тенанта)
- [ ] Trial logic (14 дней, suspend, продление)
- [ ] Email infrastructure (Resend) — 5 шаблонов
- [ ] Telegram-уведомления о биллинге
- [ ] Admin billing page (`/billing` внутри тенанта)
- [ ] Superadmin panel (`admin.ordaops.kz`) — minimum: список организаций, ручное создание Enterprise
- **Deliverable:** новая компания может зарегистрироваться → 14 дней trial → оплатить → продолжить

### Месяц 3 — Запуск Orda Club (флагман)
- [ ] Лендинг `ordaops.kz/club` (apps/marketing)
- [ ] Демо-видео (10 мин, скринкаст реальной работы в F16)
- [ ] Документация (`docs.ordaops.kz` — Notion или Mintlify)
- [ ] Pricing page с переключателем месячно/годовно
- [ ] Кейс «Как F16 оптимизировала смены и заработала +X%» (блог)
- [ ] Soft launch: 5 знакомых клубов бесплатно за обратную связь и кейс
- [ ] Установить аналитику: PostHog, Plausible
- [ ] Public Telegram-канал «Сила бизнеса» — первый пост: «Как мы запустили Orda»
- **Deliverable:** первые 3 платящих клиента вне F16

### Месяц 4 — Запуск Orda Finance
- [ ] AI-распознавание чеков (фото в Telegram → расход) — построить, если нет
- [ ] Forever-free план настроен в БД
- [ ] Лендинг `ordaops.kz/finance`
- [ ] 5 SEO-статей: «как считать прибыль кафе», «налоги ИП в KZ», «учёт расходов барбершопа», «AI для финансов малого бизнеса», «обзор Adesk vs Финолог vs Orda»
- [ ] Видео-демо «Сфоткал чек → расход в учёте за 3 секунды»
- **Deliverable:** 50 free регистраций + 10 платящих

### Месяц 5 — Orda AI (Telegram-бот)
- [ ] Worker `workers/ai-telegram-bot` — связка `webhook → Claude → ответ`
- [ ] Команды: `/доход`, `/расход`, `/прибыль`, `/прогноз`
- [ ] Диалоговый режим: «покажи худшие расходы за месяц»
- [ ] Голосовые команды (Whisper API)
- [ ] Проактивные алерты (cron + правила: «выручка < 30% от среднего»)
- [ ] Привязка бота к organization через deep-link `/start <signed-token>`
- [ ] Standalone режим — коннекторы (1С Web API, AmoCRM, Bitrix24, Excel-импорт)
- [ ] Лендинг `ordaops.kz/ai`
- **Deliverable:** AI бот в production, 100+ установок (free + paid)

### Месяц 6 — Enterprise + рост
- [ ] White-label: возможность клиенту привязать свой домен (`work.major.kz`)
- [ ] Sales materials (deck, ROI калькулятор)
- [ ] Программа реселлеров (партнёрский кабинет)
- [ ] Outreach к 20 крупным сетям
- [ ] Первый Enterprise-договор
- **Deliverable:** $10k MRR, 50 платящих клиентов

### Месяц 7+ — Масштабирование
- API marketplace (Orda Connect)
- Реселлеры в РФ/Узбекистане/Кыргызстане
- Кастомизация под франшизы
- Mobile app для владельцев

---

## Часть 7. Маркетинг и Sales

### 7.1 Контент-стратегия
| Канал | Контент | Цель |
|-------|---------|------|
| **YouTube** | Обзоры Wipon vs Orda, кейсы клубов, гайды по бизнесу | SEO долгосрок |
| **Telegram «Сила бизнеса»** | Цифры F16, разборы конкурентов, AI-инсайты | Build in public |
| **Instagram/TikTok** | Reels с фишками POS, AI-помощник в действии | Brand awareness |
| **vc.ru / Habr** | Технические статьи, кейсы, истории | B2B-доверие |
| **SEO-блог** | «Как открыть киберклуб», «учёт расходов кафе», «Wipon обзор» | Органика |

### 7.2 Build in Public с F16
F16 = главный кейс. Каждую неделю в Telegram:
- Сколько F16 заработала
- Что улучшили в Orda на основе F16
- Сколько часов сэкономил AI

→ единственный реальный конкурентный пункт против Wipon/Umag: **«мы используем то что продаём»**.

### 7.3 Партнёрская программа
- 20% recurring за 12 мес каждому кто привёл клиента
- Реселлеры в Узбекистане, России, Кыргызстане — 30% lifetime + локализация

### 7.4 Customer Success
- Onboarding-звонок 30 мин для всех Growth+
- WhatsApp/Telegram support 9-21 KZ
- NPS опрос на 30/90 день
- Knowledge base + AI-помощник внутри продукта (`/help` — Claude отвечает по docs)

---

## Часть 8. Метрики

### North Star Metric
**MRR (Monthly Recurring Revenue)** — главная метрика.

### Per-product
- **Orda Club:** ARPU, churn, активные смены/мес, % использующих Operator desktop
- **Orda Finance:** % конверсии free→paid, AI-чеков распознано/мес
- **Orda AI:** запросов на пользователя, retention day 7/30, % проактивных алертов открытых

### Воронка
- Visitor → Signup: ≥ 3%
- Signup → Activated (1-я операция за 7 дней): ≥ 50%
- Activated → Paid: ≥ 25%
- Paid → Retained 6 мес: ≥ 70%

### Финансовые
- LTV / CAC > 3
- Payback < 12 мес
- Gross margin > 75%

### Стек
- **PostHog** — продуктовая аналитика, feature flags, session replay
- **Stripe Sigma** — финансы
- **Plausible** — лендинги
- **Metabase на read-replica Supabase** — внутренний BI

---

## Часть 9. Риски и митигации

| Риск | Вероятность | Импакт | Митигация |
|------|-------------|--------|-----------|
| Утечка данных между тенантами после flip | High | Critical | RLS на все таблицы + API audit + canary deploy + bug bounty $500 |
| F16 потеряет данные при миграции | Low | Critical | PITR backup + rollback план + транзакция + dry-run на staging |
| Wipon/Umag копируют AI-фичи | Medium | High | Скорость, build in public, лучший UX |
| Низкая конверсия self-serve | Medium | High | Forever-free Finance + AI lead magnet + двойная воронка |
| Kaspi не интегрируется быстро | High | Medium | Запуск со Stripe (USD) первым, Kaspi во 2-м месяце |
| Технический долг в legacy-коде | High | Medium | Месяц 1 — только hardening, никаких новых фич |
| Отвлечение на 3 продукта параллельно | Medium | High | Запускаем последовательно (Club → Finance → AI) |
| Шумный сосед грузит общую БД | Medium | Medium | Rate-limiting + per-tenant query budgets + мониторинг |

---

## Часть 10. Открытые вопросы

1. **Брендинг:** оставляем `ordaops.kz` или короче `orda.kz`? Для визиток короче лучше, но дороже.
2. **Юрлицо:** ИП Казахстан / ТОО / международное (для Stripe USD)? Влияет на платёжную инфраструктуру.
3. **Команда:** один разработчик (ты) или будет команда? Roadmap на 6 мес для одного очень напряжённый — реалистичнее 9 мес.
4. **Бюджет на маркетинг:** ноль / ~$1k/мес / больше? От этого скорость роста.
5. **Telegram AI agent — для кого приоритет:** владелец / сотрудники / клиенты? В плане «для владельца», можно расширить.
6. **Standalone Orda AI** — есть ли смысл коннекторов к 1С/AmoCRM, или отказаться и продавать только владельцам Club/Finance?

---

## Часть 11. Текущее состояние кодовой базы (snapshot 2026-05-10)

**Что уже сделано (фундамент SaaS):**
- БД: `organizations`, `subscription_plans`, `organization_subscriptions`, `tenant_domains`, `organization_members`, `organization_billing_events`
- RLS: 6 политик на core SaaS-таблицах (`20260401_saas_core_rls.sql`)
- Поддомены: `proxy.ts:165` + `lib/server/tenant-hosts.ts` + `resolveOrganizationByHost`
- Авторизация: `getRequestAccessContext()` (`lib/server/request-auth.ts:103`) возвращает organizations, activeOrganization, activeSubscription
- Лимиты: `assertOrganizationLimitAvailable()` (`lib/server/organizations.ts:463`)
- Capability-based RBAC в proxy.ts

**Чего нет / критичные gaps:**
- `LEGACY_SINGLE_TENANT_MODE = true` (`lib/server/organizations.ts:53`) — изоляция отключена
- Платёжные интеграции (Stripe/Kaspi) — нет
- UI checkout/billing — нет
- RLS на legacy-таблицах (`companies`, `staff`, `shifts`, `expenses`, `inventory_*`) — нет
- Аудит 252 API routes на корректную фильтрацию — не делался
- Wildcard DNS + signup flow — нет
- Rate-limiting — нет
- Email infrastructure (Resend) — нет
- Feature-flag система в UI — нет

**Ключевые файлы для работы:**
- `lib/server/request-auth.ts:103` — getRequestAccessContext
- `lib/server/organizations.ts:53` — LEGACY_SINGLE_TENANT_MODE flag (выключить позже)
- `lib/server/organizations.ts:591` — resolveCompanyScope
- `lib/server/tenant-hosts.ts` — resolveOrganizationByHost (расширить)
- `proxy.ts` — middleware (добавить slug-routing)
- `supabase/migrations/20260331_saas_foundation.sql` — SaaS БД
- `supabase/migrations/20260401_saas_core_rls.sql` — текущие RLS политики
- `vercel.json` — cron jobs (14 заданий)
- `components/sidebar.tsx` — нужно гейтить пункты меню по features
