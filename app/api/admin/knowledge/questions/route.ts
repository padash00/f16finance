import { NextResponse } from 'next/server'

import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/**
 * О чём операторы спрашивают в правилах.
 *
 * Каждый раз, когда сотрудник жмёт «объясни проще», это признание: текст
 * написан непонятно. Сгруппированный список — единственный честный указатель,
 * какой пункт регламента переписать, вместо догадок владельца.
 */
export async function GET(request: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(request, 'staff')
    if (guard) return guard
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'knowledge-admin.view')
    if (denied) return denied

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const orgId = access.activeOrganization?.id || null
    // NEVER-паттерн: без организации фильтр ниже не навешивался — выдача
    // возвращала вопросы операторов всех клиентов сразу.
    if (!orgId && !access.isSuperAdmin) {
      return json({ ok: true, data: { available: true, groups: [] } })
    }

    let query = supabase
      .from('knowledge_questions')
      .select('id, article_id, question, answer, operator_id, company_id, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    if (orgId) query = query.or(`organization_id.is.null,organization_id.eq.${orgId}`)

    const { data: rows, error } = await query
    // Таблицы может не быть, пока не применена миграция: это не ошибка, просто
    // статистики ещё нет.
    if (error) return json({ ok: true, data: { available: false, groups: [] } })

    const questions = (rows || []) as Array<{
      id: string
      article_id: string
      question: string | null
      answer: string
      operator_id: string | null
      created_at: string
    }>

    if (questions.length === 0) {
      return json({ ok: true, data: { available: true, groups: [] } })
    }

    const articleIds = Array.from(new Set(questions.map((row) => String(row.article_id))))
    const { data: articles } = await supabase
      .from('knowledge_articles')
      .select('id, title, severity, company_id')
      .in('id', articleIds)
    const articleById = new Map(
      ((articles || []) as any[]).map((row) => [String(row.id), row]),
    )

    const operatorIds = Array.from(
      new Set(questions.map((row) => String(row.operator_id || '')).filter(Boolean)),
    )
    const { data: operators } = operatorIds.length
      ? await supabase.from('operators').select('id, name').in('id', operatorIds)
      : { data: [] as any[] }
    const operatorById = new Map(((operators || []) as any[]).map((row) => [String(row.id), row.name]))

    const grouped = new Map<
      string,
      {
        article_id: string
        title: string
        severity: string | null
        count: number
        operators: Set<string>
        last_at: string
        samples: Array<{ question: string; operator: string | null; created_at: string }>
      }
    >()

    for (const row of questions) {
      const key = String(row.article_id)
      const article = articleById.get(key)
      const entry = grouped.get(key) || {
        article_id: key,
        title: String(article?.title || 'Удалённое правило'),
        severity: (article?.severity as string | null) || null,
        count: 0,
        operators: new Set<string>(),
        last_at: row.created_at,
        samples: [] as Array<{ question: string; operator: string | null; created_at: string }>,
      }
      entry.count += 1
      if (row.operator_id) entry.operators.add(String(row.operator_id))
      if (row.created_at > entry.last_at) entry.last_at = row.created_at
      // Показываем живые формулировки: по ним видно, что именно непонятно.
      const text = String(row.question || '').trim()
      if (text && entry.samples.length < 5) {
        entry.samples.push({
          question: text,
          operator: operatorById.get(String(row.operator_id || '')) || null,
          created_at: row.created_at,
        })
      }
      grouped.set(key, entry)
    }

    const groups = Array.from(grouped.values())
      .map((entry) => ({
        article_id: entry.article_id,
        title: entry.title,
        severity: entry.severity,
        count: entry.count,
        operators: entry.operators.size,
        last_at: entry.last_at,
        samples: entry.samples,
      }))
      .sort((left, right) => right.count - left.count || right.last_at.localeCompare(left.last_at))

    return json({ ok: true, data: { available: true, total: questions.length, groups } })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
