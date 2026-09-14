/**
 * Cron: предупреждение владельцу, что месяц отстаёт от плана (/goals).
 *
 * Запускается каждый день в 05:00 UTC (10:00 по Казахстану), но пишет только
 * 10-го и 20-го числа — чтобы это было предупреждение, а не ежедневный шум
 * (см. lib/core/audit-telegram.ts: в Telegram — только то, что требует реакции).
 *
 * Условие: у организации есть общий план выручки на месяц и месяц отстаёт —
 * прогноз из /analysis не дотягивает до плана, а если прогноза нет — факт
 * заметно ниже того, что должно быть к этому дню по ритму недели.
 *
 * Повторный ручной запуск в тот же день отправит сообщение ещё раз.
 * ?force=1 — отправить в любой день (для проверки, тоже только с CRON_SECRET).
 */

import { NextResponse } from 'next/server'

import { forecastForScope } from '@/lib/analysis/forecast-scope'
import { goalPace, goalVerdict, shiftDate, weekdayWeights } from '@/lib/analysis/goal-pace'
import { isExtraCompany } from '@/lib/reports/extra-company'
import { describeError, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { verifyCronRequest } from '@/lib/server/cron-auth'
import { kzTodayISO, loadForecastInputs } from '@/lib/server/forecast-inputs'
import { listReportTargets } from '@/lib/server/report-targets'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { sendTelegramMessage } from '@/lib/telegram/send'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALERT_DAYS = [10, 20]
/** Без прогноза: отставание от ритма больше этой доли плана — повод написать */
const GAP_SHARE = 0.03
const MONTH_GEN = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']

const money = (v: number) => `${Math.round(v).toLocaleString('ru-RU')} ₸`

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!hasAdminSupabaseCredentials()) return NextResponse.json({ error: 'service_role_missing' }, { status: 500 })

  const force = new URL(request.url).searchParams.get('force') === '1'
  const today = kzTodayISO()
  const day = Number(today.slice(8, 10))
  if (!force && !ALERT_DAYS.includes(day)) return NextResponse.json({ ok: true, skipped: 'not an alert day', date: today })

  const supabase = createAdminSupabaseClient()
  const month = today.slice(0, 7)
  const monthStart = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
  const yesterday = shiftDate(today, -1)
  const report: Record<string, unknown>[] = []

  try {
    const targets = (await listReportTargets()).filter((t) => t.organizationId && t.companyIds && t.companyIds.length)
    for (const target of targets) {
      const organizationId = target.organizationId!
      try {
        const { data: plan, error: planError } = await supabase
          .from('kpi_plans')
          .select('target_amount')
          .is('company_id', null)
          .eq('organization_id', organizationId)
          .eq('kind', 'month.revenue')
          .eq('period_start', monthStart)
          .maybeSingle()
        if (planError) throw planError
        const planAmount = Number((plan as any)?.target_amount || 0)
        if (!(planAmount > 0)) {
          report.push({ organizationId, skipped: 'no org revenue plan' })
          continue
        }

        const { data: companyRows } = await supabase.from('companies').select('id, name, code').eq('organization_id', organizationId)
        const networkIds = ((companyRows || []) as Array<{ id: string; name: string | null; code: string | null }>)
          .filter((c) => !isExtraCompany(c))
          .map((c) => String(c.id))
        if (!networkIds.length) continue

        const inputs = await loadForecastInputs(supabase, { companyIds: networkIds, organizationId, isSuperAdmin: false, to: today })
        const revenueOf = (r: { cash: number; kaspi: number; card?: number; online?: number }) => r.cash + r.kaspi + (r.card || 0) + (r.online || 0)
        const fact = inputs.incomes.filter((r) => r.date >= monthStart && r.date <= yesterday).reduce((s, r) => s + revenueOf(r as any), 0)

        const byDay = new Map<string, number>()
        const rhythmFrom = shiftDate(yesterday, -55)
        for (const r of inputs.incomes) {
          if (r.date < rhythmFrom || r.date > yesterday) continue
          byDay.set(r.date, (byDay.get(r.date) || 0) + revenueOf(r as any))
        }
        const weights = weekdayWeights(Array.from(byDay.entries()).map(([date, value]) => ({ date, value })))
        const pace = goalPace({ target: planAmount, fact, start: monthStart, end: monthEnd, lastFactDate: yesterday, weights })
        if (!pace) continue

        const outlook = forecastForScope({ ...inputs, today, companyId: null }).outlook
        const verdict = goalVerdict(
          planAmount,
          fact,
          outlook ? { pessimistic: outlook.outlook.pessimistic.income, realistic: outlook.outlook.realistic.income, optimistic: outlook.outlook.optimistic.income } : null,
        )

        const behind = verdict
          ? verdict.status === 'at_risk' || verdict.status === 'unlikely'
          : pace.gap < -GAP_SHARE * planAmount
        if (!behind) {
          report.push({ organizationId, sent: false, status: verdict?.status || 'on_pace' })
          continue
        }

        const lines = [
          `🎯 <b>План на ${MONTH_GEN[m - 1]}: ${verdict?.status === 'unlikely' ? 'не успеваем' : 'под угрозой'}</b>`,
          '',
          `Выполнено <b>${Math.round(pace.doneShare * 100)}%</b> плана, а по обычному ритму к этому дню должно быть ${Math.round(pace.timeShare * 100)}%.`,
          `Факт: ${money(fact)} из ${money(planAmount)}${pace.gap < 0 ? ` — отставание ${money(-pace.gap)}` : ''}.`,
          pace.daysLeft > 0 ? `Чтобы успеть: <b>${money(pace.requiredPerDay)} в день</b> — сейчас в среднем ${money(pace.currentPerDay)}.` : '',
          verdict && outlook ? `Прогноз к концу месяца: ${money(outlook.outlook.realistic.income)} — не хватит около ${money(Math.max(0, verdict.shortfall))}.` : '',
          '',
          'Подробнее — раздел «Цели и план».',
        ].filter((line, i, arr) => line !== '' || (i > 0 && arr[i - 1] !== ''))

        const sent = await sendTelegramMessage(target.chatId, lines.join('\n'), { parseMode: 'HTML' })
        report.push({ organizationId, sent: sent.ok, status: verdict?.status || 'behind_pace', error: sent.error })
      } catch (orgError) {
        await writeSystemErrorLogSafe({ scope: 'server', area: 'cron/goal-pace-alert organization', message: `${organizationId}: ${describeError(orgError)}` })
        report.push({ organizationId, error: true })
      }
    }
    return NextResponse.json({ ok: true, date: today, report })
  } catch (error) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'cron/goal-pace-alert', message: describeError(error) })
    return NextResponse.json({ error: 'internal-error' }, { status: 500 })
  }
}
