/**
 * Cron: регулярный экзамен по расписанию точки.
 *
 * Экзамен, который нужно назначать руками, назначается редко. Регулярная
 * проверка знаний работает только тогда, когда случается сама.
 *
 * Что делает: в назначенный день недели собирает по каждой активной точке
 * билет из трёх частей — регламент точки, данные точки (каталог, тарифы,
 * железо — по нише) и ситуационные вопросы, — и кладёт ЧЕРНОВИКОМ. Владельцу
 * уходит «билет готов, проверьте и разошлите».
 *
 * Почему черновик, а не рассылка. Вопросы пишет модель. Кривой вопрос дешевле
 * выкинуть до отправки, чем объясняться перед семью людьми, которым он уже
 * ушёл. Тот же принцип, что у аттестации новичков.
 *
 * Расписание — 15:00 UTC, то есть 20:00 по Казахстану: черновик готов к вечеру
 * накануне рабочей недели.
 *
 * Запуск: GET /api/cron/operator-exam-weekly с Authorization: Bearer ${CRON_SECRET}
 */

import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { verifyCronRequest } from '@/lib/server/cron-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import {
  composeExamPool,
  factTopicsForIndustry,
  operatorsOfCompanies,
} from '@/lib/server/operator-exam-compose'
import { sendTelegram } from '@/lib/server/telegram'
import { buildStoreKpiReport } from '@/lib/server/store-kpi-report'
import type { FactTopic } from '@/lib/server/exam-facts'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** Сегодня по Казахстану: крон ходит по UTC, а расписание — рабочее. */
function todayLocal(): { iso: string; weekday: number } {
  const now = new Date()
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Almaty' }))
  const iso = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
  // getDay: 0 — воскресенье. В расписании 1 — понедельник, 7 — воскресенье.
  const weekday = local.getDay() === 0 ? 7 : local.getDay()
  return { iso, weekday }
}

function addDaysISO(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

const METRIC_RU: Record<string, string> = {
  avg_ticket: 'средний чек',
  items_per_receipt: 'сколько товаров берут в один чек',
  attach_rate: 'допродажи — что предлагать к основному товару',
  revenue_efficiency: 'отдача с покупателя',
  plan_attainment: 'выполнение плана смены',
  product_knowledge: 'знание товара',
}

/**
 * Слабые места точки за последний месяц.
 *
 * Берутся из модуля эффективности: метрики, где продавцы устойчиво ниже нормы.
 * Это и есть обратная связь между модулями — экзамен спрашивает про то, что
 * проседает, а не про то, что и так знают.
 *
 * Мягко: у точки может не быть магазина или данных, и еженедельный экзамен от
 * этого срываться не должен.
 */
async function weakSpots(
  supabase: any,
  companyId: string,
  organizationId: string,
  today: string,
): Promise<string[]> {
  try {
    const from = addDaysISO(today, -30).slice(0, 10)
    const report = await buildStoreKpiReport(supabase, {
      companyId,
      organizationId,
      from,
      to: today,
    })

    const counts = new Map<string, number>()
    for (const cashier of report.cashiers as any[]) {
      for (const metric of cashier.weaknesses || []) {
        counts.set(metric, (counts.get(metric) || 0) + 1)
      }
    }

    // Слабое место точки, а не одного человека: билет общий, и подстраивать
    // его под одного было бы несправедливо к остальным.
    const threshold = Math.max(2, Math.ceil((report.cashiers.length || 1) / 2))
    return [...counts.entries()]
      .filter(([, n]) => n >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([metric]) => METRIC_RU[metric] || metric)
  } catch {
    return []
  }
}

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) return json({ error: 'unauthorized' }, 401)
  if (!hasAdminSupabaseCredentials()) return json({ error: 'service_role_missing' }, 500)

  const supabase = createAdminSupabaseClient()
  const { iso: today, weekday } = todayLocal()
  const report: Record<string, unknown>[] = []

  try {
    const { data: schedules, error } = await supabase
      .from('operator_exam_schedules')
      .select('*')
      .eq('is_active', true)
      .eq('weekday', weekday)
    if (error) throw error

    for (const schedule of schedules || []) {
      const companyId = String(schedule.company_id)

      // Защита от повторного прогона: крон может сработать дважды за сутки.
      if (schedule.last_run_on === today) {
        report.push({ company_id: companyId, skipped: 'уже собирали сегодня' })
        continue
      }

      try {
        const { data: company } = await supabase
          .from('companies')
          .select('id, name, industry, organization_id')
          .eq('id', companyId)
          .maybeSingle()
        if (!company?.organization_id) {
          report.push({ company_id: companyId, skipped: 'нет организации' })
          continue
        }

        const pointName = String(company.name || 'точка')
        const organizationId = String(company.organization_id)

        const operatorIds = await operatorsOfCompanies(supabase, [companyId])
        if (operatorIds.length === 0) {
          report.push({ company: pointName, skipped: 'на точке нет операторов' })
          continue
        }

        // Темы по данным: заданные в расписании, иначе — типовые для ниши.
        const configured = ((schedule.fact_topics || []) as string[]).filter((t): t is FactTopic =>
          ['catalog', 'tariffs', 'hardware', 'stations', 'warehouse'].includes(t),
        )
        const factTopics = configured.length > 0 ? configured : factTopicsForIndustry(company.industry)

        // Чего людям на этой точке не хватало последний месяц. Экзамен должен
        // проверять именно это, иначе он живёт отдельно от работы.
        const focus = await weakSpots(supabase, companyId, organizationId, today)

        const composed = await composeExamPool({
          supabase,
          organizationId,
          companyIds: [companyId],
          questionCount: Number(schedule.question_count) || 10,
          openCount: Number(schedule.open_count) || 0,
          factTopics,
          focus,
        })

        if (!composed.ok) {
          report.push({ company: pointName, error: composed.error })
          // Владельцу лучше узнать, что билет не собрался, чем не узнать
          // ничего: молчащий крон выглядит как работающий.
          await sendTelegram(
            `<b>${pointName}: билет на неделю не собрался</b>\n\n${composed.error}\n\n` +
              `Проверьте регламенты точки и каталог.`,
          )
          continue
        }

        const title = `${schedule.title || 'Еженедельная проверка'} · ${today}`
        const deadlineDays = Number(schedule.deadline_days) || 4

        const { data: exam, error: examError } = await supabase
          .from('operator_exams')
          .insert([
            {
              organization_id: organizationId,
              title,
              company_ids: [companyId],
              operator_ids: operatorIds,
              question_count: composed.questionCount,
              open_count: composed.openCount,
              pass_score: Number(schedule.pass_score) || 70,
              deadline_at: addDaysISO(today, deadlineDays),
              topics: factTopics,
              status: 'draft',
              question_pool: composed.pool,
              open_pool: composed.openPool,
            },
          ])
          .select('id')
          .single()
        if (examError) throw examError

        await supabase
          .from('operator_exam_schedules')
          .update({ last_run_on: today, updated_at: new Date().toISOString() })
          .eq('id', schedule.id)

        await writeAuditLog(supabase as any, {
          actorUserId: null,
          action: 'operator_exam.scheduled_draft',
          entityType: 'operator_exam',
          entityId: String((exam as any).id),
          organizationId,
          payload: {
            company_id: companyId,
            operators: operatorIds.length,
            questions: composed.pool.length,
            open: composed.openPool.length,
            topics: factTopics,
          },
        })

        await sendTelegram(
          `<b>${pointName}: билет на неделю готов</b>\n\n` +
            `Вопросов: ${composed.pool.length}, ситуационных: ${composed.openPool.length}. ` +
            `Получателей: ${operatorIds.length}.\n\n` +
            `Это черновик — вопросы писала модель. Прочитайте, выкиньте неудачные и разошлите: ` +
            `«Регламенты» → «Экзамены».`,
        )

        report.push({
          company: pointName,
          exam_id: String((exam as any).id),
          questions: composed.pool.length,
          open: composed.openPool.length,
          operators: operatorIds.length,
        })
      } catch (companyError) {
        // Одна точка не должна ронять обход остальных.
        report.push({
          company_id: companyId,
          error: companyError instanceof Error ? companyError.message : String(companyError),
        })
      }
    }

    return json({ ok: true, today, weekday, schedules: (schedules || []).length, report })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/cron/operator-exam-weekly',
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}
