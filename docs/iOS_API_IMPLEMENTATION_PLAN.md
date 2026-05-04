# iOS API Bridge — План реализации

**Проект:** Orda Point (Next.js 15 + Supabase)  
**Задача:** Добавить 14 новых route handlers под `/api/operator/*` для iOS-приложения Orda Control  
**Приоритет:** Не ломать ни один существующий endpoint  
**Оценка:** ~2 рабочих дня

---

## Контекст архитектуры

Система имеет три клиента на одной БД Supabase:

| Клиент | Auth | Endpoints |
|--------|------|-----------|
| Веб-портал (staff/admin) | Supabase Auth cookies → `getRequestAccessContext()` | `/api/admin/*` |
| Electron operator | `x-point-device-token` header → `requirePointDevice()` | `/api/point/*` |
| Electron kiosk | `x-device-token` + `x-client-secret` | `/api/kiosk/*` |
| iOS оператор (новое) | Supabase JWT Bearer → `getRequestOperatorContext()` | `/api/operator/*` |

Все Supabase-запросы идут **только через Next.js API routes** — прямого доступа из клиентов нет.

---

## Что уже существует (не трогаем)

### Существующие `/api/operator/*` routes (работают, не меняем):
- `app/api/operator/overview/route.ts`
- `app/api/operator/salary/route.ts`
- `app/api/operator/shifts/route.ts`
- `app/api/operator/tasks/route.ts`
- `app/api/operator/profile/route.ts`
- `app/api/operator/lead/route.ts`
- `app/api/operator/point-qr-confirm/route.ts`

### Существующие helper-функции (используем как есть):
- `lib/server/request-auth.ts` → `getRequestOperatorContext()` — JWT-авторизация, возвращает `operator.id`
- `lib/server/request-auth.ts` → `getRequestAccessContext()` — полный контекст доступа
- `lib/server/point-shifts.ts` → `getCurrentOpenShift(supabase, companyId)` — текущая открытая смена
- `lib/server/audit.ts` → `writeAuditLog()` — лог действий
- `lib/server/supabase.ts` → `createAdminSupabaseClient()` / `hasAdminSupabaseCredentials()`

### Source implementations (копируем логику, меняем auth):
- `app/api/point/shift/current/route.ts`
- `app/api/point/shift/open/route.ts`
- `app/api/point/shift/close/route.ts`
- `app/api/point/shift/handover/route.ts`
- `app/api/point/knowledge/route.ts`
- `app/api/point/knowledge/confirm/route.ts`
- `app/api/point/checklist/run/route.ts`
- `app/api/point/checklist/run/[id]/route.ts`
- `app/api/point/checklist/run/[id]/complete/route.ts`
- `app/api/point/incidents/route.ts`
- `app/api/point/arena/route.ts`

---

## Шаг 0: Новый helper `lib/server/operator-context.ts`

**Файл:** `lib/server/operator-context.ts` (новый файл)

**Зачем:** Все 14 новых routes нуждаются в одинаковой авторизации: проверить JWT, найти `operatorId`, `staffId`, `companyId`. Делаем один раз, используем везде.

**Важно:** Функция `getRequestOperatorContext()` из `request-auth.ts` уже есть и делает часть работы (возвращает `operator.id`). Новый helper **оборачивает** её, добавляя `companyId` и `staffId` — не дублирует.

```typescript
import 'server-only'
import { NextResponse } from 'next/server'
import { getRequestOperatorContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export type OperatorContext = {
  operatorId: string          // operators.id
  staffId: string | null      // staff.id через operator_staff_links (нужен для RPC)
  companyId: string           // primary company из operator_company_assignments
  companyIds: string[]        // все активные компании оператора
  supabase: ReturnType<typeof createAdminSupabaseClient>
}

export async function requireOperator(
  request: Request,
): Promise<{ response: NextResponse } | OperatorContext> {
  // 1. Проверяем JWT через существующий helper
  const context = await getRequestOperatorContext(request)
  if ('response' in context) return context

  const operatorId = context.operator.id
  const supabase = hasAdminSupabaseCredentials()
    ? createAdminSupabaseClient()
    : (context.supabase as any)

  // 2. Ищем staff_id через operator_staff_links (нужен для RPCs: point_shift_open, point_shift_close)
  const { data: staffLink } = await supabase
    .from('operator_staff_links')
    .select('staff_id')
    .eq('operator_id', operatorId)
    .maybeSingle()
  const staffId = (staffLink as any)?.staff_id || null

  // 3. Ищем company assignments (БЕЗ фильтра по role_in_company — нужны все операторы, не только senior)
  const { data: assignments } = await supabase
    .from('operator_company_assignments')
    .select('company_id, is_primary, is_active')
    .eq('operator_id', operatorId)
    .eq('is_active', true)

  const activeAssignments = (assignments || []) as any[]

  if (activeAssignments.length === 0) {
    return {
      response: NextResponse.json({ error: 'no-company-assigned' }, { status: 403 }),
    }
  }

  // primary — явно отмеченная или первая по списку
  const primary = activeAssignments.find((a) => a.is_primary) || activeAssignments[0]
  const companyId = primary.company_id as string
  const companyIds = activeAssignments.map((a) => a.company_id) as string[]

  return { operatorId, staffId, companyId, companyIds, supabase }
}
```

**Почему `is_active` без `role_in_company` фильтра:** Существующий `listActiveOperatorLeadAssignments()` фильтрует только `senior_operator/senior_cashier` — обычный оператор туда не попадёт. Для iOS нужны все операторы с любой ролью.

---

## Шаг 1: Shift Routes (4 файла)

### 1.1 `GET /api/operator/shift/current`

**Файл:** `app/api/operator/shift/current/route.ts` (новый)

**Логика:** Полная копия `app/api/point/shift/current/route.ts`, с одним изменением: вместо `device.company_id` используется `ctx.companyId`. Всё остальное — тот же код.

**Что возвращает:**
```json
{
  "shift": {
    "id": "uuid",
    "company_id": "uuid",
    "status": "open",
    "shift_type": "day",
    "opened_at": "2026-05-04T08:00:00Z",
    "opening_cash": 50000,
    "operator": { "id": "uuid", "full_name": "Иван Петров", "short_name": "Иван" }
  },
  "totals": {
    "sales_count": 12,
    "sales_total": 145000,
    "sales_cash": 80000,
    "sales_kaspi": 65000,
    "returns_count": 1,
    "returns_total": 1500
  },
  "checklists": {
    "templates": [...],
    "runs": [...]
  },
  "knowledge": {
    "pending_confirmations": [...]
  }
}
```

**Если смена не найдена:** `{ "shift": null }`

**Отличие от point:** В point-версии pending_confirmations запрашиваются по `shift.operator_id` (который является staff_id). В operator-версии — берём `ctx.staffId`. Если `staffId = null` (оператор без staff-связки) — pending_confirmations возвращается пустым массивом.

---

### 1.2 `POST /api/operator/shift/open`

**Файл:** `app/api/operator/shift/open/route.ts` (новый)

**Логика:** Копия `app/api/point/shift/open/route.ts`. Ключевые изменения:
- Вместо `device.company_id` → `ctx.companyId`
- Вместо `resolveStaffIdForOperator(supabase, body.operator_id)` → `ctx.staffId` (уже резолвлен в helper)
- Поле `p_point_device_id: null` (у iOS нет device id)

**iOS сейчас присылает:**
```json
{ "opening_cash": 50000, "shift_type": "day", "point_id": null }
```

**Поле `point_id` из iOS игнорируем** — не используем. `opening_notes` и `handover_from_shift_id` принимаем но iOS пока не шлёт — OK, будут null.

**RPC вызов:**
```typescript
await supabase.rpc('point_shift_open', {
  p_company_id: ctx.companyId,
  p_operator_id: ctx.staffId,   // ВАЖНО: RPC ожидает staff.id, не operators.id
  p_point_device_id: null,
  p_shift_type: body.shift_type || 'day',
  p_opening_cash: openingCash,
  p_opening_notes: body.opening_notes || null,
  p_handover_from: body.handover_from_shift_id || null,
})
```

**Возвращает:** `{ "shift_id": "uuid", "opening_cash": 50000 }`

**Ошибки (те же коды что в point):**
- `409 point-shift-already-open` — смена уже открыта
- `409 point-shift-operator-not-onboarded` — оператор не онбординг
- `400 opening-cash-required` — не указана касса

---

### 1.3 `POST /api/operator/shift/close`

**Файл:** `app/api/operator/shift/close/route.ts` (новый)

**Логика:** Копия `app/api/point/shift/close/route.ts`. Изменения:
- Вместо `device.company_id` → `ctx.companyId`
- `closed_by` в body iOS не шлёт — используем `ctx.staffId`
- Функцию `getMissingBlockingChecklists()` (проверка обязательных чек-листов) копируем as-is из point-версии

**iOS сейчас присылает:**
```json
{
  "closing_cash": 75000,
  "closing_kaspi": 25000,
  "closing_online": 15000,
  "closing_card": 8000,
  "closing_notes": "Всё ок"
}
```

**Поля `closing_online` и `closing_card` игнорируем** — RPC их не принимает.

**RPC вызов:**
```typescript
await supabase.rpc('point_shift_close', {
  p_shift_id: shiftId,
  p_closed_by: ctx.staffId,        // из контекста, не из body
  p_closing_cash: Number(body.closing_cash || 0),
  p_closing_kaspi: Number(body.closing_kaspi || 0),
  p_kaspi_before_midnight: Number(body.kaspi_before_midnight || 0),
  p_kaspi_after_midnight: Number(body.kaspi_after_midnight || 0),
  p_z_report_url: body.z_report_url || null,
  p_x_report_url: body.x_report_url || null,
  p_closing_notes: body.closing_notes || null,
})
```

**Возвращает:** `{ "shift_id": "uuid", "totals": {...} }`

**Ошибки:**
- `409 point-shift-no-open` — нет открытой смены
- `409 point-shift-required-checklists-missing` — есть незакрытые блокирующие чек-листы
- `400 point-shift-close-failed` — ошибка RPC

---

### 1.4 `POST /api/operator/shift/handover`

**Файл:** `app/api/operator/shift/handover/route.ts` (новый)

**Логика:** Копия `app/api/point/shift/handover/route.ts`. Изменения:
- Вместо `device.company_id` → `ctx.companyId`
- Вместо `device.id` → `null` (у iOS нет device id, передаём null в `p_point_device_id`)

**iOS Phase 1 присылает упрощённый body:**
```json
{ "to_operator_id": "uuid", "notes": "Передаю смену..." }
```

**Проблема:** RPC `point_shift_handover` требует `closing_cash`, `closing_kaspi`, `next_opening_cash` и т.д. iOS пока это не передаёт.

**Решение для Phase 1:** Дефолтируем недостающие поля в 0 / null. Смена закроется с нулями. Это временно — iOS добавит поля в Phase 2.

```typescript
// Маппинг упрощённого iOS-body на полный RPC body
const body = await request.json()
const closingCash   = Number(body.closing_cash   || 0)
const closingKaspi  = Number(body.closing_kaspi  || 0)
const nextOpCash    = Number(body.next_opening_cash || 0)
const nextOperatorId = body.to_operator_id || body.next_operator_id || null
```

**RPC вызов:**
```typescript
await supabase.rpc('point_shift_handover', {
  p_prev_shift_id: prevId,
  p_closed_by: ctx.staffId,
  p_closing_cash: closingCash,
  p_closing_kaspi: closingKaspi,
  p_kaspi_before_midnight: Number(body.kaspi_before_midnight || 0),
  p_kaspi_after_midnight: Number(body.kaspi_after_midnight || 0),
  p_z_report_url: body.z_report_url || null,
  p_x_report_url: body.x_report_url || null,
  p_closing_notes: body.notes || body.closing_notes || null,
  p_company_id: ctx.companyId,
  p_operator_id: nextOperatorId,
  p_point_device_id: null,           // iOS не device
  p_shift_type: body.next_shift_type || 'day',
  p_opening_cash: nextOpCash,
  p_opening_notes: body.next_opening_notes || null,
})
```

**Возвращает:** `{ "previous_shift_id": "uuid", "new_shift_id": "uuid", "totals": {...} }`

---

## Шаг 2: Knowledge Routes (2 файла)

### 2.1 `GET /api/operator/knowledge`

**Файл:** `app/api/operator/knowledge/route.ts` (новый)

**Логика:** Копия `app/api/point/knowledge/route.ts`. Изменения:
- Вместо `device.company_id` → `ctx.companyId`
- `staffId` берётся из `ctx.staffId` (не из query params как в point-версии)

**Что возвращает (полный формат как в point, iOS ожидает тот же):**
```json
{
  "ok": true,
  "data": {
    "company_id": "uuid",
    "articles": [...],
    "pending_confirmations": [...],
    "checklist_templates": [...],
    "checklist_items": [...],
    "checklist_runs": [...],
    "open_shift": { "id": "uuid", "shift_type": "day", "opened_at": "..." }
  }
}
```

**Фильтр статей:** `is_published = true AND (company_id IS NULL OR company_id = ctx.companyId)`

**Pending confirmations:** только если `ctx.staffId` не null. Статьи с `requires_confirmation = true` где нет записи в `knowledge_article_confirmations` для текущей версии.

---

### 2.2 `POST /api/operator/knowledge/confirm`

**Файл:** `app/api/operator/knowledge/confirm/route.ts` (новый)

**Логика:** Копия `app/api/point/knowledge/confirm/route.ts`. Изменения:
- `staffId` берётся из `ctx.staffId` (не из body/header как в point-версии)
- Если `ctx.staffId = null` → возвращаем `400 no-staff-link`

**Body от iOS:**
```json
{ "article_id": "uuid" }
```

**Логика:**
1. Проверить что статья `is_published = true` и `requires_confirmation = true`
2. Проверить что `company_id` статьи совпадает с `ctx.companyId` (или null = глобальная)
3. Найти текущую `version` статьи
4. INSERT в `knowledge_article_confirmations` с `ON CONFLICT DO NOTHING` (idempotent)

**Возвращает:** `{ "ok": true, "data": { "article_id": "uuid", "version": 3, "already_confirmed": false } }`

---

## Шаг 3: Checklist Routes (4 файла)

### 3.1 `GET /api/operator/checklist/templates`

**Файл:** `app/api/operator/checklist/templates/route.ts` (новый)

**Логика:** Новый endpoint (в point-версии templates возвращаются вместе с knowledge). iOS запрашивает отдельно.

```typescript
const { data: templates } = await supabase
  .from('checklist_templates')
  .select(`
    id, title, description, role_scope, shift_scope, schedule_type,
    recurrence_minutes, blocks_shift, is_active, sort_order, company_id,
    items:checklist_items (
      id, template_id, title, description, answer_type, is_required,
      requires_photo, severity, fine_amount, bonus_amount, sort_order,
      knowledge_article_id
    )
  `)
  .eq('is_active', true)
  .or(`company_id.is.null,company_id.eq.${ctx.companyId}`)
  .order('sort_order')
```

**Важно о таблице:** В кодовой базе используется `checklist_items`, **не** `checklist_template_items` как написано в iOS-спеке. Используем правильное название.

**Возвращает:** `{ "templates": [...] }`

---

### 3.2 `POST /api/operator/checklist/run`

**Файл:** `app/api/operator/checklist/run/route.ts` (новый)

**Логика:** Копия `app/api/point/checklist/run/route.ts`. Изменения:
- Auth через `requireOperator`
- `device.company_id` → `ctx.companyId`
- `run_by` берётся из `ctx.staffId` (не из body/header как в point-версии)

**Body от iOS:**
```json
{ "template_id": "uuid" }
```

**Логика:**
1. Проверить что есть открытая смена (`getCurrentOpenShift(supabase, ctx.companyId)`)
2. Если нет — `409 point-shift-no-open`
3. Проверить нет ли уже `in_progress` run для этого template в этой смене (idempotent)
4. INSERT в `checklist_runs` со `status: 'in_progress'`

**Возвращает:** `{ "run_id": "uuid" }` или `{ "run_id": "uuid", "reused": true }`

---

### 3.3 `GET /api/operator/checklist/run/[id]` и `PATCH /api/operator/checklist/run/[id]`

**Файл:** `app/api/operator/checklist/run/[id]/route.ts` (новый)

**GET логика:** Загружаем run + template + items, проверяем что run принадлежит компании оператора через `shift.company_id === ctx.companyId`.

**PATCH логика:** Копия `app/api/point/checklist/run/[id]/route.ts`. Ключевая проблема:

**iOS присылает `answers` (массив), backend ожидает `responses` (объект):**

```typescript
// iOS шлёт:
// { "answers": [{ "item_id": "uuid", "answer": "yes", "comment": "..." }] }
// Point-backend ожидает:
// { "responses": { "item_id": { "value": "yes", "comment": "..." } } }

// Нормализация в operator route:
let responses: Record<string, unknown> = {}

if (body.responses && typeof body.responses === 'object' && !Array.isArray(body.responses)) {
  // Формат point-backend — принимаем as-is
  responses = body.responses
} else if (Array.isArray(body.answers)) {
  // Формат iOS — конвертируем массив в объект
  for (const item of body.answers) {
    responses[item.item_id] = {
      answer: item.answer,
      value: item.answer,
      comment: item.comment || null,
      photo_base64: item.photo_base64 || null,
    }
  }
} else if (Array.isArray(body.responses)) {
  // iOS может тоже прислать responses как массив
  for (const item of body.responses) {
    responses[item.item_id] = { answer: item.answer, value: item.answer, comment: item.comment || null }
  }
}
```

**Фото:** `photo_base64` от iOS сохраняется в поле `photo_data_url` внутри response-объекта (как делает point-backend). Загрузка в Supabase Storage — Phase 2.

**Возвращает:** `{ "run_id": "uuid", "updated": true }`

---

### 3.4 `POST /api/operator/checklist/run/[id]/complete`

**Файл:** `app/api/operator/checklist/run/[id]/complete/route.ts` (новый)

**Логика:** Полная копия `app/api/point/checklist/run/[id]/complete/route.ts`. Изменения:
- Auth через `requireOperator`
- Проверка принадлежности через `shift.company_id === ctx.companyId`
- `operator_id` для авто-инцидентов берётся из `ctx.staffId`

**Что делает:**
1. Проверяет run в статусе `in_progress`
2. Проверяет все required items заполнены (иначе `409 checklist-required-items-missing`)
3. Считает `fines_total` и `bonuses_total` из items и responses
4. UPDATE `checklist_runs` → `status: 'completed'`
5. Автоматически создаёт инциденты через RPC `incidents_create` для каждого item с штрафом/бонусом

**Возвращает:** `{ "run_id": "uuid", "status": "completed", "fines_total": 0, "bonuses_total": 0 }`

---

## Шаг 4: Incidents Route (1 файл)

### `GET /api/operator/incidents`

**Файл:** `app/api/operator/incidents/route.ts` (новый)

**Логика:** Адаптация `app/api/point/incidents/route.ts`, только GET.

**Важное отличие от point-версии:** Point-версия фильтрует по текущей открытой смене. iOS хочет видеть **свои** инциденты (в которых оператор фигурирует) — не только текущей смены.

**Как найти инциденты оператора:** Инциденты в `incidents` таблице связаны через `subject_staff_id` (staff_id). У нас есть `ctx.staffId`. Если `ctx.staffId = null` — возвращаем пустой массив.

```typescript
const url = new URL(request.url)
const status = url.searchParams.get('status')  // 'open', 'confirmed', 'all'
const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200)

// Если нет staff-связки — у оператора нет инцидентов
if (!ctx.staffId) return json({ incidents: [], total: 0 })

let query = supabase
  .from('incidents')
  .select(`
    id, kind, severity, status, title, description,
    fine_amount, bonus_amount, photo_urls, occurred_at, created_at,
    shift_id, company_id,
    article:knowledge_articles!article_id ( id, title )
  `)
  .eq('subject_staff_id', ctx.staffId)
  .eq('company_id', ctx.companyId)
  .order('occurred_at', { ascending: false })
  .limit(limit)

if (status && status !== 'all') {
  query = query.eq('status', status)
}
```

**Возвращает:** `{ "incidents": [...] }`

---

## Шаг 5: Arena Route (1 файл)

### `GET /api/operator/arena` и `POST /api/operator/arena`

**Файл:** `app/api/operator/arena/route.ts` (новый)

**Самый сложный endpoint.** Point-версия использует `device.id` как `point_project_id`. У iOS-оператора нет device id.

**Решение — найти point_project через company_id:**

```typescript
// Найти point project для компании оператора
const { data: pointProject } = await supabase
  .from('point_projects')
  .select('id')
  .eq('company_id', ctx.companyId)
  .eq('is_active', true)
  .maybeSingle()

if (!pointProject) {
  return json({ error: 'no-point-project', detail: 'No active point project for this company' }, 404)
}

const projectId = pointProject.id
const companyId = ctx.companyId
```

**После резолва `projectId`** — весь остальной код arena GET и POST копируется из point-версии as-is, заменяя `device.id` → `projectId`, `device.company_id` → `companyId`.

**GET:** Возвращает zones, stations, tariffs, active sessions, today_income, today_tech_logs.

**POST — какие actions поддерживаем:**

| Action | Phase 1 | Примечание |
|--------|---------|------------|
| `extendSession` | ✅ | iOS Phase 1 использует |
| `techLog` | ✅ | iOS Phase 1 использует |
| `startSession` | ✅ | Копируем из point |
| `endSession` | ✅ | Копируем из point |
| `getSessions` | ✅ | История сессий |
| `notify5min` | ✅ | Telegram уведомление |
| `endSessionWithRefund` | ✅ | Копируем из point |

**Весь POST-код arena копируется из `app/api/point/arena/route.ts` с заменой auth-части.**

---

## Безопасность (применяется ко всем 14 routes)

1. **Каждый route** начинается с `requireOperator(request)` — возвращает 401/403 если JWT невалиден или нет company assignment
2. **Все DB-запросы** фильтруются по `ctx.companyId` — оператор не может увидеть данные другой компании
3. **`company_id` не берётся из body** — только из проверенного контекста
4. **Для multi-company операторов** — используем primary company. Query param `?company_id=` для override — Phase 2
5. **Audit log** через `writeAuditLog()` для всех mutating endpoints (open, close, handover, confirm, run start, run complete)

---

## Важные технические детали

### Маппинг `staffId` ↔ `operatorId`

В таблице `operator_staff_links`:
- `operator_id` → `operators.id`
- `staff_id` → `staff.id`

RPC `point_shift_open` и `point_shift_close` принимают **`staff.id`** в параметре `p_operator_id`. Это контринтуитивно, но так работает БД-функция. Поэтому в `requireOperator` мы резолвим `staffId` через `operator_staff_links`.

Если у оператора нет записи в `operator_staff_links` (т.е. `staffId = null`):
- Смену открыть можно (RPC принимает null)
- Knowledge confirmations — невозможны (нужен staff_id)
- Incidents (GET) — вернём пустой массив

### `checklist_items` vs `checklist_template_items`

iOS-спек написал `checklist_template_items` — это **неверно**. В реальной кодовой базе таблица называется `checklist_items` (видно в `app/api/point/checklist/run/[id]/complete/route.ts:86`). Используем `checklist_items`.

### `answers` vs `responses` в PATCH checklist

iOS Phase 1 шлёт ключ `answers` (массив объектов). Backend хранит `responses` (JSONB-объект где ключи — `item_id`). Operator PATCH route принимает оба формата и конвертирует.

### Arena и множество point_projects

Если у компании несколько `point_projects` (несколько залов) — `maybeSingle()` вернёт первый. Для Phase 1 этого достаточно. В Phase 2 iOS может передавать `?project_id=` для явного выбора.

---

## Структура создаваемых файлов

```
lib/server/
└── operator-context.ts          ← НОВЫЙ (helper)

app/api/operator/
├── shift/
│   ├── current/
│   │   └── route.ts             ← НОВЫЙ
│   ├── open/
│   │   └── route.ts             ← НОВЫЙ
│   ├── close/
│   │   └── route.ts             ← НОВЫЙ
│   └── handover/
│       └── route.ts             ← НОВЫЙ
├── knowledge/
│   ├── route.ts                 ← НОВЫЙ
│   └── confirm/
│       └── route.ts             ← НОВЫЙ
├── checklist/
│   ├── templates/
│   │   └── route.ts             ← НОВЫЙ
│   └── run/
│       ├── route.ts             ← НОВЫЙ
│       └── [id]/
│           ├── route.ts         ← НОВЫЙ (GET + PATCH)
│           └── complete/
│               └── route.ts    ← НОВЫЙ
├── incidents/
│   └── route.ts                 ← НОВЫЙ
└── arena/
    └── route.ts                 ← НОВЫЙ

# Итого: 1 helper + 13 route файлов = 14 файлов
# Существующие файлы: НЕ ТРОГАЕМ НИ ОДИН
```

---

## Таблица всех endpoints

| Endpoint | Метод | Auth | Source | Статус |
|----------|-------|------|--------|--------|
| `/api/operator/shift/current` | GET | JWT | `/api/point/shift/current` | ⏳ TODO |
| `/api/operator/shift/open` | POST | JWT | `/api/point/shift/open` | ⏳ TODO |
| `/api/operator/shift/close` | POST | JWT | `/api/point/shift/close` | ⏳ TODO |
| `/api/operator/shift/handover` | POST | JWT | `/api/point/shift/handover` | ⏳ TODO |
| `/api/operator/knowledge` | GET | JWT | `/api/point/knowledge` | ⏳ TODO |
| `/api/operator/knowledge/confirm` | POST | JWT | `/api/point/knowledge/confirm` | ⏳ TODO |
| `/api/operator/checklist/templates` | GET | JWT | новый | ⏳ TODO |
| `/api/operator/checklist/run` | POST | JWT | `/api/point/checklist/run` | ⏳ TODO |
| `/api/operator/checklist/run/[id]` | GET | JWT | `/api/point/checklist/run/[id]` | ⏳ TODO |
| `/api/operator/checklist/run/[id]` | PATCH | JWT | `/api/point/checklist/run/[id]` | ⏳ TODO |
| `/api/operator/checklist/run/[id]/complete` | POST | JWT | `/api/point/checklist/run/[id]/complete` | ⏳ TODO |
| `/api/operator/incidents` | GET | JWT | `/api/point/incidents` | ⏳ TODO |
| `/api/operator/arena` | GET | JWT | `/api/point/arena` | ⏳ TODO |
| `/api/operator/arena` | POST | JWT | `/api/point/arena` | ⏳ TODO |

---

## Порядок реализации

### День 1
1. `lib/server/operator-context.ts` — helper `requireOperator`
2. `app/api/operator/shift/current/route.ts`
3. `app/api/operator/shift/open/route.ts`
4. `app/api/operator/shift/close/route.ts`
5. `app/api/operator/shift/handover/route.ts`

### День 2
6. `app/api/operator/knowledge/route.ts`
7. `app/api/operator/knowledge/confirm/route.ts`
8. `app/api/operator/checklist/templates/route.ts`
9. `app/api/operator/checklist/run/route.ts`
10. `app/api/operator/checklist/run/[id]/route.ts` (GET + PATCH)
11. `app/api/operator/checklist/run/[id]/complete/route.ts`
12. `app/api/operator/incidents/route.ts`
13. `app/api/operator/arena/route.ts` (GET + POST)

---

## Тестирование

После деплоя проверить через curl с реальным Bearer JWT тестового оператора:

```bash
# Получить JWT: supabase auth sign in → access_token
TOKEN="eyJ..."

# Проверить авторизацию
curl -H "Authorization: Bearer $TOKEN" https://ordaops.kz/api/operator/shift/current

# Открыть смену
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"opening_cash": 50000, "shift_type": "day"}' \
  https://ordaops.kz/api/operator/shift/open

# Проверить чек-листы
curl -H "Authorization: Bearer $TOKEN" https://ordaops.kz/api/operator/checklist/templates
```

**Сценарии для QA:**
- Оператор без `operator_company_assignments` → `403 no-company-assigned`
- Staff-пользователь (не оператор) → `403 operator-auth-disabled`
- Открыть смену → получить current → закрыть смену
- Попытка открыть смену дважды → `409 point-shift-already-open`
- Закрыть смену с незакрытыми blocking чек-листами → `409 point-shift-required-checklists-missing`
- Knowledge confirm → повторный confirm → `already_confirmed: true`

---

## Открытые вопросы (нужно решить с iOS-командой)

1. **Arena multi-project:** если у компании несколько `point_projects` — как iOS выбирает нужный? Передавать `?project_id=` или всегда первый активный?
2. **Incidents scope:** фильтровать по `subject_staff_id` оператора (его личные) или по текущей открытой смене компании (как в point)?
3. **Knowledge confirm без staffId:** что если оператор не связан со staff? Блокировать (`400`) или разрешить подтверждение без staff_id?
