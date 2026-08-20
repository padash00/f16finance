/**
 * Cron: напоминания по эффективности продавцов.
 *
 * Модуль не должен требовать, чтобы о нём помнили. Владелец заходит на
 * страницу, когда вспомнит, — а разбирать смены надо, пока люди помнят тот
 * вечер, и доплату надо начислять в конце месяца, а не когда-нибудь.
 *
 * Два письма, оба короткие:
 *
 *   Понедельник — что разобрать за прошедшую неделю. Только смены с пометкой
 *   «вопрос к продавцу»: покупатели были, отдача ниже. Остальное разбирать не
 *   нужно, и список из тридцати строк никто читать не станет.
 *
 *   Первое число — кому начислить доплату за прошлый месяц и сколько.
 *
 * Ничего не начисляет и ничего не решает: только напоминает и даёт ссылку.
 * Деньги двигает человек.
 *
 * Расписание — 04:00 UTC, то есть 09:00 по Казахстану.
 *
 * Запуск: GET /api/cron/sales-kpi-digest с Authorization: Bearer ${CRON_SECRET}
 */

import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe, describeError } from '@/lib/server/audit'
import { verifyCronRequest } from '@/lib/server/cron-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { sendTelegram } from '@/lib/server/telegram'
import { addDaysISO, todayISO } from '@/lib/server/store-kpi'
import { buildStoreKpiReport } from '@/lib/server/store-kpi-report'
import { monthlyBonus } from '@/lib/domain/store-kpi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function money(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₸`
}

const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]

/** Первое число прошлого месяца и его последний день. */
function previousMonth(today: string): { from: string; to: string; label: string } {
  const [year, month] = today.split('-').map(Number)
  const prev = new Date(year, (month || 1) - 2, 1)
  const y = prev.getFullYear()
  const m = prev.getMonth() + 1
  const last = new Date(y, m, 0).getDate()
  return {
    from: `${y}-${String(m).padStart(2, '0')}-01`,
    to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
    label: `${MONTHS[m - 1]} ${y}`,
  }
}

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) return json({ error: 'unauthorized' }, 401)
  if (!hasAdminSupabaseCredentials()) return json({ error: 'service_role_missing' }, 500)

  const supabase = createAdminSupabaseClient()
  const today = todayISO()
  const weekday = new Date(`${today}T00:00:00`).getDay()
  const dayOfMonth = Number(today.slice(8, 10))

  const isMonday = weekday === 1
  const isFirstOfMonth = dayOfMonth === 1
  if (!isMonday && !isFirstOfMonth) {
    return json({ ok: true, skipped: 'не понедельник и не первое число' })
  }

  const report: Record<string, unknown>[] = []

  try {
    // Точки с настроенным модулем: без настроек считать нечего.
    const { data: settingsRows, error } = await supabase
      .from('store_kpi_settings')
      .select('company_id, organization_id')
    if (error) throw error

    for (const row of settingsRows || []) {
      const companyId = String(row.company_id)
      const organizationId = row.organization_id ? String(row.organization_id) : null

      const { data: company } = await supabase
        .from('companies')
        .select('id, name')
        .eq('id', companyId)
        .maybeSingle()
      const pointName = company?.name || 'точка'

      try {
        // ── Понедельник: что разобрать ────────────────────────────────────
        if (isMonday) {
          const from = addDaysISO(today, -7)
          const to = addDaysISO(today, -1)
          const week = await buildStoreKpiReport(supabase, { companyId, organizationId, from, to })

          const toReview = week.shifts
            .filter((s: any) => s.verdict === 'POSSIBLE_CASHIER_ISSUE')
            // Смена, которой сами не доверяем, — плохой повод для разговора.
            .filter((s: any) => s.confidence >= 0.45)

          if (toReview.length > 0) {
            const lines = toReview
              .slice(0, 5)
              .map(
                (s: any) =>
                  `• ${s.date}, ${s.shift === 'night' ? 'ночь' : 'день'} — ${s.cashier_name || 'без продавца'}: ` +
                  `покупателей ${s.receipts}, касса ${money(s.revenue)}`,
              )
              .join('\n')

            const tail = toReview.length > 5 ? `\n…и ещё ${toReview.length - 5} на странице.` : ''

            await sendTelegram(
              `<b>${pointName}: что разобрать за неделю</b>\n\n` +
                `Смен с вопросом к продавцу: ${toReview.length}. Это смены, где покупатели были, ` +
                `а отдача с каждого ниже обычного.\n\n${lines}${tail}\n\n` +
                `Разбирать, а не наказывать: откройте «Эффективность продавцов» → «Почему такая касса».`,
            )
            report.push({ company: pointName, weekly: toReview.length })
          } else {
            report.push({ company: pointName, weekly: 0 })
          }
        }

        // ── Первое число: кому доплатить ──────────────────────────────────
        if (isFirstOfMonth) {
          const prev = previousMonth(today)
          const month = await buildStoreKpiReport(supabase, {
            companyId,
            organizationId,
            from: prev.from,
            to: prev.to,
          })

          const awards = month.cashiers
            .map((c: any) => ({ name: c.name, amount: monthlyBonus(c.status, month.settings).amount }))
            .filter((a) => a.amount > 0)

          if (awards.length > 0) {
            const total = awards.reduce((sum, a) => sum + a.amount, 0)
            const lines = awards.map((a) => `• ${a.name} — ${money(a.amount)}`).join('\n')

            await sendTelegram(
              `<b>${pointName}: доплата за ${prev.label}</b>\n\n` +
                `Посчитано ${awards.length} чел. на ${money(total)}:\n\n${lines}\n\n` +
                `Это доплата за работу с покупателем, не за оборот. Начисляет человек: ` +
                `«Эффективность продавцов» → «Кому доплатить».`,
            )
            report.push({ company: pointName, monthly: awards.length, total })
          } else {
            report.push({ company: pointName, monthly: 0 })
          }
        }
      } catch (companyError) {
        // Одна точка не должна ронять рассылку остальным.
        report.push({
          company: pointName,
          error: describeError(companyError),
        })
      }
    }

    return json({ ok: true, today, weekly: isMonday, monthly: isFirstOfMonth, report })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/cron/sales-kpi-digest',
      message: describeError(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}
