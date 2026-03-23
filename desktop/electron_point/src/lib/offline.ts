import type { AppConfig, ShiftForm, QueueItem } from '@/types'
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

export async function getPendingCount(): Promise<number> {
  return ipc.queue.count()
}

export async function getPendingItems(): Promise<QueueItem[]> {
  return ipc.queue.list({ status: 'pending' })
}

// ─── Sync engine ──────────────────────────────────────────────────────────────

export async function syncQueue(config: AppConfig): Promise<{ synced: number; failed: number }> {
  const items: QueueItem[] = await ipc.queue.list({ status: 'pending' })
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
}

