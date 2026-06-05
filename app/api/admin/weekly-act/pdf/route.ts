import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'

// Vercel: PDF-генерация может занять 10-20 секунд (cold start chromium).
export const maxDuration = 60
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    if (!access.isSuperAdmin && !access.staffMember) return json({ error: 'forbidden' }, 403)

    const url = new URL(req.url)
    const from = (url.searchParams.get('from') || '').trim()
    const to = (url.searchParams.get('to') || '').trim()
    if (!from || !to) return json({ error: 'from, to обязательны' }, 400)

    // Печатаем standalone-страницу акта (она сама тянет /api/admin/weekly-act).
    const printUrl = new URL('/weekly-report/act-print', url.origin)
    printUrl.searchParams.set('from', from)
    printUrl.searchParams.set('to', to)

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

    // Пробрасываем cookies — без них print-страница не пройдёт авторизацию при фетче данных.
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
      if (cookies.length > 0) await page.setCookie(...cookies)
    }

    await page.goto(printUrl.toString(), { waitUntil: 'networkidle0', timeout: 30_000 })
    await page.waitForSelector('.act-paper', { timeout: 12_000 })
    // Печатаем как ЭКРАН — иначе теряются фоны/рамки.
    await page.emulateMediaType('screen')

    const pdfBuffer = await page.pdf({
      landscape: true,
      format: 'A4',
      printBackground: true,
      margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
    })

    const filename = `Akt_${from}_${to}.pdf`
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
      area: 'api/admin/weekly-act/pdf',
      message: error?.message || 'weekly-act pdf failed',
    })
    return json({ error: error?.message || 'Ошибка генерации PDF' }, 500)
  } finally {
    if (browser) {
      try { await browser.close() } catch { /* ignore */ }
    }
  }
}
