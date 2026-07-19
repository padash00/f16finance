# Orda Point — CLAUDE.md

Система управления игровым клубом / точкой продаж. Три клиента на одной БД Supabase через единый Next.js API.

## Главное правило архитектуры

> Supabase доступен ТОЛЬКО через Next.js API routes. Никакого прямого доступа к Supabase из Electron приложений.

Electron apps общаются с сервером через:
- Operator: `x-point-device-token` header → `/api/point/*`
- Kiosk: `x-device-token` + `x-client-secret` → `/api/kiosk/*`

## Аутентификация

| Клиент | Механизм | Где проверяется |
|--------|----------|-----------------|
| Web admin/staff | Supabase Auth (сессионные куки) | `lib/server/request-auth.ts` → `getRequestAccessContext()` |
| Operator desktop | `x-point-device-token` в заголовке | `lib/server/point-devices.ts` → `requirePointDevice()` |
| Kiosk | `x-device-token` + `x-client-secret` | `/api/kiosk/*` internal auth |

## Роли (staffRole)

`owner` > `manager` > `other` — проверяются в каждом API route через `canManage()` / `canView()`.
SuperAdmin (`isSuperAdmin`) обходит все ограничения.

## Ключевые файлы

| Файл | Что делает |
|------|-----------|
| `proxy.ts` | Middleware: мультитенантность, auth, редиректы |
| `lib/server/request-auth.ts` | `getRequestAccessContext()` — стандартный способ авторизовать API route |
| `lib/server/point-devices.ts` | `requirePointDevice()` — авторизация operator/kiosk по токену |
| `lib/server/organizations.ts` | `resolveCompanyScope()` — возвращает `allowedCompanyIds` (null = все) |
| `lib/server/audit.ts` | `writeAuditLog()` — логировать действия |
| `lib/server/supabase.ts` | `createAdminSupabaseClient()` — обходит RLS |
| `lib/domain/salary.ts` | Расчёт зарплаты (чистая логика) |
| `components/sidebar.tsx` | Навигация — сюда добавлять новые пункты меню |
| `desktop/kiosk/main/main.js` | Electron main process киоска |
| `desktop/operator/electron.cjs` | Electron main process оператора |

## Паттерны кода в API routes

```typescript
// Стандартный GET route
export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response  // не авторизован
  if (!canView(access)) return json({ error: 'forbidden' }, 403)

  const supabase = hasAdminSupabaseCredentials()
    ? createAdminSupabaseClient()
    : access.supabase

  const companyScope = await resolveCompanyScope({
    activeOrganizationId: access.activeOrganization?.id || null,
    isSuperAdmin: access.isSuperAdmin,
  })

  // companyScope.allowedCompanyIds === null → superadmin, не фильтровать
  // companyScope.allowedCompanyIds === [...] → фильтровать по этим компаниям
  const query = supabase.from('table').select('...')
  if (companyScope.allowedCompanyIds) query.in('company_id', companyScope.allowedCompanyIds)
}
```

```typescript
// Стандартный Point API route
export async function POST(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response

  const { supabase, device } = point
  // device.company_id, device.point_mode, device.company?.name
}
```

## Инвентарь — таблицы БД

| Таблица | Назначение |
|---------|-----------|
| `inventory_items` | Каталог товаров (name, barcode, unit, sale_price) |
| `inventory_locations` | Места хранения (warehouse / point_display) per company |
| `inventory_balances` | Остатки: (location_id, item_id) → quantity |
| `inventory_movements` | История движений |
| `inventory_receipts` | Приходы (от поставщика) |
| `inventory_requests` | Заявки на перемещение (warehouse → showcase) |
| `inventory_request_items` | Строки заявки |

`inventory_decide_request` — Supabase функция, атомарно одобряет заявку (минусует со склада, плюсует витрину).

## Что не сделано / TODO

- QR-логин в киоске (заглушка на WelcomeScreen)
- Загрузка обложек файлом (сейчас только URL)
- Автозапуск `setup-windows.ps1` при NSIS-инсталле киоска

## Деплой

- **Web**: push в `main` → Vercel автодеплой → ordaops.kz
- **Kiosk**: `cd desktop/kiosk && npm run build` → GitHub Release
- **Operator**: `cd desktop/operator && npm run build` → GitHub Release
- **Supabase миграции**: применять через SQL Editor или `supabase db push`

## ENV переменные (обязательные)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY             # для AI фич (provider: OpenAI, модель gpt-4o-mini; OPENAI_MODEL — опц.)
TELEGRAM_BOT_TOKEN         # для Telegram отчётов
GOOGLE_WALLET_ISSUER_ID    # опц.: карты лояльности Google Wallet (lib/server/google-wallet.ts)
GOOGLE_WALLET_SA_EMAIL     # опц.: email сервис-аккаунта Google Cloud
GOOGLE_WALLET_SA_KEY       # опц.: private_key сервис-аккаунта (PEM или base64)
```
