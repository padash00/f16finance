'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { downloadReportPdf } from '@/lib/client/download-pdf'
import { useCapabilities } from '@/lib/client/use-capabilities'
import {
  CalendarDays,
  CheckSquare,
  Download,
  Loader2,
  Receipt,
  RefreshCw,
  Square,
} from 'lucide-react'

import {
  AdminPageHeader,
  AdminTableViewport,
  adminTableStickyTheadClass,
} from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { addDaysISO, formatRuDate, weekStartUtcISO } from '@/lib/core/date'
import { formatMoney } from '@/lib/core/format'

type CompanyOpt = { id: string; name: string | null; code: string | null }
type DebtRow = {
  id: string
  company_id: string
  company_name: string
  company_code: string | null
  point_device_id: string | null
  point_device_name: string | null
  operator_id: string | null
  client_name: string | null
  debtor_name: string
  created_by_operator_id: string | null
  created_by_name: string
  item_name: string
  barcode: string | null
  quantity: number
  unit_price: number
  total_amount: number
  comment: string | null
  week_start: string
  source: string | null
  local_ref: string | null
  created_at: string
}

type LegacyDebtRow = {
  id: string
  company_id: string | null
  company_name: string
  company_code: string | null
  operator_id: string | null
  client_name: string | null
  debtor_name: string
  amount: number
  comment: string | null
  source: string | null
  week_start: string
  created_at: string | null
  rolled_over_from_id?: string | null
  rolled_over_chain?: Array<{ week_start: string; amount: number }>
}

type LoadData = {
  weekStart: string
  weekEnd: string
  companies: CompanyOpt[]
  items: DebtRow[]
  totals: { count: number; amount: number }
  legacyAggregates: LegacyDebtRow[]
  legacyTotals: { count: number; amount: number }
  /** Есть активные debts с source point-client, но нет строк point_debt_items — проверьте неделю или списания. */
  pointClientAggregateHint: { count: number; amount: number } | null
}

const money = formatMoney

export default function PointDebtsPage() {
  const { can } = useCapabilities()
  const canMarkPaid = can('point-debts.mark_paid')
  const canExport = can('point-debts.export')

  /** Как на точке при создании долга (UTC-понедельник), иначе список пустой при сдвиге TZ. */
  const currentWeek = weekStartUtcISO(new Date())
  const [weekStart, setWeekStart] = useState(currentWeek)
  const [companyId, setCompanyId] = useState<string>('')
  const [data, setData] = useState<LoadData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [settling, setSettling] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debtorFilter, setDebtorFilter] = useState<string>('')

  const weekEnd = useMemo(() => addDaysISO(weekStart, 6), [weekStart])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSelected({})
    try {
      const q = new URLSearchParams({ weekStart })
      if (companyId) q.set('companyId', companyId)
      const res = await fetch(`/api/admin/point-debts?${q.toString()}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || `Ошибка ${res.status}`)
      const d = json.data as Partial<LoadData>
      setData({
        weekStart: d.weekStart || '',
        weekEnd: d.weekEnd || '',
        companies: d.companies || [],
        items: d.items || [],
        totals: d.totals || { count: 0, amount: 0 },
        legacyAggregates: d.legacyAggregates ?? [],
        legacyTotals: d.legacyTotals ?? { count: 0, amount: 0 },
        pointClientAggregateHint: d.pointClientAggregateHint ?? null,
      })
    } catch (e: any) {
      setData(null)
      setError(e?.message || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [weekStart, companyId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 7000)
    return () => clearTimeout(t)
  }, [error])

  const items = data?.items || []
  const legacyRows = data?.legacyAggregates ?? []
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return items.filter((r) => {
      if (debtorFilter && r.debtor_name !== debtorFilter) return false
      if (!q) return true
      const haystack = [
        r.debtor_name,
        r.company_name,
        r.point_device_name || '',
        r.item_name,
        r.barcode || '',
        r.comment || '',
        r.created_by_name,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [items, debtorFilter, searchQuery])
  const debtorOptions = useMemo(
    () =>
      Array.from(new Set(items.map((r) => r.debtor_name)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'ru')),
    [items],
  )
  const filteredTotals = useMemo(
    () => ({
      count: filteredItems.length,
      amount: filteredItems.reduce((s, r) => s + Number(r.total_amount || 0), 0),
    }),
    [filteredItems],
  )
  const allSelected = filteredItems.length > 0 && filteredItems.every((r) => selected[r.id])
  const someSelected = items.some((r) => selected[r.id])
  const selectedIds = useMemo(() => items.filter((r) => selected[r.id]).map((r) => r.id), [items, selected])
  const selectedTotal = useMemo(
    () => items.filter((r) => selected[r.id]).reduce((s, r) => s + Number(r.total_amount || 0), 0),
    [items, selected],
  )

  const toggleAll = () => {
    if (!filteredItems.length) return
    if (allSelected) setSelected({})
    else {
      const next: Record<string, boolean> = {}
      for (const r of filteredItems) next[r.id] = true
      setSelected(next)
    }
  }

  const toggleOne = (id: string) => {
    setSelected((p) => ({ ...p, [id]: !p[id] }))
  }

  const downloadExcel = async () => {
    if (!data) return
    const generated = new Date().toLocaleString('ru-RU')
    const nf = (v: number) => Math.round(v || 0).toLocaleString('ru-RU')
    const meta = { title: 'Долги с точки', period: `Неделя ${data.weekStart} — ${data.weekEnd}`, generated, brandNote: 'дашборд долгов' }
    const cols = [
      { key: 'created', label: 'Создано', w: '13%' }, { key: 'company', label: 'Компания', w: '11%' },
      { key: 'item', label: 'Товар', w: '17%' }, { key: 'barcode', label: 'Штрихкод', w: '11%' },
      { key: 'qty', label: 'Кол-во', align: 'right' as const, w: '6%' }, { key: 'unit', label: 'Цена', align: 'right' as const, w: '8%' },
      { key: 'total', label: 'Сумма', align: 'right' as const, w: '9%' }, { key: 'cashier', label: 'Оформил', w: '11%' },
      { key: 'comment', label: 'Комментарий', w: '14%' },
    ]

    if (items.length === 0) {
      await downloadReportPdf('premium', {
        meta, kpis: [{ label: 'Сумма долгов', value: '—' }, { label: 'Позиций', value: '—' }, { label: 'Должников', value: '—' }, { label: 'Средний долг', value: '—' }],
        empty: { columns: [{ label: 'Должник' }, ...cols], message: 'Нет долгов за неделю', hint: 'Долги с точки появятся здесь.' },
      }, `Dolgi_tochki_${data.weekStart}`)
      return
    }

    const grand = items.reduce((s, r) => s + Number(r.total_amount || 0), 0)
    // по должникам
    const dMap = new Map<string, { name: string; company: string; total: number; count: number; rows: typeof items }>()
    for (const r of items) {
      const key = r.debtor_name || '—'
      let g = dMap.get(key)
      if (!g) { g = { name: key, company: r.company_name, total: 0, count: 0, rows: [] }; dMap.set(key, g) }
      g.total += Number(r.total_amount || 0); g.count += 1; g.rows.push(r)
    }
    const debtors = Array.from(dMap.values()).sort((a, b) => b.total - a.total)
    const maxDebtor = debtors[0]?.total || 1
    const avgDebt = debtors.length > 0 ? Math.round(grand / debtors.length) : 0
    // по товарам
    const itMap = new Map<string, { item: string; qty: number; total: number }>()
    for (const r of items) { const k = r.item_name || '—'; let g = itMap.get(k); if (!g) { g = { item: k, qty: 0, total: 0 }; itMap.set(k, g) } g.qty += Number(r.quantity || 0); g.total += Number(r.total_amount || 0) }
    const topItems = Array.from(itMap.values()).sort((a, b) => b.total - a.total)
    // по компаниям
    const coMap = new Map<string, number>()
    for (const r of items) coMap.set(r.company_name, (coMap.get(r.company_name) || 0) + Number(r.total_amount || 0))
    const byCompany = Array.from(coMap.entries()).map(([company, total]) => ({ company, total })).sort((a, b) => b.total - a.total)
    // динамика по дням
    const dayMap = new Map<string, number>()
    for (const r of items) { const d = r.created_at ? String(r.created_at).slice(0, 10) : '—'; dayMap.set(d, (dayMap.get(d) || 0) + Number(r.total_amount || 0)) }
    const daysAsc = Array.from(dayMap.entries()).map(([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date))
    const maxDayT = Math.max(1, ...daysAsc.map((d) => d.total))
    const peakDay = daysAsc.reduce((m, d) => (d.total > m.total ? d : m), daysAsc[0])

    await downloadReportPdf('premium', {
      meta,
      kpis: [
        { label: 'Общая сумма долгов', value: `${nf(grand)} тг`, sub: `${items.length} позиций`, badge: 'итог', tone: 'bad' },
        { label: 'Позиций', value: String(items.length), sub: `${debtors.length} должников` },
        { label: 'Должников', value: String(debtors.length), sub: debtors[0] ? `топ: ${debtors[0].name}` : '' },
        { label: 'Средний долг', value: `${nf(avgDebt)} тг`, sub: debtors[0] ? `макс ${nf(debtors[0].total)} тг` : '' },
      ],
      sections: [
        { type: 'bars', title: 'Топ должников', hint: 'по сумме', items: debtors.slice(0, 6).map((d) => ({ label: d.name, amount: d.total, ratio: d.total / maxDebtor, color: '#f97316' })) },
        { type: 'previewTable', title: 'Топ товаров в долг', hint: 'по сумме', columns: [{ key: 'item', label: 'Товар' }, { key: 'qty', label: 'Кол-во', align: 'right' }, { key: 'total', label: 'Сумма', align: 'right' }], rows: topItems.slice(0, 7).map((i) => ({ item: i.item, qty: i.qty, total: i.total })), moreNote: topItems.length > 7 ? `+ ещё ${topItems.length - 7}` : '' },
        { type: 'previewTable', title: 'Долги по компаниям', hint: 'распределение', columns: [{ key: 'company', label: 'Компания' }, { key: 'total', label: 'Сумма', align: 'right' }], rows: byCompany.slice(0, 7).map((c) => ({ company: c.company, total: c.total })) },
        { type: 'minichart', title: 'Динамика по дням', hint: 'когда брали в долг', bars: daysAsc.map((d) => ({ ratio: d.total / maxDayT, peak: peakDay && d.date === peakDay.date })), footer: peakDay ? `Пик: ${peakDay.date} — ${nf(peakDay.total)} тг` : '' },
      ],
      detail: {
        title: 'Долги по должникам',
        subtitle: 'группы по должнику, потом позиции',
        columns: cols,
        groups: debtors.map((d) => ({
          label: d.name,
          meta: `${d.count} позиций · ${d.company}`,
          total: d.total,
          rows: d.rows.map((r) => ({
            created: r.created_at ? new Date(r.created_at).toLocaleString('ru-RU') : '—',
            company: r.company_name, item: r.item_name, barcode: r.barcode || '—', qty: r.quantity,
            unit: Math.round(r.unit_price || 0), total: Math.round(r.total_amount || 0), cashier: r.created_by_name, comment: r.comment || '',
          })),
        })),
      },
    }, `Dolgi_tochki_${data.weekStart}`)
  }

  const markPaidSelected = async () => {
    if (!selectedIds.length) {
      setError('Отметьте галочками позиции для списания')
      return
    }
    const ok = window.confirm(
      `Списать ${selectedIds.length} поз. на сумму ${money(selectedTotal)}? Позиции исчезнут только с этой страницы (долги с точки). Зарплата и колонка "Долги" не изменятся.`,
    )
    if (!ok) return
    setSettling(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/point-debts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markPaid', itemIds: selectedIds }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || `Ошибка ${res.status}`)
      const skipped = json?.data?.skipped as { id: string; reason: string }[] | undefined
      if (skipped?.length) {
        setError(`Частично: не списано ${skipped.length}. Обновите страницу.`)
      }
      await load()
    } catch (e: any) {
      setError(e?.message || 'Не удалось списать')
    } finally {
      setSettling(false)
    }
  }

  return (
    <div className="app-page-wide space-y-6">
      <AdminPageHeader
        title="Долги с точки"
        description="Позиции по неделям, выгрузка и списание"
        accent="amber"
        icon={<Receipt className="h-5 w-5" aria-hidden />}
        actions={
          <>
            {canExport && (
              <Button
                type="button"
                variant="outline"
                disabled={loading || (!items.length && !legacyRows.length)}
                className="h-8 rounded-xl border-white/10 bg-white/5 text-xs text-slate-300 hover:bg-white/10"
                onClick={() => void downloadExcel()}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                PDF
              </Button>
            )}
            {canMarkPaid && (
              <Button
                type="button"
                disabled={!someSelected || settling}
                className="h-8 rounded-xl bg-amber-600 text-xs text-white hover:bg-amber-500 disabled:opacity-50"
                onClick={() => void markPaidSelected()}
              >
                {settling ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Списать выбранные ({selectedIds.length})
              </Button>
            )}
            <div className="flex rounded-xl border border-white/10 bg-black/20 p-0.5 text-xs" role="group" aria-label="Неделя">
              <button
                type="button"
                onClick={() => setWeekStart(addDaysISO(weekStart, -7))}
                className="rounded-lg px-2.5 py-1.5 text-slate-400 transition hover:text-white"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => setWeekStart(currentWeek)}
                className="rounded-lg px-2.5 py-1.5 text-slate-300 transition hover:text-white"
              >
                Сейчас
              </button>
              <button
                type="button"
                onClick={() => setWeekStart(addDaysISO(weekStart, 7))}
                className="rounded-lg px-2.5 py-1.5 text-slate-400 transition hover:text-white"
              >
                →
              </button>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-8 w-8 rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
              onClick={() => void load()}
              aria-label="Обновить"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
              Неделя:{' '}
              <span className="font-semibold text-white">
                {formatRuDate(weekStart)} — {formatRuDate(weekEnd)}
              </span>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="point-debts-company" className="text-slate-500">
                Компания:
              </label>
              <select
                id="point-debts-company"
                className="h-9 min-w-[200px] rounded-xl border border-white/10 bg-slate-900 px-3 text-sm text-white focus:border-amber-400/40 focus:outline-none focus:ring-1 focus:ring-amber-400/30 [color-scheme:dark]"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
              >
                <option value="">Все доступные</option>
                {(data?.companies || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.code || c.id}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск: должник, товар, комментарий..."
              className="h-9 min-w-[240px] rounded-xl border border-white/10 bg-slate-900 px-3 text-sm text-white placeholder:text-slate-500 focus:border-amber-400/40 focus:outline-none focus:ring-1 focus:ring-amber-400/30"
            />
            <select
              className="h-9 min-w-[200px] rounded-xl border border-white/10 bg-slate-900 px-3 text-sm text-white focus:border-amber-400/40 focus:outline-none focus:ring-1 focus:ring-amber-400/30 [color-scheme:dark]"
              value={debtorFilter}
              onChange={(e) => setDebtorFilter(e.target.value)}
            >
              <option value="">Все должники</option>
              {debtorOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {(searchQuery || debtorFilter) ? (
              <button
                type="button"
                className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-slate-300 hover:bg-white/10"
                onClick={() => {
                  setSearchQuery('')
                  setDebtorFilter('')
                }}
              >
                Сбросить фильтры
              </button>
            ) : null}
            {data ? (
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-amber-200">
                Позиций: <span className="font-semibold text-white">{data.totals.count}</span> · на сумму{' '}
                <span className="font-semibold text-white">{money(data.totals.amount)}</span>
              </span>
            ) : null}
            {data ? (
              <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-sky-200">
                По фильтру: <span className="font-semibold text-white">{filteredTotals.count}</span> ·{' '}
                <span className="font-semibold text-white">{money(filteredTotals.amount)}</span>
              </span>
            ) : null}
            {data && (data.legacyTotals?.count ?? 0) > 0 ? (
              <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-violet-200">
                Агрегат debts: <span className="font-semibold text-white">{data.legacyTotals.count}</span> ·{' '}
                <span className="font-semibold text-white">{money(data.legacyTotals.amount)}</span>
              </span>
            ) : null}
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-500">
              Неделя = понедельник по UTC (как <code className="text-slate-400">week_start</code> на точке)
            </span>
            {someSelected ? (
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-200">
                Выбрано: {money(selectedTotal)}
              </span>
            ) : null}
          </div>
        }
      />

      {error ? <Card className="border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</Card> : null}

      {data?.pointClientAggregateHint ? (
        <Card className="border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          В <code className="rounded bg-black/20 px-1">debts</code> за эту неделю есть{' '}
          <span className="font-semibold">{data.pointClientAggregateHint.count}</span> активных агрегатов на сумму{' '}
          <span className="font-semibold">{money(data.pointClientAggregateHint.amount)}</span> (
          <code className="rounded bg-black/20 px-1">point-client</code>), но позиций сканера нет. Обычно это уже исправлено
          выравниванием недели (UTC); если снова пусто — проверьте, что позиции не списаны на этой странице и{' '}
          <code className="rounded bg-black/20 px-1">week_start</code> в БД совпадает с выбранной неделей.
        </Card>
      ) : null}

      <AdminTableViewport maxHeight="min(70vh, 40rem)">
          <table className="min-w-[900px] text-sm">
            <thead className={adminTableStickyTheadClass}>
              <tr>
                <th className="px-2 py-3 text-center w-10">
                  <button
                    type="button"
                    className="text-slate-400 hover:text-white"
                    onClick={toggleAll}
                    title="Выбрать все"
                    aria-label="Выбрать все строки"
                  >
                    {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  </button>
                </th>
                <th className="px-3 py-3 text-left">Должник</th>
                <th className="px-3 py-3 text-left">Компания / точка</th>
                <th className="px-3 py-3 text-left">Товар / штрихкод</th>
                <th className="px-3 py-3 text-right">Кол-во</th>
                <th className="px-3 py-3 text-right">Цена</th>
                <th className="px-3 py-3 text-right">Сумма</th>
                <th className="px-3 py-3 text-left">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Комментарий / оформил / создано
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-slate-400">
                    <div className="inline-flex items-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Загрузка…
                    </div>
                  </td>
                </tr>
              ) : null}
              {!loading && items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-slate-400">
                    Нет активных позиций сканера (<code className="text-slate-500">point_debt_items</code>) за эту
                    неделю.
                    {legacyRows.length > 0 ? (
                      <span className="mt-2 block text-slate-500">
                        Смотрите блок ниже — есть строки в <code className="text-slate-500">debts</code> (PyQt и др.).
                      </span>
                    ) : null}
                  </td>
                </tr>
              ) : null}
              {!loading && items.length > 0 && filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                    По текущим фильтрам ничего не найдено.
                  </td>
                </tr>
              ) : null}
              {!loading
                ? filteredItems.map((r) => (
                    <tr key={r.id} className="border-t border-white/5 align-top text-slate-200">
                      <td className="px-2 py-3 text-center">
                        <button type="button" className="text-slate-400 hover:text-white" onClick={() => toggleOne(r.id)}>
                          {selected[r.id] ? <CheckSquare className="h-4 w-4 text-amber-400" /> : <Square className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-3 py-3 font-medium text-white">{r.debtor_name}</td>
                      <td className="px-3 py-3 text-xs">
                        <div className="text-slate-300">{r.company_name}</div>
                        <div className="text-slate-500">{r.point_device_name || '—'}</div>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <div className="text-white">{r.item_name}</div>
                        <div className="font-mono text-slate-500">{r.barcode || '—'}</div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.quantity}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(r.unit_price)}</td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums text-amber-200">{money(r.total_amount)}</td>
                      <td className="px-3 py-3 text-xs text-slate-500">
                        <div className="max-w-[280px] truncate text-slate-400" title={r.comment || ''}>
                          {r.comment || '—'}
                        </div>
                        <div>{r.created_by_name}</div>
                        <div>{r.created_at ? new Date(r.created_at).toLocaleString('ru-RU') : '—'}</div>
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
      </AdminTableViewport>

      {legacyRows.length > 0 ? (
        <Card className="overflow-hidden border-violet-500/20 bg-violet-950/20">
          <div className="border-b border-white/10 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Агрегат в учёте (таблица debts)</h2>
            <p className="mt-1 text-xs text-slate-400">
              Источники кроме <code className="rounded bg-white/10 px-1">point-client</code> — например PyQt. Это не
              строки сканера; списание здесь через отчётность / зарплату, не галочками на этой странице.
            </p>
          </div>
          <AdminTableViewport maxHeight="min(50vh, 22rem)">
            <table className="min-w-[720px] text-sm">
              <thead className={adminTableStickyTheadClass}>
                <tr>
                  <th className="px-4 py-3 text-left">Должник</th>
                  <th className="px-4 py-3 text-left">Компания</th>
                  <th className="px-4 py-3 text-right">Сумма</th>
                  <th className="px-4 py-3 text-left">Источник</th>
                  <th className="px-4 py-3 text-left">Комментарий</th>
                  <th className="px-4 py-3 text-left">Создано</th>
                </tr>
              </thead>
              <tbody>
                {legacyRows.map((r) => {
                  const chain = r.rolled_over_chain || []
                  const origin = chain.length > 0 ? chain[chain.length - 1] : null
                  return (
                    <tr key={r.id} className="border-t border-white/5 text-slate-200">
                      <td className="px-4 py-3 font-medium text-white">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span>{r.debtor_name}</span>
                          {origin && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border border-amber-500/40 bg-amber-500/10 text-amber-300"
                              title={`Оригинал: ${origin.week_start} (${chain.length} переноса)`}
                            >
                              🔄 перенесён с {origin.week_start.slice(5)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{r.company_name}</td>
                      <td className="px-4 py-3 text-right font-medium text-violet-200 tabular-nums">{money(r.amount)}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{r.source || '—'}</td>
                      <td className="max-w-[240px] truncate px-4 py-3 text-xs text-slate-400" title={r.comment || ''}>
                        {r.comment || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {r.created_at ? new Date(r.created_at).toLocaleString('ru-RU') : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </AdminTableViewport>
        </Card>
      ) : null}

      <Card className="border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
        <p>
          Доступ с правами как у страницы «Зарплата». Списание выбранных строк здесь влияет только на список{' '}
          <code className="rounded bg-white/10 px-1">point_debt_items</code> (информативная витрина долгов с точки) и не
          изменяет расчёты зарплаты / колонку «Долги».
        </p>
      </Card>
    </div>
  )
}
