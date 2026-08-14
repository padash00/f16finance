import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { pushToOperators } from '@/lib/server/push'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'

/**
 * Напоминание о непрочитанных обязательных правилах.
 *
 * Флаг «требует подтверждения» ставят ради спорной ситуации: сотрудник не может
 * сказать «не знал». Но пока его никто не подталкивает, подтверждение висит
 * месяцами — и в момент разбора оказывается, что правило формально не прочитано
 * ни одним человеком.
 *
 * Раз в сутки. Одному человеку — не чаще раза в три дня, иначе напоминание
 * превращается в фон, который перестают читать.
 *
 *   GET /api/cron/knowledge-confirmations
 */

export const runtime = 'nodejs'

const REMIND_EVERY_DAYS = 3

function plural(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'правило'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'правила'
  return 'правил'
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  if (auth !== `Bearer ${requiredEnv('CRON_SECRET')}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminSupabaseClient()
    const now = new Date()

    // Что вообще требует подтверждения.
    const { data: articles, error: articlesError } = await supabase
      .from('knowledge_articles')
      .select('id, title, version, organization_id, company_id')
      .eq('requires_confirmation', true)
      .eq('is_published', true)
      .limit(500)
    if (articlesError) throw articlesError
    if (!articles?.length) return NextResponse.json({ ok: true, sent: 0, reason: 'no-articles' })

    // Кто уже подтвердил — сверяем по текущей версии: правку текста триггер
    // повышает версией, и старое подтверждение перестаёт закрывать правило.
    const articleIds = articles.map((row: any) => String(row.id))
    const { data: confirmations, error: confirmError } = await supabase
      .from('knowledge_article_confirmations')
      .select('article_id, article_version, staff_id')
      .in('article_id', articleIds)
      .limit(5000)
    if (confirmError) throw confirmError

    const versionById = new Map(articles.map((row: any) => [String(row.id), Number(row.version || 1)]))
    const confirmed = new Set(
      (confirmations || [])
        .filter((row: any) => Number(row.article_version) === versionById.get(String(row.article_id)))
        .map((row: any) => `${row.article_id}:${row.staff_id}`),
    )

    // Кому напоминать: активные операторы, связанные со staff-записью.
    const { data: links, error: linksError } = await supabase
      .from('operator_staff_links')
      .select('operator_id, staff_id')
      .limit(2000)
    if (linksError) throw linksError

    const operatorIds = Array.from(new Set((links || []).map((row: any) => String(row.operator_id))))
    if (operatorIds.length === 0) return NextResponse.json({ ok: true, sent: 0, reason: 'no-operators' })

    const { data: operators, error: operatorsError } = await supabase
      .from('operators')
      .select('id, name, telegram_chat_id, is_active, dismissed_at, knowledge_reminded_at')
      .in('id', operatorIds)
    if (operatorsError) throw operatorsError

    const { data: assignments } = await supabase
      .from('operator_company_assignments')
      .select('operator_id, company_id, is_active')
      .in('operator_id', operatorIds)
      .eq('is_active', true)

    const companiesByOperator = new Map<string, Set<string>>()
    for (const row of (assignments || []) as any[]) {
      const key = String(row.operator_id)
      const set = companiesByOperator.get(key) || new Set<string>()
      set.add(String(row.company_id))
      companiesByOperator.set(key, set)
    }

    const staffByOperator = new Map((links || []).map((row: any) => [String(row.operator_id), String(row.staff_id)]))

    let sent = 0
    const remindedOperators: string[] = []

    for (const operator of (operators || []) as any[]) {
      if (operator.is_active === false || operator.dismissed_at) continue

      // Не чаще раза в три дня на человека.
      const lastRemind = operator.knowledge_reminded_at ? new Date(String(operator.knowledge_reminded_at)) : null
      if (lastRemind && now.getTime() - lastRemind.getTime() < REMIND_EVERY_DAYS * 24 * 3600_000) continue

      const staffId = staffByOperator.get(String(operator.id))
      if (!staffId) continue

      const operatorCompanies = companiesByOperator.get(String(operator.id)) || new Set<string>()
      // Правило точки касается только её операторов; общее — всех.
      const pending = articles.filter((article: any) => {
        if (article.company_id && !operatorCompanies.has(String(article.company_id))) return false
        return !confirmed.has(`${article.id}:${staffId}`)
      })
      if (pending.length === 0) continue

      const titles = pending.slice(0, 3).map((article: any) => `• ${article.title}`)
      const tail = pending.length > 3 ? `\n…и ещё ${pending.length - 3}` : ''

      await pushToOperators(supabase, [String(operator.id)], {
        title: 'Правила ждут подтверждения',
        body: `${pending.length} ${plural(pending.length)} нужно прочитать и подтвердить. «Профиль» → «Правила и FAQ».`,
        data: { kind: 'knowledge-confirmations' },
      })

      if (operator.telegram_chat_id) {
        await sendTelegramMessage(
          String(operator.telegram_chat_id),
          [
            '📋 <b>Правила ждут подтверждения</b>',
            '',
            `Не подтверждено: ${pending.length} ${plural(pending.length)}`,
            escapeTelegramHtml(titles.join('\n') + tail),
            '',
            'Открой «Профиль» → «Правила и FAQ» на кассе или в приложении.',
          ].join('\n'),
        ).catch(() => null)
      }

      remindedOperators.push(String(operator.id))
      sent += 1
    }

    if (remindedOperators.length > 0) {
      // Колонка может отсутствовать (миграция не применена) — тогда напоминания
      // всё равно уходят, просто без ограничения частоты.
      await supabase
        .from('operators')
        .update({ knowledge_reminded_at: now.toISOString() })
        .in('id', remindedOperators)
        .then(() => null, () => null)
    }

    return NextResponse.json({ ok: true, sent })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'cron/knowledge-confirmations',
      message: error?.message || 'error',
    })
    return NextResponse.json({ ok: false, error: 'knowledge-confirmations-failed' }, { status: 500 })
  }
}
