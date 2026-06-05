import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { renderReportHTML, PDF_OPTIONS } from '@/lib/reports/orda-report-template'
import { buildProfitabilityContract, type BranchData } from '@/lib/reports/build-profitability-contract'

// Vercel: PDF-генерация может занять 10-20 секунд (cold start chromium).
export const maxDuration = 60
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Версия chromium должна совпадать с major-версией @sparticuz/chromium-min из package.json.
// При обновлении пакета — обновить URL.
const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.x64.tar'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  let browser: Awaited<ReturnType<typeof import('puppeteer-core').default.launch>> | null = null
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'profitability.view')
    if (denied) return denied as any

    const url = new URL(req.url)
    const companyId = (url.searchParams.get('company_id') || '').trim()
    const monthFrom = (url.searchParams.get('from') || '').trim()
    const monthTo = (url.searchParams.get('to') || '').trim()
    const partnersRaw = url.searchParams.get('partners') || ''
    const includeCapex = url.searchParams.get('capex') !== '0'
    const payrollStaffOverride = url.searchParams.get('payroll_staff') || ''
    const payrollOpsOverride = url.searchParams.get('payroll_ops') || ''
    const note = url.searchParams.get('note') || ''

    if (!companyId || !monthFrom || !monthTo) {
      return json({ error: 'company_id, from, to обязательны' }, 400)
    }

    // Данные точки строго из журнала (branch-report). Тянем server-side, пробрасывая cookies для авторизации.
    const cookieHeader = req.headers.get('cookie') || ''
    const brUrl = new URL('/api/admin/profitability/branch-report', url.origin)
    brUrl.searchParams.set('company_id', companyId)
    brUrl.searchParams.set('from', monthFrom)
    brUrl.searchParams.set('to', monthTo)
    const brRes = await fetch(brUrl.toString(), {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      cache: 'no-store',
    })
    const brJson = await brRes.json().catch(() => null)
    if (!brRes.ok || !brJson?.ok || !brJson?.data) {
      throw new Error(brJson?.error || `branch-report HTTP ${brRes.status}`)
    }

    // JSON-контракт → HTML по единому шаблону orda-report-template.
    const generated = new Date().toLocaleDateString('ru-RU')
    const contract = buildProfitabilityContract(brJson.data as BranchData, generated)
    if (!includeCapex) (contract as any).capex = undefined
    // Шрифты онлайн (Inter + Manrope с кириллицей).
    const fontCss = "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Manrope:wght@700;800&display=swap');"
    const html = renderReportHTML(contract, { fontCss })

    // Динамические импорты — чтобы Vercel не паковал chromium в обычные routes.
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
    // Дождаться шрифтов (иначе цифры могут отрисоваться запасным шрифтом).
    try { await page.evaluate(() => (document as any).fonts?.ready) } catch { /* шрифты не критичны */ }

    const pdfBuffer = await page.pdf(PDF_OPTIONS as any)

    const safeName = (contract.name || 'report').replace(/[^\p{L}\p{N}_-]+/gu, '_')
    const filename = `Orda_${safeName}_${monthFrom}${monthFrom !== monthTo ? `_${monthTo}` : ''}.pdf`

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
      area: 'api/admin/profitability/pdf',
      message: error?.message || 'pdf export failed',
    })
    return json({ error: error?.message || 'Ошибка генерации PDF' }, 500)
  } finally {
    if (browser) {
      try { await browser.close() } catch { /* ignore */ }
    }
  }
}
