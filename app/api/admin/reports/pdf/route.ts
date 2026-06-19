import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { renderFinReportHTML, PDF_OPTIONS as FIN_OPTIONS } from '@/lib/reports/orda-finreport-pdf'
import { renderTableHTML, PDF_OPTIONS as TABLE_OPTIONS } from '@/lib/reports/orda-table-pdf'
import { renderPremiumHTML, PDF_OPTIONS as PREMIUM_OPTIONS } from '@/lib/reports/orda-premium-pdf'

// Единый рендер PDF из переданных клиентом данных: финансовый отчёт или таблица.
export const maxDuration = 60
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.x64.tar'

const FONT_CSS =
  "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Manrope:wght@700;800&display=swap');"

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(req: Request) {
  let browser: Awaited<ReturnType<typeof import('puppeteer-core').default.launch>> | null = null
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && !access.staffMember) return json({ error: 'forbidden' }, 403)

    const body = (await req.json().catch(() => null)) as { kind?: string; data?: any } | null
    const kind = body?.kind === 'table' ? 'table' : body?.kind === 'premium' ? 'premium' : 'finreport'
    const data = body?.data
    if (!data || typeof data !== 'object') return json({ error: 'data обязателен' }, 400)

    const html =
      kind === 'table'
        ? renderTableHTML(data, { fontCss: FONT_CSS })
        : kind === 'premium'
          ? renderPremiumHTML(data, { fontCss: FONT_CSS })
          : renderFinReportHTML(data, { fontCss: FONT_CSS })
    const options = kind === 'table' ? TABLE_OPTIONS : kind === 'premium' ? PREMIUM_OPTIONS : FIN_OPTIONS

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
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    try { await page.evaluate(() => (document as any).fonts?.ready) } catch { /* шрифты не критичны */ }

    const pdfBuffer = await page.pdf(options as any)

    const rawName = String(data?.meta?.title || 'Otchet')
    const safeName = rawName.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60)
    const filename = `${safeName}.pdf`

    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/reports/pdf',
      message: error?.message || 'reports pdf failed',
    })
    return json({ error: error?.message || 'Ошибка генерации PDF' }, 500)
  } finally {
    if (browser) {
      try { await browser.close() } catch { /* ignore */ }
    }
  }
}
