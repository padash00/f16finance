import { NextResponse } from 'next/server'

import { requireCapability } from '@/lib/server/capabilities'
import { buildPerformanceReport, type ReportOperator } from '@/lib/server/performance-report'
import { getRequestAccessContext } from '@/lib/server/request-auth'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Сборка отчёта по эффективности.
 *
 * Книгу строит сервер, а не браузер: exceljs тянет за собой node-окружение и в
 * бандле клиента молча падает — кнопка «Экспорт» просто ничего не делала.
 * Данные приходят уже посчитанные страницей, поэтому расчёт нормы здесь не
 * дублируется.
 */
export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'performance.export')
    if (denied) return denied

    const body = (await request.json().catch(() => null)) as {
      rows?: ReportOperator[]
      bonusPct?: number
      companies?: Record<string, string>
      period?: { from: string; to: string }
    } | null

    const rows = Array.isArray(body?.rows) ? body!.rows : []
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Нет данных за выбранный период' }, { status: 400 })
    }

    const period = body?.period || { from: '', to: '' }
    const buffer = await buildPerformanceReport({
      rows,
      bonusPct: Number(body?.bonusPct || 0),
      companies: body?.companies || {},
      period,
    })

    const fileName = `Эффективность ${period.from} — ${period.to}.xlsx`
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        // filename* — иначе кириллица в имени превращается в кракозябры.
        'Content-Disposition': `attachment; filename="performance.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось собрать отчёт' }, { status: 500 })
  }
}
