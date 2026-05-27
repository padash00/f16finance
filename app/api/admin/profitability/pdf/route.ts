import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'

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

    if (!companyId || !monthFrom || !monthTo) {
      return json({ error: 'company_id, from, to обязательны' }, 400)
    }

    // Собираем URL print-страницы. Хост берём из текущего запроса.
    const printUrl = new URL('/profitability/print', url.origin)
    printUrl.searchParams.set('company_id', companyId)
    printUrl.searchParams.set('from', monthFrom)
    printUrl.searchParams.set('to', monthTo)
    if (partnersRaw) printUrl.searchParams.set('partners', partnersRaw)
    if (!includeCapex) printUrl.searchParams.set('capex', '0')
    if (payrollStaffOverride) printUrl.searchParams.set('payroll_staff', payrollStaffOverride)
    if (payrollOpsOverride) printUrl.searchParams.set('payroll_ops', payrollOpsOverride)

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

    // Пробрасываем cookies текущего пользователя — без них print-страница не пройдёт авторизацию.
    const cookieHeader = req.headers.get('cookie') || ''
    if (cookieHeader) {
      const hostname = url.hostname
      const cookies = cookieHeader
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((pair) => {
          const eqIdx = pair.indexOf('=')
          if (eqIdx < 0) return null
          const name = pair.slice(0, eqIdx).trim()
          const value = pair.slice(eqIdx + 1).trim()
          if (!name) return null
          return { name, value, domain: hostname, path: '/' }
        })
        .filter((c): c is { name: string; value: string; domain: string; path: string } => c !== null)
      if (cookies.length > 0) {
        await page.setCookie(...cookies)
      }
    }

    await page.goto(printUrl.toString(), { waitUntil: 'networkidle0', timeout: 30_000 })

    // Доп. ожидание — на случай если внутри страницы ещё рендерятся данные после networkidle.
    await page.waitForSelector('.doc-paper', { timeout: 10_000 })

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    })

    const filename = `profitability-${monthFrom}${monthFrom !== monthTo ? `_${monthTo}` : ''}.pdf`

    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
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
