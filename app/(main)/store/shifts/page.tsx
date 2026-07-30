'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { PageSkeleton, StatGridSkeleton, TableSkeleton } from '@/components/skeleton'
import { Clock, Loader2, RefreshCw, Settings, User, Wallet, CreditCard, X, ChevronRight, TrendingUp, RotateCcw } from 'lucide-react'

type LiveTotals = { sales: number; cash: number; kaspi: number; count: number }
type Shift = {
  id: string
  status: string
  shift_type?: string | null
  opened_at: string
  closed_at: string | null
  opening_cash: number | null
  closing_cash: number | null
  closing_kaspi: number | null
  totals_json?: any
  live_totals?: LiveTotals | null
  operator?: { full_name?: string | null; short_name?: string | null } | null
}

const fmt = (n: number | null | undefined) => Number(n || 0).toLocaleString('ru-RU')
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')

function escHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

// A4 Z-отчёт — печать по требованию на сайте (страница «Смены»).
function printZReport(r: any) {
  const w = window.open('', '_blank', 'width=800,height=1000')
  if (!w) return
  const money = (n: number) => `${fmt(Math.round(Number(n || 0)))} ₸`
  const dts = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
  const qtyU = (n: number, u: string) => `${fmt(n)}${u ? ' ' + escHtml(u) : ''}`
  const req = r.requisites || {}
  const positions = r.positions || []
  const rows = positions
    .map((p: any, i: number) => `<tr><td class="idx">${i + 1}</td><td class="nm">${escHtml(p.name)}</td><td class="num">${qtyU(p.sold, p.unit)}</td><td class="num stk">${qtyU(p.stock, p.unit)}</td><td class="num amt">${money(p.amount)}</td></tr>`)
    .join('')
  // Доп. показатели для полноты отчёта.
  const checks = Number(r.checkCount || 0)
  const avg = checks > 0 ? Math.round(Number(r.total || 0) / checks) : 0
  const soldUnits = positions.reduce((a: number, p: any) => a + Number(p.sold || 0), 0)
  const names = positions.length
  let duration = '—'
  if (r.openedAt && r.closedAt) {
    const ms = new Date(r.closedAt).getTime() - new Date(r.openedAt).getTime()
    if (ms > 0) { const h = Math.floor(ms / 3600000); const m = Math.round((ms % 3600000) / 60000); duration = `${h} ч ${m} мин` }
  }
  const kpi = (label: string, value: string) => `<div class="kpi"><div class="kl">${label}</div><div class="kv">${value}</div></div>`
  const debts = r.debts || []
  const debtRows = debts
    .map((d: any) => `<tr><td class="nm">${escHtml(d.debtor)}</td><td>${escHtml(d.item)}</td><td class="num">${fmt(d.quantity)}</td><td class="num amt">${money(d.amount)}</td></tr>`)
    .join('')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Z-Отчёт · Смена №${r.shiftNumber}</title>
    <style>
    @page{size:A4;margin:14mm}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:12.5px;color:#1a1a1a;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .wrap{max-width:720px;margin:0 auto}
    .hd{text-align:center;padding-bottom:12px;border-bottom:2px solid #111;margin-bottom:16px}
    .hd .co{font-size:17px;font-weight:800;letter-spacing:.2px}
    .hd .m{color:#666;font-size:11.5px;margin-top:3px}
    .title{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px}
    .title h1{font-size:20px;font-weight:800;color:#059669;letter-spacing:1px}
    .title .sh{font-size:13px;color:#555;font-weight:700}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:2px 28px;margin-bottom:18px}
    .meta .r{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dotted #ddd;padding:4px 0}
    .meta .k{color:#777}.meta .v{font-weight:700;text-align:right}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
    .kpi{border:1px solid #eee;border-radius:8px;padding:9px 10px;text-align:center}
    .kpi .kl{font-size:9px;text-transform:uppercase;letter-spacing:.4px;color:#999}
    .kpi .kv{font-size:16px;font-weight:800;margin-top:3px;font-variant-numeric:tabular-nums}
    .cash{display:grid;grid-template-columns:1fr 1fr;gap:0 24px;margin-bottom:20px}
    .cash .r{display:flex;justify-content:space-between;padding:5px 2px;border-bottom:1px solid #f1f1f1}
    .cash .r span:last-child{font-weight:600;font-variant-numeric:tabular-nums}
    .sec{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:#999;margin-bottom:6px}
    .sum{margin-bottom:20px}
    .sum .r{display:flex;justify-content:space-between;padding:5px 2px;border-bottom:1px solid #f1f1f1}
    .sum .r span:last-child{font-variant-numeric:tabular-nums;font-weight:600}
    .sum .r.tot{border-top:2px solid #111;border-bottom:none;margin-top:5px;padding-top:9px;font-size:16px;font-weight:800}
    .sum .r.tot span:last-child{color:#059669}
    table{width:100%;border-collapse:collapse}
    thead th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;padding:7px 8px;border-bottom:2px solid #111}
    tbody td{padding:6px 8px;border-bottom:1px solid #f1f1f1;vertical-align:middle}
    tbody tr:nth-child(even){background:#fafafa}
    .idx{color:#bbb;width:24px;text-align:right;font-size:11px}
    .nm{width:auto}
    .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
    th.num{text-align:right}
    .stk{color:#666;width:96px}.amt{font-weight:700;width:110px}
    .foot{margin-top:22px;padding-top:8px;border-top:1px solid #eee;display:flex;justify-content:space-between;color:#aaa;font-size:10.5px}
    .bar{position:sticky;top:0;z-index:9;display:flex;gap:8px;justify-content:center;padding:10px;background:#f4f4f5;border-bottom:1px solid #e4e4e7;margin:-14mm -14mm 14px}
    .bar button{border:none;border-radius:8px;padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer}
    .bar .p{background:#059669;color:#fff}.bar .c{background:#e4e4e7;color:#111}
    @media print{.bar{display:none}}
    </style></head>
    <body>
      <div class="bar"><button class="p" onclick="window.print()">🖨 Печать</button><button class="c" onclick="window.close()">Закрыть</button></div>
      <div class="wrap">
        <div class="hd">
          <div class="co">${escHtml(req.name || r.pointName || 'ORDA POINT')}</div>
          <div class="m">${req.bin ? 'БИН/ИИН ' + escHtml(req.bin) : ''}${req.bin && req.address ? ' · ' : ''}${req.address ? escHtml(req.address) : ''}</div>
        </div>
        <div class="title"><h1>Z-ОТЧЁТ</h1><span class="sh">Смена №${r.shiftNumber}</span></div>
        <div class="meta">
          <div class="r"><span class="k">Точка</span><span class="v">${escHtml(r.pointName || '—')}</span></div>
          <div class="r"><span class="k">Кассир</span><span class="v">${escHtml(r.cashier || '—')}</span></div>
          <div class="r"><span class="k">Открыта</span><span class="v">${dts(r.openedAt)}</span></div>
          <div class="r"><span class="k">Закрыта</span><span class="v">${dts(r.closedAt)}</span></div>
          <div class="r"><span class="k">Продолжительность</span><span class="v">${duration}</span></div>
        </div>
        <div class="sec">Ключевые показатели</div>
        <div class="kpis">
          ${kpi('Чеков за смену', String(checks))}
          ${kpi('Средний чек', money(avg))}
          ${kpi('Позиций продано', fmt(soldUnits))}
          ${kpi('Наименований', String(names))}
        </div>
        <div class="sec">Суммы за смену</div>
        <div class="sum">
          <div class="r"><span>Наличные · ${r.cashCount || 0} чек</span><span>${money(r.cashSales)}</span></div>
          <div class="r"><span>Безналичные · ${r.kaspiCount || 0} чек</span><span>${money(r.kaspiSales)}</span></div>
          <div class="r"><span>Возвраты</span><span>${money(r.returns)}</span></div>
          <div class="r tot"><span>Итоговая сумма</span><span>${money(r.total)}</span></div>
        </div>
        <div class="sec">Наличность в кассе</div>
        <div class="cash">
          <div class="r"><span>На начало смены</span><span>${money(r.openingCash)}</span></div>
          <div class="r"><span>На конец смены</span><span>${money(r.closingCash)}</span></div>
        </div>
        <div class="sec">Позиции · ${names}</div>
        <table>
          <thead><tr><th class="idx">#</th><th>Название</th><th class="num">Продано</th><th class="num">На складе</th><th class="num">Сумма</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="color:#999;padding:12px 8px">Продаж по позициям нет</td></tr>'}</tbody>
        </table>
        <div class="sum" style="margin-top:8px"><div class="r tot"><span>Итог проданных товаров</span><span>${money(r.goodsTotal)}</span></div></div>
        ${debts.length ? `
        <div class="sec" style="margin-top:20px">Долги за смену · ${debts.length}</div>
        <table>
          <thead><tr><th>Должник</th><th>Товар</th><th class="num">Кол-во</th><th class="num">Сумма</th></tr></thead>
          <tbody>${debtRows}</tbody>
        </table>
        <div class="sum" style="margin-top:8px"><div class="r tot"><span>Итого долгов за смену</span><span style="color:#e11d48 !important">${money(r.debtsTotal)}</span></div></div>
        <div style="margin-top:4px;color:#999;font-size:10.5px">Долги — товар взят без оплаты. В выручку смены не входят.</div>
        ` : ''}
        <div class="foot"><span>Orda Point · управленческий Z-отчёт</span><span>Сформировано: ${new Date().toLocaleString('ru-RU')}</span></div>
      </div>
    </body></html>`)
  w.document.close()
}

// Загрузить данные Z-отчёта и открыть печатную A4-страницу (сперва показ, печать по кнопке).
async function printZFor(shiftId: string) {
  try {
    const res = await fetch(`/api/admin/shifts/z-report?shift_id=${shiftId}`, { cache: 'no-store' })
    const j = await res.json().catch(() => null)
    if (res.ok && j?.report) printZReport(j.report)
    else alert(j?.error === 'forbidden' ? 'Нет доступа к этой смене' : 'Не удалось сформировать Z-отчёт')
  } catch { alert('Не удалось сформировать Z-отчёт') }
}
const tm = (s: string | null) => (s ? new Date(s).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—')
const STATUS: { key: string; label: string }[] = [
  { key: 'closed', label: 'Закрытые' },
  { key: 'open', label: 'Открытые' },
  { key: 'all', label: 'Все' },
]
const PAY_LABEL: Record<string, string> = { cash: 'Нал', kaspi: 'Безнал', card: 'Карта', online: 'Онлайн', mixed: 'Смеш.' }
const PAY_CHIP: Record<string, string> = {
  cash: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300',
  kaspi: 'border-amber-400/30 bg-amber-500/10 text-amber-300',
  card: 'border-sky-400/30 bg-sky-500/10 text-sky-300',
  online: 'border-violet-400/30 bg-violet-500/10 text-violet-300',
  mixed: 'border-slate-400/30 bg-slate-500/10 text-slate-300',
}

function salesOf(s: Shift): number | null {
  if (s.status === 'open') return s.live_totals?.sales ?? null
  const t = s.totals_json
  if (t && typeof t === 'object') {
    const v = t.sales_total ?? t.total_sales ?? t.revenue ?? t.sales ?? t.total
    if (typeof v === 'number') return v
  }
  return null
}

export default function StoreShiftsPage() {
  const { can } = useCapabilities()
  const [storeCompanyId, setStoreCompanyId] = useState<string | null | undefined>(undefined)
  const [status, setStatus] = useState('closed')
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/store/config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setStoreCompanyId(j?.data?.store_company_id || null))
      .catch(() => setStoreCompanyId(null))
  }, [])

  const load = useCallback(async () => {
    if (!storeCompanyId) return
    setLoading(true); setErr(null)
    try {
      const p = new URLSearchParams({ company_id: storeCompanyId, status, limit: '200' })
      const res = await fetch(`/api/admin/shifts/reports?${p}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || 'Ошибка загрузки')
      setShifts(j.data?.shifts || [])
    } catch (e: any) { setErr(e?.message || 'Ошибка') } finally { setLoading(false) }
  }, [storeCompanyId, status])

  useEffect(() => { if (storeCompanyId) load() }, [storeCompanyId, load])

  if (storeCompanyId === undefined) {
    return <div className="app-page-wide"><PageSkeleton stats={0} rows={8} cols={4} /></div>
  }

  if (!storeCompanyId) {
    return (
      <div className="app-page-wide space-y-5">
        <AdminPageHeader title="Смены" description="Смены по точке-магазину" icon={<Clock className="h-5 w-5" />} accent="emerald" backHref="/store" />
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-6 text-center">
          <p className="text-sm text-amber-700 dark:text-amber-100">Точка магазина не выбрана.</p>
          <Link href="/store/settings" className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
            <Settings className="h-4 w-4" /> Выбрать точку
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="app-page-wide space-y-5">
      <AdminPageHeader
        title="Смены"
        description="Смены по точке-магазину"
        icon={<Clock className="h-5 w-5" />}
        accent="emerald"
        backHref="/store"
        actions={
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white dark:bg-white/5 px-3 py-2 text-xs font-medium text-body transition-colors hover:bg-slate-50 dark:hover:bg-white/10">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Обновить
          </button>
        }
        toolbar={
          <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-border bg-slate-50 dark:bg-slate-950/50 p-1">
            {STATUS.map(({ key, label }) => (
              <button key={key} onClick={() => setStatus(key)} className={`rounded-xl px-3 py-2 text-sm font-medium transition-all sm:px-4 ${status === key ? 'bg-white dark:bg-white/10 text-foreground shadow-sm ring-1 ring-slate-200 dark:ring-white/10' : 'text-muted-foreground hover:text-slate-900 dark:hover:text-white'}`}>{label}</button>
            ))}
          </div>
        }
      />

      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-200">{err}</div>}

      <div className="rounded-2xl border border-border bg-white dark:bg-slate-900/60 shadow-lg shadow-black/20 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-foreground">Смены</span>
          <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs text-muted-foreground">{shifts.length}</span>
        </div>
        {loading && shifts.length === 0 ? (
          <div className="p-4"><TableSkeleton rows={8} cols={4} /></div>
        ) : shifts.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-slate-400">Смен нет</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {shifts.map((s) => {
              const sales = salesOf(s)
              const open = s.status === 'open'
              const cash = open ? (s.live_totals?.cash ?? 0) : Number(s.closing_cash || 0)
              const kaspi = open ? (s.live_totals?.kaspi ?? 0) : Number(s.closing_kaspi || 0)
              return (
                <div key={s.id} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03] sm:gap-x-6 sm:px-4">
                  <button onClick={() => setDetailId(s.id)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 text-left">
                    <div className="flex min-w-[180px] items-center gap-2">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 dark:bg-white/5 text-muted-foreground"><User className="h-4 w-4" /></span>
                      <div>
                        <div className="text-sm font-medium text-foreground">{s.operator?.full_name || s.operator?.short_name || '—'}</div>
                        <div className="text-[11px] text-slate-500">{dt(s.opened_at)} → {dt(s.closed_at)}</div>
                      </div>
                    </div>
                    <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${open ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-border bg-surface-muted text-muted-foreground'}`}>
                      {open ? 'Открыта' : 'Закрыта'}
                    </span>
                    <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                      {sales != null && (
                        <div className="text-right"><div className="text-[11px] text-slate-500">Продажи</div><div className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(sales)} ₸</div></div>
                      )}
                      <div className="text-right"><div className="flex items-center justify-end gap-1 text-[11px] text-slate-500"><Wallet className="h-3 w-3" /> Касса</div><div className="font-medium tabular-nums text-foreground">{fmt(cash)} ₸</div></div>
                      <div className="text-right"><div className="flex items-center justify-end gap-1 text-[11px] text-slate-500"><CreditCard className="h-3 w-3" /> Безнал</div><div className="font-medium tabular-nums text-sky-700 dark:text-sky-300">{fmt(kaspi)} ₸</div></div>
                    </div>
                  </button>
                  {can('store-shifts.export') && <button onClick={() => printZFor(s.id)} title="Распечатать Z-отчёт" className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20">🖨 <span className="hidden sm:inline">Z-отчёт</span></button>}
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {detailId && <ShiftDetail id={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
    </div>
  )
}

function ShiftDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useCapabilities()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeErr, setCloseErr] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [note, setNote] = useState('')
  const [receiptSaleId, setReceiptSaleId] = useState<string | null>(null) // чек по клику на продажу

  async function handleForceClose() {
    setClosing(true); setCloseErr(null)
    try {
      const res = await fetch(`/api/admin/shifts/reports/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'closeForce', note: note.trim() || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) {
        if (res.status === 403) throw new Error('Нет прав на принудительное закрытие смены')
        throw new Error(j.detail || j.error || 'Не удалось закрыть смену')
      }
      onChanged()
      onClose()
    } catch (e: any) {
      setCloseErr(e?.message || 'Ошибка')
    } finally {
      setClosing(false)
    }
  }

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  useEffect(() => {
    let active = true
    setLoading(true); setErr(null)
    fetch(`/api/admin/shifts/reports/${id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (!active) return; if (!j.ok) throw new Error(j.error || 'Ошибка'); setData(j.data) })
      .catch((e) => { if (active) setErr(e?.message || 'Ошибка') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  if (!mounted) return null

  const shift = data?.shift
  const sales = (data?.sales || []) as any[]
  const returns = (data?.returns || []) as any[]
  const open = shift?.status === 'open'
  const salesTotal = sales.reduce((s, x) => s + Number(x.total_amount || 0), 0)
  const cashTotal = sales.reduce((s, x) => s + Number(x.cash_amount || 0), 0)
  const kaspiTotal = sales.reduce((s, x) => s + Number(x.kaspi_amount || 0), 0)
  const returnsTotal = returns.reduce((s, x) => s + Number(x.total_amount || 0), 0)

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-stretch justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex h-full w-full max-w-2xl flex-col border-l border-border bg-card shadow-2xl">
        {/* Шапка */}
        <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-emerald-400/30 bg-emerald-500/15"><Clock className="h-5 w-5 text-emerald-700 dark:text-emerald-300" /></span>
            <div>
              <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                {shift?.operator?.full_name || shift?.operator?.short_name || 'Смена'}
                <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${open ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-border bg-surface-muted text-muted-foreground'}`}>{open ? 'Открыта' : 'Закрыта'}</span>
              </div>
              <div className="text-xs text-slate-500">{dt(shift?.opened_at)} → {dt(shift?.closed_at)}</div>
            </div>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        {loading ? (
          <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
            <StatGridSkeleton count={4} />
            <TableSkeleton rows={6} cols={3} />
          </div>
        ) : err ? (
          <div className="m-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-200">{err}</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5">
            {/* KPI */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Продажи" value={`${fmt(salesTotal)} ₸`} accent="text-emerald-700 dark:text-emerald-300" icon={<TrendingUp className="h-4 w-4" />} />
              <Kpi label="Касса" value={`${fmt(open ? cashTotal : (shift?.closing_cash ?? cashTotal))} ₸`} accent="text-foreground" icon={<Wallet className="h-4 w-4" />} />
              <Kpi label="Безнал" value={`${fmt(open ? kaspiTotal : (shift?.closing_kaspi ?? kaspiTotal))} ₸`} accent="text-sky-700 dark:text-sky-300" icon={<CreditCard className="h-4 w-4" />} />
              <Kpi label="Возвраты" value={`${fmt(returnsTotal)} ₸`} accent={returnsTotal > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground'} icon={<RotateCcw className="h-4 w-4" />} />
            </div>
            {open && (
              <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
                Смена открыта — суммы по продажам в реальном времени. Касса/Безнал зафиксируются при закрытии.
              </div>
            )}

            {/* Продажи */}
            <div className="mt-5 mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Продажи</span>
              <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs text-muted-foreground">{sales.length}</span>
            </div>
            {sales.length === 0 ? (
              <div className="rounded-xl border border-border bg-slate-50 dark:bg-white/[0.02] px-4 py-8 text-center text-sm text-muted-foreground">Продаж нет</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/5 overflow-hidden rounded-xl border border-border">
                {sales.map((s) => {
                  const chip = PAY_CHIP[s.payment_method] || PAY_CHIP.mixed
                  const items = (s.items || []) as any[]
                  const names = items.map((it) => (it.item?.name || it.universal_name)).filter(Boolean)
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setReceiptSaleId(String(s.id))}
                      title="Открыть чек продажи"
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                    >
                      <div className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">{tm(s.sold_at)}</div>
                      <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${chip}`}>{PAY_LABEL[s.payment_method] || s.payment_method}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-foreground">{names.length > 0 ? names.join(', ') : `${items.length} позиц.`}</div>
                        {s.operator?.full_name || s.operator?.short_name ? <div className="text-[11px] text-slate-500">{s.operator?.full_name || s.operator?.short_name}</div> : null}
                      </div>
                      <div className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{fmt(s.total_amount)} ₸</div>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Возвраты */}
            {returns.length > 0 && (
              <>
                <div className="mt-5 mb-2 text-sm font-semibold text-foreground">Возвраты</div>
                <div className="divide-y divide-slate-100 dark:divide-white/5 overflow-hidden rounded-xl border border-rose-500/20">
                  {returns.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="text-xs text-muted-foreground">{tm(r.returned_at)} · {PAY_LABEL[r.payment_method] || r.payment_method}{r.comment ? ` · ${r.comment}` : ''}</div>
                      <div className="shrink-0 text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-300">−{fmt(r.total_amount)} ₸</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {open && !loading && !err && (
          <div className="shrink-0 space-y-2 border-t border-border bg-card p-4">
            {!confirmClose ? (
              <button
                type="button"
                onClick={() => { setConfirmClose(true); setCloseErr(null) }}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
              >
                <Clock className="h-4 w-4" /> Закрыть смену и отправить отчёт
              </button>
            ) : (
              <div className="space-y-2">
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-100">
                  Смена закроется, а выручка попадёт в <b>Доходы</b>:
                  <div className="mt-1 tabular-nums">
                    Нал {fmt(cashTotal)} ₸ · Безнал {fmt(kaspiTotal)} ₸ · <b>Итого {fmt(salesTotal)} ₸</b>
                  </div>
                </div>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Причина / комментарий (необязательно)"
                  className="w-full rounded-xl border border-border bg-white dark:bg-white/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500"
                />
                {closeErr && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">{closeErr}</div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={closing}
                    onClick={() => setConfirmClose(false)}
                    className="flex-1 rounded-xl border border-border bg-white dark:bg-white/5 px-4 py-2.5 text-sm font-medium text-body transition-colors hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-50"
                  >
                    Отмена
                  </button>
                  {can('shifts-reports.close_force') && (
                  <button
                    type="button"
                    disabled={closing}
                    onClick={handleForceClose}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
                  >
                    {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Закрыть смену
                  </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Чек продажи по клику — как в операторской (публичная страница /r/<saleId>) */}
      {receiptSaleId && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/70 p-4" onClick={() => setReceiptSaleId(null)}>
          <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-foreground">Чек продажи</span>
              <button type="button" onClick={() => setReceiptSaleId(null)} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-slate-100 dark:hover:bg-white/5 hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-auto bg-white">
              <iframe
                id="shift-sale-receipt-iframe"
                src={`/r/${receiptSaleId}`}
                title="Чек продажи"
                className="h-[70vh] w-full border-0"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-border p-3">
              <button type="button" onClick={() => setReceiptSaleId(null)} className="rounded-xl border border-border bg-white dark:bg-white/5 px-4 py-2 text-sm text-body hover:bg-slate-50 dark:hover:bg-white/10">Закрыть</button>
              <button
                type="button"
                onClick={() => { try { (document.getElementById('shift-sale-receipt-iframe') as HTMLIFrameElement | null)?.contentWindow?.print() } catch { /* noop */ } }}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >🖨 Печать</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

function Kpi({ label, value, accent, icon }: { label: string; value: string; accent: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface-muted p-3">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-500"><span>{label}</span><span className="text-muted-foreground">{icon}</span></div>
      <div className={`mt-1 text-base font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  )
}
