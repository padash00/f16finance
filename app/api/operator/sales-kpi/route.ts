/**
 * Личный экран продавца: как он работал в этом месяце.
 *
 * Показывается в кабинете оператора — человек видит только себя. Ни чужих
 * баллов, ни рейтинга команды: сравнение людей между собой это инструмент
 * управляющего, а не повод для соревнования у кассы.
 *
 * Что здесь есть и чего нет. Есть доплата за качество — те деньги, которые
 * начисляет именно этот модуль, и метрики, из которых она складывается. Нет
 * бонусных порогов B1/B2/B3: за оборот платят правила зарплаты со своими
 * цифрами, и показывать рядом вторую линейку порогов значило бы путать
 * человека насчёт того, за что ему платят.
 */
import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe, describeError } from '@/lib/server/audit'
import { getRequestOperatorContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { earliestSaleDate, loadShiftFacts, loadStoreKpiSettings, todayISO } from '@/lib/server/store-kpi'
import { analyzeStoreKpi, METRIC_LABELS, monthlyBonus } from '@/lib/domain/store-kpi'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

const STATUS_TEXT: Record<string, { label: string; meaning: string }> = {
  TOP: { label: 'Топ', meaning: 'Работа с покупателями заметно выше нормы.' },
  STRONG: { label: 'Сильный', meaning: 'Стабильно выше нормы по нескольким показателям.' },
  NORMAL: { label: 'Норма', meaning: 'Всё в пределах обычного для таких смен.' },
  NEEDS_TRAINING: {
    label: 'Есть над чем поработать',
    meaning: 'Несколько смен подряд показатели ниже обычного — стоит разобрать вместе с управляющим.',
  },
  INSUFFICIENT_DATA: {
    label: 'Мало смен',
    meaning: 'Пока смен слишком мало, чтобы делать выводы. Оценка появится, когда их станет больше.',
  },
}

export async function GET(request: Request) {
  try {
    const context = await getRequestOperatorContext(request)
    if ('response' in context) return context.response

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : (context.supabase as any)

    const operatorId = String(context.operator.id)
    const today = todayISO()
    const url = new URL(request.url)
    const month = url.searchParams.get('month') || today.slice(0, 7)

    const [y, m] = month.split('-').map(Number)
    const from = `${month}-01`
    const to = `${month}-${String(new Date(y || 1970, m || 1, 0).getDate()).padStart(2, '0')}`

    // Точка-магазин, где этот оператор вообще продавал в этом месяце.
    const { data: saleRow } = await supabase
      .from('point_sales')
      .select('company_id')
      .eq('operator_id', operatorId)
      .gte('sale_date', from)
      .lte('sale_date', to)
      .limit(1)
      .maybeSingle()

    const companyId = saleRow?.company_id ? String(saleRow.company_id) : null
    if (!companyId) {
      return json({ data: { available: false, reason: 'no-sales', month } })
    }

    const { settings } = await loadStoreKpiSettings(supabase, companyId)
    const historyFrom = (await earliestSaleDate(supabase, companyId)) ?? from
    const facts = await loadShiftFacts(supabase, { companyId, from: historyFrom, to })

    const result = analyzeStoreKpi({
      baselineFacts: facts.filter((f) => f.date < from),
      targetFacts: facts.filter((f) => f.date >= from && f.date <= to),
      settings,
    })

    const mine = result.cashiers.find((c) => c.cashier_id === operatorId)
    if (!mine) return json({ data: { available: false, reason: 'no-shifts', month } })

    const bonus = monthlyBonus(mine.status, settings)

    const { data: award } = await supabase
      .from('store_kpi_bonus_awards')
      .select('amount, salary_adjustment_id, voided_at')
      .eq('company_id', companyId)
      .eq('cashier_id', operatorId)
      .eq('kind', 'monthly')
      .eq('period_start', from)
      .maybeSingle()

    const paid = Boolean(award && award.salary_adjustment_id && !award.voided_at)
    const status = STATUS_TEXT[mine.status] || STATUS_TEXT.NORMAL

    /**
     * Последний экзамен продавца.
     *
     * Показывать его человеку обязательно. Экзамен, результат которого не
     * возвращают, за месяц превращается в формальность: люди перестают
     * понимать, зачем они его пишут, и начинают отвечать наугад.
     *
     * Мягко: экзаменов в организации может не быть вовсе, и экран кассира от
     * этого падать не должен.
     */
    const { data: examRows } = await supabase
      .from('operator_exam_attempts')
      .select('score, passed, completed_at, exam:exam_id(title)')
      .eq('operator_id', operatorId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .then((r: any) => r, () => ({ data: null }))

    const lastExam = (examRows || [])[0] as any
    const exam = lastExam
      ? {
          title: String(lastExam.exam?.title || 'Проверка знаний'),
          score: Number(lastExam.score) || 0,
          passed: Boolean(lastExam.passed),
          on: String(lastExam.completed_at || '').slice(0, 10),
        }
      : null

    return json({
      data: {
        available: true,
        month,
        shifts: mine.shifts,
        receipts: mine.receipts,
        status: mine.status,
        status_label: status.label,
        status_meaning: status.meaning,
        // Сильные и слабые стороны словами: человеку нужен предмет разговора,
        // а не число с двумя знаками после запятой.
        strengths: mine.strengths.map((k) => METRIC_LABELS[k]),
        weaknesses: mine.weaknesses.map((k) => METRIC_LABELS[k]),
        bonus: {
          amount: bonus.amount,
          paid,
          // Что нужно, чтобы доплата появилась.
          next_step:
            mine.status === 'INSUFFICIENT_DATA'
              ? `Доплата считается от ${settings.min_qualifying_shifts} смен за месяц.`
              : bonus.amount > 0
                ? null
                : 'Доплата начинается со статуса «Сильный»: средний чек, допродажи и товары в чеке выше обычного.',
          strong: settings.monthly_bonus_strong,
          top: settings.monthly_bonus_top,
        },
        exam: exam
          ? {
              ...exam,
              // Ворота на верхний уровень: без сданного теста он не берётся.
              // Про это человек должен знать заранее, а не узнавать по факту.
              gates_top_bonus: settings.require_product_test_for_top_bonus,
            }
          : null,
      },
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/operator/sales-kpi GET',
      message: describeError(error),
    })
    console.error('[operator/sales-kpi]', error)
    return json({ error: 'internal-error' }, 500)
  }
}
