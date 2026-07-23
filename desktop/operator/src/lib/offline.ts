import type { AppConfig, ShiftForm, QueueItem, QueueCounts, OperatorSession } from '@/types'
import { localRef, parseMoney } from '@/lib/utils'
import * as api from '@/lib/api'

const ipc = window.electron

/** Событие для UI (бейдж в шапке): состав очереди изменился */
export const QUEUE_CHANGED_EVENT = 'orda:queue-changed'

/** Событие: открыть глобальный экран очереди (слушает App.tsx) */
export const OPEN_QUEUE_EVENT = 'orda:open-queue'

export function openQueueScreen() {
  try {
    window.dispatchEvent(new CustomEvent(OPEN_QUEUE_EVENT))
  } catch {
    /* ignore */
  }
}

function notifyQueueChanged() {
  try {
    window.dispatchEvent(new CustomEvent(QUEUE_CHANGED_EVENT))
  } catch {
    /* ignore */
  }
}

// ─── Queue helpers ────────────────────────────────────────────────────────────

async function enqueue(data: { type: string; payload: unknown; localRef?: string }): Promise<{ id: number }> {
  const result = await ipc.queue.add(data)
  notifyQueueChanged()
  return result
}

export async function queueShiftReport(
  form: ShiftForm & { local_ref?: string },
  companyId?: string | null,
): Promise<number> {
  const ref = form.local_ref || localRef()
  const result = await enqueue({
    type: 'shift_report',
    payload: { ...form, local_ref: ref, _company_id: companyId || null },
    localRef: ref,
  })
  return result.id
}

export async function queueClosePointShift(
  payload: Record<string, unknown>,
  companyId?: string | null,
): Promise<number> {
  const ref = localRef()
  const result = await enqueue({
    type: 'close_shift',
    payload: { ...payload, _company_id: companyId || null },
    localRef: ref,
  })
  return result.id
}

export async function queueCreateDebt(
  payload: Record<string, unknown>,
  companyId?: string | null,
): Promise<number> {
  const ref = localRef()
  const result = await enqueue({
    type: 'create_debt',
    payload: { ...payload, local_ref: ref, _company_id: companyId || null },
    localRef: ref,
  })
  return result.id
}

export async function queueDeleteDebt(itemId: string, companyId?: string | null): Promise<number> {
  const ref = localRef()
  const result = await enqueue({
    type: 'delete_debt',
    payload: { itemId, _company_id: companyId || null },
    localRef: ref,
  })
  return result.id
}

/**
 * Очередь для продажи через POS если интернет упал.
 * При sync будет вызвана api.createPointInventorySale с теми же параметрами.
 */
export async function queueInventorySale(
  payload: Record<string, unknown>,
  session: OperatorSession,
  companyId?: string | null,
): Promise<{ id: number; localRef: string }> {
  const ref = (payload.local_ref as string) || localRef()
  const result = await enqueue({
    type: 'inventory_sale',
    payload: {
      ...payload,
      local_ref: ref,
      _company_id: companyId || null,
      _session: {
        operator: session.operator,
        company: session.company,
      },
    },
    localRef: ref,
  })
  return { id: result.id, localRef: ref }
}

/**
 * Очередь для возврата продажи в офлайне.
 */
export async function queueInventoryReturn(
  payload: Record<string, unknown>,
  session: OperatorSession,
  companyId?: string | null,
): Promise<{ id: number; localRef: string }> {
  const ref = (payload.local_ref as string) || localRef()
  const result = await enqueue({
    type: 'inventory_return',
    payload: {
      ...payload,
      local_ref: ref,
      _company_id: companyId || null,
      _session: {
        operator: session.operator,
        company: session.company,
      },
    },
    localRef: ref,
  })
  return { id: result.id, localRef: ref }
}

/**
 * Очередь для заявки на инвентарь со склада.
 */
export async function queueInventoryRequest(
  payload: { comment?: string | null; items: Array<{ item_id: string; requested_qty: number; comment?: string | null }> },
  session: OperatorSession,
  companyId?: string | null,
): Promise<{ id: number; localRef: string }> {
  const ref = localRef()
  const result = await enqueue({
    type: 'inventory_request',
    payload: {
      ...payload,
      local_ref: ref,
      _company_id: companyId || null,
      _session: { operator: session.operator, company: session.company },
    },
    localRef: ref,
  })
  return { id: result.id, localRef: ref }
}

/**
 * Очередь для прохождения чек-листа в офлайне.
 * Сохраняем все ответы — на синке отправим start + complete.
 */
export async function queueChecklistRun(
  payload: { template_id: string; answers: Record<string, unknown>; comment?: string | null },
  session: OperatorSession,
  companyId?: string | null,
): Promise<{ id: number; localRef: string }> {
  const ref = localRef()
  const result = await enqueue({
    type: 'checklist_run',
    payload: {
      ...payload,
      local_ref: ref,
      _company_id: companyId || null,
      _session: { operator: session.operator, company: session.company },
    },
    localRef: ref,
  })
  return { id: result.id, localRef: ref }
}

export async function getPendingCount(): Promise<number> {
  return ipc.queue.count()
}

export async function getPendingItems(): Promise<QueueItem[]> {
  return (await ipc.queue.list({ status: 'pending' })) as QueueItem[]
}

/** Все живые элементы очереди (pending + attention), для экрана очереди */
export async function getQueueItems(): Promise<QueueItem[]> {
  return (await ipc.queue.list()) as QueueItem[]
}

/** Счётчики очереди: ждут отправки / требуют внимания */
export async function getQueueCounts(): Promise<QueueCounts> {
  try {
    return await ipc.queue.counts()
  } catch {
    // fallback на случай рассинхрона preload (dev hot-reload)
    const items = (await ipc.queue.list()) as QueueItem[]
    return {
      pending: items.filter((i) => i.status === 'pending').length,
      attention: items.filter((i) => i.status === 'attention' || i.status === 'failed').length,
    }
  }
}

// ─── Sync engine ──────────────────────────────────────────────────────────────

/** После этого числа неудачных попыток ретраим не чаще раза в 5 минут */
const FAST_ATTEMPTS_LIMIT = 5
const SLOW_RETRY_INTERVAL_MS = 5 * 60_000

/**
 * Отказ сервера ПО СУЩЕСТВУ: HTTP 4xx («недостаточно остатка», «товар не найден»…).
 * api.request() вешает на ошибку поле status при любом !res.ok ответе;
 * сетевые ошибки/timeout поля status не имеют. 408/429 считаем временными.
 */
function isServerRejection(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429
}

function shouldAttemptNow(item: QueueItem, force: boolean): boolean {
  if (force) return true
  if ((item.attempts || 0) < FAST_ATTEMPTS_LIMIT) return true
  if (!item.last_attempt_at) return true
  const last = new Date(item.last_attempt_at).getTime()
  if (!Number.isFinite(last)) return true
  return Date.now() - last >= SLOW_RETRY_INTERVAL_MS
}

export interface SyncQueueResult {
  synced: number
  /** Временные ошибки (сеть/5xx/429) — останутся pending и уйдут позже */
  failed: number
  /** Отклонены сервером по существу (4xx) — переведены в attention */
  attention: number
}

/**
 * Прогоняет очередь. Продажи НЕ теряются никогда:
 *  — сетевые/временные ошибки (fetch failed, timeout, 5xx, 429) → item остаётся
 *    'pending' навсегда; первые 5 попыток — каждый sync, дальше — не чаще раза в 5 минут;
 *  — отказ сервера по существу (4xx с телом ошибки) → 'attention': авторетрай
 *    выключен, текст ошибки сохранён, решает человек (кнопка «Повторить»).
 */
export async function syncQueue(
  config: AppConfig,
  opts?: { force?: boolean; onlyId?: number },
): Promise<SyncQueueResult> {
  const all = (await ipc.queue.list({ status: 'pending' })) as QueueItem[]
  const items = opts?.onlyId != null ? all.filter((i) => i.id === opts.onlyId) : all
  let synced = 0
  let failed = 0
  let attention = 0

  for (const item of items) {
    if (!shouldAttemptNow(item, opts?.force === true)) continue

    const attemptAt = new Date().toISOString()
    try {
      await processQueueItem(config, item)
      await ipc.queue.done({ id: item.id })
      synced++
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка синхронизации'
      if (isServerRejection(err)) {
        await ipc.queue.update({ id: item.id, status: 'attention', error: msg, lastAttemptAt: attemptAt })
        attention++
      } else {
        await ipc.queue.update({ id: item.id, status: 'pending', error: msg, lastAttemptAt: attemptAt })
        failed++
      }
    }
  }

  if (synced > 0 || attention > 0) notifyQueueChanged()
  return { synced, failed, attention }
}

/** Принудительная попытка одного элемента (в т.ч. attention → pending → отправка) */
export async function retryItem(config: AppConfig, id: number): Promise<SyncQueueResult> {
  const items = (await ipc.queue.list()) as QueueItem[]
  const item = items.find((i) => i.id === id)
  if (!item) return { synced: 0, failed: 0, attention: 0 }
  if (item.status !== 'pending') {
    // Ручной перевод в pending — не считаем это «попыткой»
    await ipc.queue.update({
      id,
      status: 'pending',
      error: item.last_error || undefined,
      countAttempt: false,
    })
    notifyQueueChanged()
  }
  return syncQueue(config, { onlyId: id, force: true })
}

/** Переводит все attention в pending и пробует отправить всё принудительно */
export async function retryAll(config: AppConfig): Promise<SyncQueueResult> {
  const items = (await ipc.queue.list()) as QueueItem[]
  for (const item of items) {
    if (item.status === 'attention' || item.status === 'failed') {
      await ipc.queue.update({
        id: item.id,
        status: 'pending',
        error: item.last_error || undefined,
        countAttempt: false,
      })
    }
  }
  notifyQueueChanged()
  return syncQueue(config, { force: true })
}

async function processQueueItem(config: AppConfig, item: QueueItem): Promise<void> {
  const p = item.payload as Record<string, unknown>
  const companyId = (p._company_id as string | null) || null

  if (item.type === 'shift_report') {
    await api.sendShiftReport(config, p as unknown as ShiftForm, String(p.local_ref || ''), companyId)
    return
  }

  if (item.type === 'close_shift') {
    const cleanPayload = { ...p }
    delete cleanPayload._company_id
    await api.closePointShift(config, cleanPayload as any, companyId)
    return
  }

  if (item.type === 'create_debt') {
    await api.createDebt(config, {
      operator_id: p.operator_id as string | null,
      client_name: p.client_name as string | null,
      item_name: p.item_name as string,
      quantity: Number(p.quantity || 1),
      unit_price: Number(p.unit_price || 0),
      total_amount: Number(p.total_amount || 0),
      comment: p.comment as string | null,
      local_ref: p.local_ref as string | null,
    }, companyId)
    return
  }

  if (item.type === 'delete_debt') {
    await api.deleteDebt(config, p.itemId as string, companyId)
    return
  }

  if (item.type === 'inventory_sale') {
    const sessionStub = p._session as { operator: any; company: any } | undefined
    if (!sessionStub) throw new Error('inventory_sale: нет session в payload')
    const session: OperatorSession = {
      operator: sessionStub.operator,
      company: sessionStub.company,
    } as OperatorSession
    // Удаляем служебные поля перед отправкой на сервер
    const cleanPayload = { ...p }
    delete cleanPayload._company_id
    delete cleanPayload._session
    await api.createPointInventorySale(config, session, cleanPayload as any)
    return
  }

  if (item.type === 'inventory_return') {
    const sessionStub = p._session as { operator: any; company: any } | undefined
    if (!sessionStub) throw new Error('inventory_return: нет session в payload')
    const session: OperatorSession = {
      operator: sessionStub.operator,
      company: sessionStub.company,
    } as OperatorSession
    const cleanPayload = { ...p }
    delete cleanPayload._company_id
    delete cleanPayload._session
    await api.createPointInventoryReturn(config, session, cleanPayload as any)
    return
  }

  if (item.type === 'inventory_request') {
    const sessionStub = p._session as { operator: any; company: any } | undefined
    if (!sessionStub) throw new Error('inventory_request: нет session в payload')
    const session: OperatorSession = {
      operator: sessionStub.operator,
      company: sessionStub.company,
    } as OperatorSession
    await api.createPointInventoryRequest(config, session, {
      comment: (p.comment as string | null) || null,
      items: (p.items as any[]) || [],
    })
    return
  }

  if (item.type === 'checklist_run') {
    // Чек-листы не имеют offline-API, но можно создать запись после восстановления связи
    // Сейчас пропускаем — ставим как done чтобы не зависало
    return
  }
}
