/**
 * AI tools: одобрить / отклонить заявку на пополнение витрины.
 * Capability: store-requests.approve / store-requests.decline
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

async function getPendingRequests(ctx: any) {
  const { data } = await ctx.supabase
    .from('inventory_requests')
    .select('id, status, created_at, requesting_company_id, comment, company:companies!requesting_company_id(name)')
    .in('status', ['new', 'disputed'])
    .order('created_at', { ascending: false })
  return (data || []).map((r: any) => {
    const company = Array.isArray(r.company) ? r.company[0] : r.company
    const date = r.created_at ? new Date(r.created_at).toLocaleDateString('ru-RU') : ''
    return {
      value: r.id,
      label: `${company?.name || ''} · ${date}` + (r.status === 'disputed' ? ' ⚠️' : ''),
    }
  })
}

export const approveRequestTool: CopilotTool = {
  name: 'approve_inventory_request',
  category: 'inventory',
  description: 'Одобрить заявку на пополнение витрины',
  requiredCapability: 'store-requests.approve',
  severity: 'high',
  params: [
    {
      name: 'request_id',
      label: 'Какую заявку',
      type: 'select',
      required: true,
      description: 'ID заявки из ожидающих',
      getOptions: getPendingRequests,
    },
  ],
  handler: async (input, ctx) => {
    const reqId = String(input.request_id || '')
    if (!reqId) return { ok: false, message: 'Не выбрана заявка.' }

    // Используем существующую RPC inventory_decide_request
    const { error } = await ctx.supabase.rpc('inventory_decide_request', {
      p_request_id: reqId,
      p_decision: 'approve',
      p_actor_user_id: ctx.userId,
      p_decision_comment: 'Одобрено через AI Copilot',
    })
    if (error) return { ok: false, message: `Не удалось одобрить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-request',
        entityId: reqId,
        action: 'approve',
        payload: { via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: '✅ Заявка одобрена. Товар перенесён со склада на витрину.' }
  },
}

export const declineRequestTool: CopilotTool = {
  name: 'decline_inventory_request',
  category: 'inventory',
  description: 'Отклонить заявку на пополнение витрины',
  requiredCapability: 'store-requests.decline',
  severity: 'high',
  params: [
    {
      name: 'request_id',
      label: 'Какую заявку',
      type: 'select',
      required: true,
      description: 'ID заявки',
      getOptions: getPendingRequests,
    },
    {
      name: 'reason',
      label: 'Причина отказа',
      type: 'string',
      required: true,
      description: 'Почему отклоняем',
      extractHint: 'не хватает на складе',
    },
  ],
  handler: async (input, ctx) => {
    const reqId = String(input.request_id || '')
    const reason = String(input.reason || '').trim()
    if (!reqId || !reason) return { ok: false, message: 'Нужны заявка и причина.' }

    const { error } = await ctx.supabase.rpc('inventory_decide_request', {
      p_request_id: reqId,
      p_decision: 'decline',
      p_actor_user_id: ctx.userId,
      p_decision_comment: reason,
    })
    if (error) return { ok: false, message: `Не удалось отклонить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-request',
        entityId: reqId,
        action: 'decline',
        payload: { reason, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `❌ Заявка отклонена. Причина: ${reason}` }
  },
}
