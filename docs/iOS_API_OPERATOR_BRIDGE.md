# iOS App ↔ Web API Bridge — спецификация для веб-команды

**Статус:** ⏳ TODO — блокирует выпуск iOS Phase 1 (Operator Excellence)
**Дата:** 2026-05-04
**Кому:** разработчик веб-портала f16finance-main
**От кого:** iOS team (Orda Control mobile)
**Связано с:** `Orda Control/Orda Control/Features/Operator/Shift|Knowledge|Checklists|Incidents/`

---

## TL;DR

iOS-приложение **Orda Control** должно работать как мобильный двойник веб-портала + дополнение к Electron-терминалу. Сейчас iOS аутентифицируется через **Supabase JWT (Bearer токен)** и НЕ может вызывать `/api/point/*` endpoints — те защищены `requirePointDevice` и требуют `x-point-device-token`.

Нужно добавить **6 новых route handlers** под `/api/operator/*`, которые делают ровно то же что соответствующие `/api/point/*`, но авторизуют через `getRequestAccessContext()` (как остальной `/api/operator/*`). Они должны резолвить `company_id` через `operator_auth.user_id` → `operators.id` → `operator_company_assignments`.

**Объём работы:** ~2-3 рабочих дня (тонкие wrappers, использующие те же RPC и таблицы).

---

## Контекст

### Архитектура аутентификации сейчас

| Клиент | Auth механизм | Используемые endpoints |
|---|---|---|
| Веб-портал (staff) | Supabase Auth cookies → `getRequestAccessContext()` | `/api/admin/*` |
| Electron operator | `x-point-device-token` → `requirePointDevice()` | `/api/point/*` |
| Electron kiosk | `x-device-token` + `x-client-secret` | `/api/kiosk/*` |
| **iOS (operator role)** | **Supabase JWT Bearer → `getRequestAccessContext()`** | `/api/operator/*` (overview, tasks, shifts, salary, profile, lead, point-qr-confirm) |
| iOS (super-admin) | Supabase JWT Bearer → `getRequestAccessContext()` | `/api/admin/*` |

iOS-оператор **не имеет device token** и не должен его получать (это отдельный Electron-терминал). Но операторы хотят с iPhone:
- Открывать/закрывать **смены** на точке
- Проходить **чек-листы**
- Читать и подтверждать **базу знаний**
- Видеть свои **инциденты** (нарушения/бонусы)
- Управлять **Arena** (игровыми сессиями)

Все эти фичи в backend сейчас реализованы только на `/api/point/*` (для Electron-терминала). Нужны зеркала на `/api/operator/*` для iOS.

### Почему не сделать iPhone "device"

Альтернатива — зарегистрировать iPhone в `point_projects` как ещё одно устройство и хранить device_token в Keychain. Но это создаёт проблемы:
- Один iPhone привязан к одной точке (`point_projects.point_project_companies` — multi-company project, но это редкий кейс)
- Если оператор сменил точку — нужно перерегистрировать device
- Если пользуется чужим iPhone — конфликт device sessions
- Открытая смена на iPhone = device считается активным; невозможно закрыть с другого устройства

С `/api/operator/*` всё чище: iOS использует JWT юзера, company резолвится из его assignments.

---

## Что нужно реализовать

### Helper-функция (один раз, в `lib/server/`)

Создать `lib/server/operator-context.ts`:

```typescript
import 'server-only'
import { NextResponse } from 'next/server'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { getRequestAccessContext, type RequestAccessContext } from '@/lib/server/request-auth'

export type OperatorContext = {
  access: RequestAccessContext
  operatorId: string         // operators.id
  staffId: string | null      // staff.id (linked via operator_staff_links)
  companyId: string           // primary company (operator_company_assignments.is_primary)
  companyIds: string[]        // все компании оператора
  supabase: ReturnType<typeof createAdminSupabaseClient>
}

/**
 * Аутентифицирует request как оператора через Bearer JWT,
 * резолвит operator_id, staff_id, company_id из БД.
 * Возвращает OperatorContext или NextResponse с 401/403.
 */
export async function requireOperator(
  request: Request,
): Promise<{ response: NextResponse } | OperatorContext> {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return { response: access.response }

  if (!access.user) {
    return {
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    }
  }

  // Проверяем что это оператор (operator_auth.user_id = access.user.id)
  if (!access.operatorAuth?.operator_id) {
    return {
      response: NextResponse.json({ error: 'not-an-operator' }, { status: 403 }),
    }
  }

  const operatorId = access.operatorAuth.operator_id
  const supabase = hasAdminSupabaseCredentials()
    ? createAdminSupabaseClient()
    : access.supabase

  // Резолвим staff_id (для операций которые пишут в shifts/salary через staff)
  const { data: staffLink } = await supabase
    .from('operator_staff_links')
    .select('staff_id')
    .eq('operator_id', operatorId)
    .maybeSingle()
  const staffId = staffLink?.staff_id || null

  // Резолвим company_id из assignments
  const { data: assignments } = await supabase
    .from('operator_company_assignments')
    .select('company_id, is_primary, is_active')
    .eq('operator_id', operatorId)
    .eq('is_active', true)

  const activeAssignments = (assignments || []) as any[]
  if (activeAssignments.length === 0) {
    return {
      response: NextResponse.json(
        { error: 'no-company-assigned' },
        { status: 403 },
      ),
    }
  }

  const primary = activeAssignments.find((a) => a.is_primary) || activeAssignments[0]
  const companyId = primary.company_id as string
  const companyIds = activeAssignments.map((a) => a.company_id) as string[]

  return {
    access,
    operatorId,
    staffId,
    companyId,
    companyIds,
    supabase,
  }
}
```

Эта функция используется во всех новых `/api/operator/*` route handlers ниже.

---

### 1. Shift Entity — `/api/operator/shift/*`

#### `GET /api/operator/shift/current`

**Делает:** возвращает текущую открытую смену оператора, плюс checklists и pending knowledge confirmations.

**Реализация:** копия `/api/point/shift/current/route.ts`, но `device.company_id` заменяется на `operatorContext.companyId`.

```typescript
// app/api/operator/shift/current/route.ts
import { NextResponse } from 'next/server'
import { requireOperator } from '@/lib/server/operator-context'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId, operatorId, staffId } = ctx

  const { data: shift, error } = await supabase
    .from('point_shifts')
    .select(
      `id, company_id, organization_id, operator_id, point_device_id,
       status, shift_type, opened_at, closed_at,
       opening_cash, opening_notes, handover_from_shift_id,
       operator:staff!operator_id ( id, full_name, short_name )`,
    )
    .eq('company_id', companyId)
    .eq('status', 'open')
    .maybeSingle()

  if (error) {
    return json({ error: 'shift-current-failed', detail: error.message }, 500)
  }

  if (!shift) {
    return json({ shift: null })
  }

  const shiftId = (shift as any).id as string

  // Тот же код агрегации totals/checklists/knowledge как в /api/point/shift/current
  // (см. оригинал — копировать as-is, заменив device.company_id на companyId)

  // Pending knowledge confirmations: используем staffId оператора
  let pendingConfirmations: any[] = []
  if (staffId) {
    // Тот же запрос что в point/shift/current, но с .staff_id = staffId
  }

  return json({ shift, totals: { /* ... */ }, checklists: { /* ... */ }, knowledge: { pending_confirmations: pendingConfirmations } })
}
```

**Response (тот же что у `/api/point/shift/current`):**
```json
{
  "shift": { "id": "...", "company_id": "...", "status": "open", "shift_type": "day", "opened_at": "2026-05-04T08:00:00Z", "opening_cash": 50000, "operator": { "id": "...", "full_name": "Иван Петров" }},
  "totals": { "sales_count": 12, "sales_total": 145000, "sales_cash": 80000, "sales_kaspi": 65000, "returns_count": 1, "returns_total": 1500 },
  "checklists": { "templates": [...], "runs": [...] },
  "knowledge": { "pending_confirmations": [...] }
}
```

---

#### `POST /api/operator/shift/open`

**Делает:** открывает смену. Wrapper над RPC `point_shift_open`.

```typescript
// app/api/operator/shift/open/route.ts
type Body = {
  shift_type?: 'day' | 'night' | 'custom' | null
  opening_cash?: number | null
  opening_notes?: string | null
  handover_from_shift_id?: string | null
}

export async function POST(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId, operatorId, staffId } = ctx
  const body = (await request.json().catch(() => ({}))) as Body

  const openingCash = Number(body.opening_cash || 0)
  if (!Number.isFinite(openingCash) || openingCash < 0) {
    return json({ error: 'opening-cash-required' }, 400)
  }

  const { data, error } = await supabase.rpc('point_shift_open', {
    p_company_id: companyId,
    p_operator_id: staffId,           // smiшним: RPC принимает staff_id, не operator_id
    p_point_device_id: null,
    p_shift_type: body.shift_type || 'day',
    p_opening_cash: openingCash,
    p_opening_notes: body.opening_notes || null,
    p_handover_from: body.handover_from_shift_id || null,
  })

  if (error) {
    // Те же error codes что в /api/point/shift/open: point-shift-already-open, point-shift-operator-not-onboarded
    // ...
  }

  await writeAuditLog(supabase, {
    action: 'point_shift.open',
    entityType: 'point_shift',
    entityId: String(data),
    payload: { company_id: companyId, operator_id: operatorId, staff_id: staffId, opening_cash: openingCash, shift_type: body.shift_type || 'day' },
  })

  return json({ shift_id: data, opening_cash: openingCash })
}
```

**Request body:**
```json
{
  "shift_type": "day",
  "opening_cash": 50000,
  "opening_notes": "Принял смену с улицы",
  "handover_from_shift_id": null
}
```

**Response:**
```json
{ "shift_id": "uuid", "opening_cash": 50000 }
```

---

#### `POST /api/operator/shift/close`

**Делает:** закрывает текущую открытую смену. Wrapper над RPC `point_shift_close`.

```typescript
type Body = {
  closing_cash?: number | null
  closing_kaspi?: number | null
  kaspi_before_midnight?: number | null
  kaspi_after_midnight?: number | null
  z_report_url?: string | null
  x_report_url?: string | null
  closing_notes?: string | null
}

export async function POST(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId, staffId } = ctx
  const body = (await request.json().catch(() => ({}))) as Body

  // Найти открытую смену
  const { data: open } = await supabase
    .from('point_shifts')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'open')
    .maybeSingle()

  if (!open) return json({ error: 'point-shift-no-open' }, 409)
  const shiftId = (open as any).id

  // ВАЖНО: проверить blocking checklists (тот же код что в /api/point/shift/close)
  // ...

  const { data, error } = await supabase.rpc('point_shift_close', {
    p_shift_id: shiftId,
    p_closed_by: staffId,
    p_closing_cash: Number(body.closing_cash || 0),
    p_closing_kaspi: Number(body.closing_kaspi || 0),
    p_kaspi_before_midnight: Number(body.kaspi_before_midnight || 0),
    p_kaspi_after_midnight: Number(body.kaspi_after_midnight || 0),
    p_z_report_url: body.z_report_url || null,
    p_x_report_url: body.x_report_url || null,
    p_closing_notes: body.closing_notes || null,
  })

  if (error) return json({ error: 'point-shift-close-failed', detail: error.message }, 400)
  return json({ shift_id: shiftId, totals: data })
}
```

**Request body:** идентичен `/api/point/shift/close` (без `closed_by` — берётся из контекста).

---

#### `POST /api/operator/shift/handover`

**Делает:** закрывает текущую смену + сразу открывает новую (на другого оператора).
**Реализация:** копия `/api/point/shift/handover/route.ts`. Тот же RPC `point_shift_handover`, тот же body, заменить `device.company_id` на `companyId`, `device.id` на `null` (т.к. iOS не device).

---

### 2. Knowledge Center — `/api/operator/knowledge/*`

#### `GET /api/operator/knowledge`

**Делает:** возвращает все статьи, доступные оператору, плюс статус прочтения.

```typescript
export async function GET(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId, staffId } = ctx

  const { data: articles } = await supabase
    .from('knowledge_articles')
    .select(
      `id, title, slug, severity, version, summary, body_markdown, body_html,
       requires_confirmation, category_id, category:knowledge_categories(id, name, slug),
       company_id, is_published, last_updated_at`,
    )
    .eq('is_published', true)
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order('severity', { ascending: false })

  const arr = (articles || []) as any[]

  // Загружаем подтверждения этого оператора
  const { data: confirmations } = staffId
    ? await supabase
        .from('knowledge_article_confirmations')
        .select('article_id, article_version, confirmed_at')
        .eq('staff_id', staffId)
    : { data: [] }

  const confirmedMap = new Map<string, { version: number; at: string }>()
  for (const c of (confirmations || []) as any[]) {
    confirmedMap.set(c.article_id, { version: c.article_version, at: c.confirmed_at })
  }

  const enriched = arr.map((a) => {
    const conf = confirmedMap.get(a.id)
    return {
      ...a,
      is_mandatory: a.requires_confirmation,
      category_name: a.category?.name,
      confirmed_at: conf?.at || null,
      confirmed_version: conf?.version || null,
    }
  })

  return json({ articles: enriched })
}
```

**Response:**
```json
{
  "articles": [
    {
      "id": "uuid",
      "title": "Правила приёма смены",
      "summary": "...",
      "body_markdown": "# Правила...",
      "version": 3,
      "is_mandatory": true,
      "category_name": "Регламенты",
      "confirmed_at": null,
      "confirmed_version": null
    }
  ]
}
```

---

#### `POST /api/operator/knowledge/confirm`

**Делает:** подтверждает прочтение статьи оператором.

```typescript
type Body = {
  article_id: string
  version?: number | null   // если null — берём article.version
}

export async function POST(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, staffId } = ctx
  if (!staffId) return json({ error: 'no-staff-link' }, 400)

  const body = (await request.json().catch(() => ({}))) as Body
  if (!body.article_id) return json({ error: 'article-id-required' }, 400)

  // Получаем version из article если не передан
  let articleVersion = body.version
  if (!articleVersion) {
    const { data } = await supabase
      .from('knowledge_articles')
      .select('version')
      .eq('id', body.article_id)
      .maybeSingle()
    articleVersion = (data as any)?.version || 1
  }

  const { error } = await supabase
    .from('knowledge_article_confirmations')
    .upsert({
      article_id: body.article_id,
      article_version: articleVersion,
      staff_id: staffId,
      confirmed_at: new Date().toISOString(),
    }, { onConflict: 'article_id,article_version,staff_id' })

  if (error) return json({ error: 'confirm-failed', detail: error.message }, 400)
  return json({ ok: true })
}
```

---

### 3. Checklists — `/api/operator/checklist/*`

#### `GET /api/operator/checklist/templates`

**Делает:** возвращает все доступные templates для текущей точки оператора.

```typescript
export async function GET(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId } = ctx

  const { data: templates } = await supabase
    .from('checklist_templates')
    .select(
      `id, title, description, role_scope, shift_scope, schedule_type,
       recurrence_minutes, blocks_shift, is_active, sort_order, company_id,
       items:checklist_template_items (
         id, prompt, answer_kind, help_text, article_id, importance,
         fine_per_fail, bonus_per_success, requires_photo, position, choice_options
       )`,
    )
    .eq('is_active', true)
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order('sort_order')

  return json({ templates: templates || [] })
}
```

#### `POST /api/operator/checklist/run`

Wrapper над `/api/point/checklist/run` — body тот же `{ template_id, scheduled_at? }`. Резолвит `run_by` через `staffId` оператора, прикрепляет к текущей открытой смене (`getCurrentOpenShift(supabase, companyId)`).

#### `GET /api/operator/checklist/run/[id]`

```typescript
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId } = ctx
  const runId = params.id

  // Загружаем run + template + items
  const { data: run } = await supabase
    .from('checklist_runs')
    .select(
      `id, template_id, status, started_at, completed_at, responses,
       fines_total, bonuses_total, run_by, co_signed_by, shift_id,
       template:checklist_templates (
         id, title, description, blocks_shift,
         items:checklist_template_items ( ... )
       ),
       shift:point_shifts ( id, company_id, status )`,
    )
    .eq('id', runId)
    .maybeSingle()

  if (!run) return json({ error: 'not-found' }, 404)
  // Проверка company_id для безопасности
  if ((run as any).shift?.company_id !== companyId) {
    return json({ error: 'forbidden' }, 403)
  }

  return json({ run })
}
```

#### `PATCH /api/operator/checklist/run/[id]`

```typescript
type Body = {
  responses: Array<{ item_id: string; answer?: string; photo_base64?: string; comment?: string }>
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId } = ctx
  const body = (await request.json().catch(() => ({}))) as Body

  // Проверяем доступ оператора к run (через shift.company_id)
  const { data: run } = await supabase
    .from('checklist_runs')
    .select('id, shift:point_shifts(company_id)')
    .eq('id', params.id)
    .maybeSingle()
  if (!run || (run as any).shift?.company_id !== companyId) {
    return json({ error: 'forbidden' }, 403)
  }

  // Обработка фото: если photo_base64 — загружаем в storage, сохраняем URL
  // (или сохраняем base64 в JSON responses — на усмотрение)

  const responsesObj = Object.fromEntries(
    body.responses.map((r) => [r.item_id, { answer: r.answer, comment: r.comment, photo_url: /* ... */ }]),
  )

  const { error } = await supabase
    .from('checklist_runs')
    .update({ responses: responsesObj, updated_at: new Date().toISOString() })
    .eq('id', params.id)

  if (error) return json({ error: 'update-failed', detail: error.message }, 400)
  return json({ ok: true })
}
```

#### `POST /api/operator/checklist/run/[id]/complete`

Wrapper над тем же endpoint — финализирует run, рассчитывает fines/bonuses (RPC или ручной расчёт), проверяет `blocks_shift` инварианты.

---

### 4. Incidents — `/api/operator/incidents`

#### `GET /api/operator/incidents`

**Делает:** возвращает инциденты, в которых текущий оператор фигурирует (как targeted operator).

```typescript
export async function GET(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, operatorId, companyId } = ctx
  const url = new URL(request.url)
  const status = url.searchParams.get('status')

  let query = supabase
    .from('incidents')
    .select(`
      id, kind, severity, status, title, description,
      fine_amount, bonus_amount, article_id, checklist_run_id,
      shift_id, operator_id, photo_url, created_at, acknowledged_at, closed_at,
      operator:operators!operator_id ( id, name, short_name ),
      article:knowledge_articles ( id, title )
    `)
    .eq('operator_id', operatorId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }

  const { data } = await query
  return json({ incidents: data || [] })
}
```

iOS Phase 1 НЕ делает create incidents через operator — это admin/staff делает через существующий `/api/admin/incidents`. Поэтому только GET нужен.

---

### 5. Arena Live — расширения `/api/point/arena` через operator

Текущий iOS Phase 1 имеет `OperatorArenaLiveService` с двумя actions: `extend` и `techLog`. Backend должен поддержать их в `/api/operator/arena`:

#### `GET /api/operator/arena`

Зеркало `/api/point/arena` (стационарный список станций), но фильтр по `companyId` оператора.

#### `POST /api/operator/arena`

Тот же body что `/api/point/arena`:
```json
{ "action": "start" | "stop" | "extend" | "techLog", "station_id": "...", "minutes": 30, "client_name": "...", "message": "..." }
```

Логика — как в `/api/point/arena`, только company резолвится из `operatorContext.companyId`. Action `techLog` пишет в `arena_tech_logs`.

---

## Резюме endpoints для iOS

| Endpoint | Метод | Body | Status |
|---|---|---|---|
| `/api/operator/shift/current` | GET | — | ✅ задокументирован |
| `/api/operator/shift/open` | POST | `{ shift_type, opening_cash, opening_notes?, handover_from_shift_id? }` | ✅ |
| `/api/operator/shift/close` | POST | `{ closing_cash, closing_kaspi, kaspi_before_midnight?, kaspi_after_midnight?, z_report_url?, x_report_url?, closing_notes? }` | ✅ |
| `/api/operator/shift/handover` | POST | `{ closing_cash, closing_kaspi, ..., next_operator_id, next_shift_type, next_opening_cash, next_opening_notes? }` | ✅ |
| `/api/operator/knowledge` | GET | — | ✅ |
| `/api/operator/knowledge/confirm` | POST | `{ article_id, version? }` | ✅ |
| `/api/operator/checklist/templates` | GET | — | ✅ |
| `/api/operator/checklist/run` | POST | `{ template_id, scheduled_at? }` | ✅ |
| `/api/operator/checklist/run/[id]` | GET | — | ✅ |
| `/api/operator/checklist/run/[id]` | PATCH | `{ responses: [...] }` | ✅ |
| `/api/operator/checklist/run/[id]/complete` | POST | — | ✅ |
| `/api/operator/incidents` | GET | `?status=` | ✅ |
| `/api/operator/arena` | GET | — | ✅ |
| `/api/operator/arena` | POST | `{ action, station_id, ... }` | ✅ |

**Всего: 14 новых route handlers.**

---

## Авторизация и безопасность

Все endpoints используют `requireOperator(request)` (определена в `lib/server/operator-context.ts` — см. секцию "Helper-функция").

**Проверки:**
1. Bearer JWT валидный (`access.user` существует)
2. У юзера есть `operator_auth.user_id = access.user.id` (не staff и не customer)
3. У оператора есть хотя бы одно активное `operator_company_assignments`
4. Все запросы к таблицам фильтруются по `companyId` оператора (его primary company)
5. Для multi-company операторов (assignments к нескольким) — берём primary, либо позволяем явный override через query param `?company_id=...` если этот companyId есть в `companyIds`

**Не должно быть:**
- Прямого SQL без company filter — RLS на уровне БД должна блокировать кросс-tenant утечку
- Доверия `operator_id` из request body — всегда брать из контекста

**Audit:** все mutating endpoints должны писать в `audit_log` через `writeAuditLog()`.

---

## Что iOS уже отправляет (контракты)

Чтобы веб-команда понимала что iOS реально шлёт, ниже структуры из iOS-кода (`Features/Operator/Shift/PointShiftEntityModule.swift` и т.д.):

### Shift Open (iOS отправляет):
```json
{
  "opening_cash": 50000,
  "shift_type": "day",
  "point_id": null
}
```

⚠️ **iOS отправляет `point_id` — backend это поле игнорирует, но не падает.** `operator_id` iOS не отправляет — резолвится через JWT. После выпуска backend `/api/operator/shift/open` iOS-команда отправит `opening_notes` и `handover_from_shift_id` (нужно небольшое обновление в iOS — добавить эти поля в форму).

### Shift Close (iOS отправляет):
```json
{
  "closing_cash": 75000,
  "closing_kaspi": 25000,
  "closing_online": 15000,
  "closing_card": 8000,
  "closing_notes": "Всё ок"
}
```

⚠️ **iOS отправляет `closing_online`/`closing_card` — backend их игнорирует.** В будущей итерации iOS уберёт эти поля и добавит `kaspi_before_midnight`/`kaspi_after_midnight` (Kaspi split для ночных смен).

### Shift Handover (iOS отправляет):
```json
{
  "to_operator_id": "uuid",
  "notes": "Передаю смену с открытой Arena сессией на станции #3"
}
```

⚠️ **iOS отправляет упрощённую модель.** Backend требует разделение closing-данных и opening-данных новой смены. iOS итерация 2: добавить форму для closing полей перед handover (closing_cash, closing_kaspi и т.д.), плюс next_opening_cash. Backend пока может в `/api/operator/shift/handover` извлекать `closing_cash` из текущей смены автоматически (через `point_shifts.opening_cash` или другую логику) — на усмотрение веб-команды.

### Checklist Run start (iOS отправляет):
```json
{ "template_id": "uuid" }
```
✅ Совпадает с backend.

### Checklist Run update (iOS отправляет):
```json
{
  "answers": [
    { "item_id": "...", "answer": "yes", "photo_base64": "data:image/jpeg;base64,...", "comment": "..." }
  ]
}
```

⚠️ **iOS использует ключ `answers`, backend ожидает `responses`** (если будет следовать формату из `checklist_runs.responses` JSONB). Веб-команда: используйте поле `answers` для совместимости с iOS, или конвертируйте на стороне backend `answers → responses`. Альтернатива — iOS-команда переименует на `responses` (нужна сборка).

### Incidents create (iOS на admin endpoint отправляет):
```json
{
  "kind": "violation",
  "severity": "medium",
  "title": "Опоздал на 15 минут",
  "description": "...",
  "fine_amount": 2000,
  "bonus_amount": null,
  "article_id": "uuid",
  "checklist_run_id": null,
  "shift_id": "uuid",
  "operator_id": "uuid",
  "photo_base64": "data:image/jpeg;base64,..."
}
```

Это идёт в существующий `/api/admin/incidents` — формат должен совпасть. Если не совпадает — fixed by веб-команда.

---

## План внедрения

### Этап 1: Helper и `/api/operator/shift/*` (1 день)
1. `lib/server/operator-context.ts` — `requireOperator()` helper
2. `app/api/operator/shift/current/route.ts`
3. `app/api/operator/shift/open/route.ts`
4. `app/api/operator/shift/close/route.ts`
5. `app/api/operator/shift/handover/route.ts`

### Этап 2: Knowledge + Checklists (1 день)
6. `app/api/operator/knowledge/route.ts` (GET)
7. `app/api/operator/knowledge/confirm/route.ts`
8. `app/api/operator/checklist/templates/route.ts`
9. `app/api/operator/checklist/run/route.ts` (POST)
10. `app/api/operator/checklist/run/[id]/route.ts` (GET, PATCH)
11. `app/api/operator/checklist/run/[id]/complete/route.ts`

### Этап 3: Incidents + Arena (0.5 дня)
12. `app/api/operator/incidents/route.ts`
13. `app/api/operator/arena/route.ts` (GET, POST с action: extend/techLog)

### Этап 4: Тесты + деплой (0.5 дня)
14. Manual тесты с реальным operator JWT (через Postman или curl с Supabase Bearer)
15. Деплой в Vercel
16. Координация с iOS — переключение endpoints с `/api/point/*` на `/api/operator/*`

**Итого: ~3 рабочих дня** для веб-разработчика.

---

## Тестовые сценарии (для post-deploy QA)

Использовать Bearer JWT тестового оператора F16 (`operator_test@f16.local`).

### Shift
- [ ] `GET /api/operator/shift/current` — оператор без открытой смены → `{ shift: null }`
- [ ] `POST /api/operator/shift/open { opening_cash: 50000, shift_type: "day" }` → `{ shift_id, opening_cash }`
- [ ] `GET /api/operator/shift/current` повторно → видим открытую смену + checklists.templates
- [ ] `POST /api/operator/shift/open` повторно → `409 point-shift-already-open`
- [ ] `POST /api/operator/shift/close { closing_cash: 75000, closing_kaspi: 25000 }` → `{ shift_id, totals }` если нет blocking checklists; иначе `409 point-shift-required-checklists-missing`
- [ ] `POST /api/operator/shift/handover { ..., next_operator_id }` → `{ previous_shift_id, new_shift_id, totals }`

### Knowledge
- [ ] `GET /api/operator/knowledge` → массив статей с правильными `is_mandatory`, `confirmed_at`
- [ ] `POST /api/operator/knowledge/confirm { article_id }` → `{ ok: true }`
- [ ] Повторный GET → у этой статьи `confirmed_at` уже не null

### Checklist
- [ ] `GET /api/operator/checklist/templates` → массив шаблонов
- [ ] `POST /api/operator/checklist/run { template_id }` → `{ run_id }` (требует открытую смену)
- [ ] `PATCH /api/operator/checklist/run/[id] { answers: [...] }` → `{ ok: true }`
- [ ] `POST /api/operator/checklist/run/[id]/complete` → run.status = "completed", fines_total посчитан

### Cross-tenant safety
- [ ] Оператор F16 с JWT → пытается прочитать смену другой компании через прямой `?company_id=...` → 403
- [ ] Оператор без `operator_company_assignments` → 403 `no-company-assigned`
- [ ] Staff юзер (не оператор) → 403 `not-an-operator`

---

## Открытые вопросы для веб-команды

1. **Multi-company операторы** — оставляем primary company, или позволяем явный override `?company_id=` если этот companyId в `companyIds` оператора?
2. **Photo upload в checklist responses** — base64 в JSON `responses`, или загрузка в Supabase Storage с возвратом URL? iOS сейчас отправляет base64 — веб-команда решает.
3. **Quiz endpoints** — iOS в Phase 1 имеет UI для квизов в Knowledge (`/api/operator/knowledge/quiz/start|complete`). На бэке они ОТСУТСТВУЮТ. Решить: добавить в Phase 1 backend, или iOS отключает quiz UI до Phase 2.
4. **Incidents create через operator** — iOS Phase 1 не позволяет оператору создавать инциденты, но в будущем такой ручной endpoint может понадобиться (например, оператор записывает baseline инцидент сам как note). Не критично сейчас.
5. **Rate limiting** — на `/api/operator/*` стоит ли дополнительные limits? Сейчас на `/api/admin/*` есть `lib/server/rate-limit.ts`, но я не уверен применяется ли там. Веб-команда может оценить нужны ли тут.

---

## После выпуска backend

Когда веб-команда задеплоит изменения, iOS-команда сделает:
1. Поменять пути endpoint'ов в:
   - `Features/Operator/Shift/PointShiftEntityModule.swift` — с `/api/point/shift/*` на `/api/operator/shift/*`
   - `Features/Operator/Knowledge/KnowledgeCenterModule.swift` — с `/api/point/knowledge*` на `/api/operator/knowledge*`
   - `Features/Operator/Checklists/ChecklistsModule.swift` — с `/api/point/checklist*` на `/api/operator/checklist*`
   - `Features/Operator/Incidents/IncidentsModule.swift` — с `/api/operator/incidents` (уже правильный) — оставить
   - `Features/Operator/OperatorArenaLiveModule.swift` — с `/api/point/arena` на `/api/operator/arena`
2. Поправить несоответствия полей (Kaspi split, operator_id, handover combined и т.д.)
3. Добавить `opening_notes`, `handover_from_shift_id` в `ShiftOpenSheet`
4. Добавить closing-поля в `ShiftHandoverSheet` для combined operation
5. Сборка → тестирование на реальном F16 операторе

**Это работа на ~1 день для iOS-команды.**

---

## Контакт

Если нужно что-то уточнить — пиши в команду iOS. Все iOS-файлы лежат в `Orda Control/Orda Control/Features/Operator/{Shift,Knowledge,Checklists,Incidents,OperatorArenaLive}*`.

При планировании — приоритет в таком порядке:
1. **Shift entity** (блокирует ежедневную работу оператора)
2. **Checklists** (требуется shift entity)
3. **Knowledge** (read-only, проще всего)
4. **Incidents** (read-only через operator)
5. **Arena** (если нужно — иначе оставить через QR-логин на Electron)
