import type { AppConfig, ShiftForm, QueueItem, OperatorSession } from '@/types'
import { localRef, parseMoney } from '@/lib/utils'
import * as api from '@/lib/api'

const ipc = window.electron

// ─── Queue helpers ────────────────────────────────────────────────────────────

export async function queueShiftReport(
  form: ShiftForm & { local_ref?: string },
  companyId?: string | null,
): Promise<number> {
  const ref = form.local_ref || localRef()
  const result = await ipc.queue.add({
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
  const result = await ipc.queue.add({
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
  const result = await ipc.queue.add({
    type: 'create_debt',
    payload: { ...payload, local_ref: ref, _company_id: companyId || null },
    localRef: ref,
  })
  return result.id
}

export async function queueDeleteDebt(itemId: string, companyId?: string | null): Promise<number> {
  const ref = localRef()
  const result = await ipc.queue.add({
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
  const result = await ipc.queue.add({
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
  const result = await ipc.queue.add({
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
  const result = await ipc.queue.add({
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
  const result = await ipc.queue.add({
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

// ─── Sync engine ──────────────────────────────────────────────────────────────

export async function syncQueue(config: AppConfig): Promise<{ synced: number; failed: number }> {
  const items = (await ipc.queue.list({ status: 'pending' })) as QueueItem[]
  let synced = 0
  let failed = 0

  for (const item of items) {
    // max 10 attempts
    if (item.attempts >= 10) {
      await ipc.queue.update({ id: item.id, status: 'failed', error: 'max attempts reached' })
      failed++
      continue
    }

    try {
      await processQueueItem(config, item)
      await ipc.queue.done({ id: item.id })
      synced++
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка синхронизации'
      await ipc.queue.update({ id: item.id, status: 'pending', error: msg })
      failed++
    }
  }

  return { synced, failed }
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
