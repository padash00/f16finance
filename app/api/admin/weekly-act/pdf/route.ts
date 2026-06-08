import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { renderWeeklyHTML, PDF_OPTIONS } from '@/lib/reports/orda-weekly-template'
import { buildWeeklyContract, type WeeklyActData } from '@/lib/reports/build-weekly-contract'

// Vercel: PDF-генерация может занять 10-20 секунд (cold start chromium).
export const maxDuration = 60
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.x64.tar'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// Подпись недели «08 июн — 14 июн» из даты понедельника (локальные части, без UTC-сдвига).
function weekLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y) return ''
  const start = new Date(y, m - 1, d)
  const end = new Date(y, m - 1, d + 6)
  const f = (x: Date) => x.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
  return `${f(start)} — ${f(end)}`
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

    // Данные акта из журнала (weekly-act). Server-side с пробросом cookies для авторизации.
    const cookieHeader = req.headers.get('cookie') || ''
    const actUrl = new URL('/api/admin/weekly-act', url.origin)
    actUrl.searchParams.set('from', from)
    actUrl.searchParams.set('to', to)
    const actRes = await fetch(actUrl.toString(), {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      cache: 'no-store',
    })
    const actJson = await actRes.json().catch(() => null)
    if (!actRes.ok || !actJson?.data) {
      throw new Error(actJson?.error || `weekly-act HTTP ${actRes.status}`)
    }

    // JSON-контракт → HTML по шаблону orda-weekly-template.
    const generated = new Date().toLocaleString('ru-RU')
    const baseContract = buildWeeklyContract(actJson.data as WeeklyActData, generated)

    // План закупок (неделя после отчётной). Неделю присылает клиент (plan_week) —
    // чтобы таймзона сервера не сдвинула дату.
    const planWeek = (url.searchParams.get('plan_week') || '').trim()
    let purchasingPlan: any[] = []
    let purchasingPlanWeek = ''
    if (planWeek) {
      try {
        const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
        const { data: planRows } = await supabase
          .from('purchase_plan_items')
          .select('company_id, day_of_week, category, title, supplier, quantity, amount, status')
          .eq('week_start', planWeek)
          .order('day_of_week', { ascending: true })
        const nameById = new Map<string, string>(
          ((actJson.data as WeeklyActData).companies || []).map((c) => [String(c.id), c.name]),
        )
        purchasingPlan = (planRows || []).map((r: any) => ({
          company: nameById.get(String(r.company_id)) || '—',
          day: Number(r.day_of_week) || 0,
          category: r.category || '',
          title: r.title || '',
          supplier: r.supplier || '',
          qty: r.quantity != null ? r.quantity : '',
          amount: Number(r.amount) || 0,
          bought: r.status === 'bought',
        }))
        purchasingPlanWeek = weekLabel(planWeek)
      } catch {
        /* план необязателен для акта */
      }
    }
    const contract = { ...baseContract, purchasingPlan, purchasingPlanWeek }
    const fontCss = "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Manrope:wght@700;800&display=swap');"
    const html = renderWeeklyHTML(contract, { fontCss })

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

    const pdfBuffer = await page.pdf(PDF_OPTIONS as any)

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
