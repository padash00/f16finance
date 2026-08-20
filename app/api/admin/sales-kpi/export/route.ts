/**
 * Выгрузка разбора смен: PDF и Excel.
 *
 * Оба формата собираются на сервере из одного расчёта
 * (`buildStoreKpiReport`), того же самого, что рисует страницу. Отчёт,
 * расходящийся с экраном, хуже отсутствия отчёта: верить нельзя ни ему, ни
 * экрану.
 *
 * Право то же, что на просмотр страницы: выгрузка не показывает ничего
 * сверх того, что человек и так видит.
 */

import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe, describeError } from '@/lib/server/audit'
import { buildShiftReportContract } from '@/lib/reports/build-shift-report-contract'
import {
  barChartSvg,
  chartsPageHtml,
  lineChartSvg,
  CHART_SIZE,
} from '@/lib/reports/shift-report-charts'
import { mapReportToPdfDto } from '@/lib/reports/shift-efficiency-pdf-adapter'
import { buildShiftEfficiencyPdf } from '@/lib/server/shift-efficiency-pdf'
import { buildSalesKpiWorkbook } from '@/lib/server/sales-kpi-xlsx'
import { buildStoreKpiReport, coverageWarnings } from '@/lib/server/store-kpi-report'
import { inScope, listStorePoints, resolveStoreKpiContext } from '@/lib/server/store-kpi'
import { requireStaffCapability } from '@/lib/server/capabilities'

export const runtime = 'nodejs'
export const maxDuration = 120
export const dynamic = 'force-dynamic'

const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.x64.tar'

/** Родительный падеж — для дат («1 августа»). */
const MONTHS_OF = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

/** Именительный — для заголовка периода («Август 2026»). */
const MONTHS_NAME = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** «1 августа 2026». Для заголовка отчёта ISO-даты не годятся. */
function humanDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return `${day} ${MONTHS_OF[(month || 1) - 1]} ${year}`
}

/**
 * Заголовок периода.
 *
 * Целый месяц называется месяцем — так владелец о нём и думает. Произвольный
 * отрезок пишется датами, иначе «Август» соврал бы про 17.07–16.08.
 */
function periodLabel(from: string, to: string): string {
  const [year, month] = from.split('-').map(Number)
  const lastDay = new Date(year || 1970, month || 1, 0).getDate()
  const wholeMonth =
    from.slice(0, 7) === to.slice(0, 7) &&
    Number(from.slice(8, 10)) === 1 &&
    Number(to.slice(8, 10)) >= lastDay

  if (wholeMonth) return `${MONTHS_NAME[(month || 1) - 1]} ${year}`
  return `${humanDate(from)} — ${humanDate(to)}`
}

/** Имя файла: кириллица в заголовке допустима, но не всё в ней безопасно. */
function safeName(base: string): string {
  return base.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 70)
}

export async function POST(request: Request) {
  // Браузер нужен только Excel — для съёмки графиков. PDF поднимает свой.
  let browser: Awaited<ReturnType<typeof import('puppeteer-core').default.launch>> | null = null

  try {
    // Просмотр и выгрузка — разные вещи, и в каталоге они разведены. Отчёт
    // уносит из системы пофамильные суммы за период: кто сколько заработал,
    // кому какая доплата. Смотреть их на экране и уносить файлом наружу —
    // решения разного веса, и второе владелец вправе выдать не всем.
    const ctx = await resolveStoreKpiContext(request, 'sales-kpi.view', json)
    if ('response' in ctx) return ctx.response
    const { supabase, scope, access } = ctx

    const exportDenied = await requireStaffCapability(access, 'sales-kpi.export')
    if (exportDenied) return exportDenied

    const body = (await request.json().catch(() => ({}))) as Record<string, any>
    const companyId = String(body.company_id || '')
    const from = String(body.from || '').slice(0, 10)
    const to = String(body.to || '').slice(0, 10)
    const format = body.format === 'xlsx' ? 'xlsx' : 'pdf'

    if (!companyId) return json({ error: 'company-required' }, 400)
    if (!from || !to) return json({ error: 'period-required' }, 400)
    if (to < from) return json({ error: 'period-invalid' }, 400)
    if (!inScope(scope, companyId)) return json({ error: 'forbidden', code: 'company-out-of-scope' }, 403)

    const stores = await listStorePoints(supabase, scope)
    const company = stores.find((s) => s.id === companyId)
    if (!company) return json({ error: 'company-not-found' }, 404)

    const report = await buildStoreKpiReport(supabase, {
      companyId,
      organizationId: company.organization_id ?? null,
      from,
      to,
    })

    const contract = buildShiftReportContract({
      companyName: company.name,
      period: { from, to },
      periodLabel: periodLabel(from, to),
      generated: new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' }),
      shifts: report.shifts as any,
      cashiers: report.cashiers as any,
      warnings: coverageWarnings(report.coverage),
      minSampleSize: report.settings.min_sample_size,
    })

    const filename = safeName(`Razbor_smen_${company.name}_${from}_${to}`)

    // ── PDF ────────────────────────────────────────────────────────────────
    // Отдельный документ со смешанной ориентацией: сводка и продавцы —
    // альбомные, страницы смен — книжные, их читают с телефона.
    if (format === 'pdf') {
      const dto = mapReportToPdfDto({
        report,
        point: { id: companyId, name: company.name },
        monthLabel: periodLabel(from, to),
        generatedAt: new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' }),
      })

      const pdf = await buildShiftEfficiencyPdf(dto)

      await writeAuditLog(supabase, {
        actorUserId: access.user?.id || null,
        entityType: 'store_kpi_report',
        entityId: companyId,
        action: 'export',
        organizationId: company.organization_id ?? null,
        payload: { company_id: companyId, from, to, format: 'pdf', shifts: report.shifts.length },
      })

      return new NextResponse(pdf as any, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(`${filename}.pdf`)}"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    // ── Excel ──────────────────────────────────────────────────────────────
    // Графики рисуются в SVG и снимаются в PNG: ExcelJS не умеет создавать
    // нативные диаграммы Excel. Полоски внутри ячеек при этом настоящие —
    // это условное форматирование, оно живое.
    const byDate = new Map<string, { actual: number; expected: number | null; receipts: number; expectedReceipts: number | null }>()
    for (const s of report.shifts) {
      const cur = byDate.get(s.date) || { actual: 0, expected: null, receipts: 0, expectedReceipts: null }
      cur.actual += s.revenue
      cur.receipts += s.receipts
      if (s.expected_revenue != null) cur.expected = (cur.expected ?? 0) + s.expected_revenue
      if (s.expected_receipts != null) cur.expectedReceipts = (cur.expectedReceipts ?? 0) + s.expected_receipts
      byDate.set(s.date, cur)
    }
    const dates = [...byDate.keys()].sort()

    const charts = [
      lineChartSvg({
        title: 'Касса по дням: было и обычно бывает',
        subtitle: periodLabel(from, to),
        actualLabel: 'было',
        expectedLabel: 'обычно бывает',
        points: dates.map((d) => ({
          label: d.slice(5),
          actual: byDate.get(d)!.actual,
          expected: byDate.get(d)!.expected,
        })),
      }),
      lineChartSvg({
        title: 'Покупателей по дням: было и обычно бывает',
        subtitle: 'число чеков — это мера спроса, а не работы',
        actualLabel: 'было',
        expectedLabel: 'обычно бывает',
        points: dates.map((d) => ({
          label: d.slice(5),
          actual: byDate.get(d)!.receipts,
          expected: byDate.get(d)!.expectedReceipts,
        })),
      }),
      barChartSvg({
        title: 'Продавцы: отклонение от нормы, %',
        subtitle: 'насколько человек сработал выше или ниже обычного для таких смен',
        unit: '%',
        bars: report.cashiers
          .filter((c) => c.score != null)
          .map((c) => {
            const delta = Math.round(((c.score as number) - 1) * 100)
            return {
              label: c.name,
              value: delta,
              tone: delta >= 5 ? ('good' as const) : delta <= -5 ? ('warn' as const) : ('mut' as const),
            }
          }),
      }),
      barChartSvg({
        title: 'Из чего состоял период',
        subtitle: 'сколько смен какого вывода',
        bars: [
          { label: 'Сильная смена', value: report.totals.strong, tone: 'good' },
          { label: 'Вытянул поток', value: report.totals.high_demand },
          { label: 'Мало покупателей', value: report.totals.low_demand },
          { label: 'Вопрос к продавцу', value: report.totals.cashier_issue, tone: 'warn' },
          { label: 'Мало данных', value: report.totals.insufficient },
        ],
      }),
    ]

    const [{ default: puppeteer }, { default: chromium }] = await Promise.all([
      import('puppeteer-core'),
      import('@sparticuz/chromium-min'),
    ])
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
      headless: true,
    })
    const page = await browser.newPage()
    await page.setViewport({ width: CHART_SIZE.width, height: CHART_SIZE.height * charts.length })
    await page.setContent(chartsPageHtml(charts), { waitUntil: 'load', timeout: 45_000 })

    const titles = [
      'Касса по дням: было и обычно бывает',
      'Покупателей по дням',
      'Продавцы: отклонение от нормы',
      'Из чего состоял период',
    ]
    const images: { title: string; png: Buffer }[] = []
    const nodes = await page.$$('.c')
    for (let i = 0; i < nodes.length; i++) {
      const shot = (await nodes[i].screenshot({ type: 'png' })) as Buffer
      images.push({ title: titles[i] || `График ${i + 1}`, png: Buffer.from(shot) })
    }

    const xlsx = await buildSalesKpiWorkbook(contract, images)

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'store_kpi_report',
      entityId: companyId,
      action: 'export',
      organizationId: company.organization_id ?? null,
      payload: { company_id: companyId, from, to, format: 'xlsx', shifts: report.shifts.length },
    })

    return new NextResponse(xlsx as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(`${filename}.xlsx`)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/sales-kpi/export',
      message: describeError(error),
    })
    console.error('[sales-kpi/export]', error)
    return json({ error: 'export-failed', detail: error instanceof Error ? error.message : null }, 500)
  } finally {
    try {
      await browser?.close()
    } catch {
      /* закрытие браузера не должно рушить ответ */
    }
  }
}
