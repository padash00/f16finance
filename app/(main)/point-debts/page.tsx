'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildStyledSheet, createWorkbook, downloadWorkbook } from '@/lib/excel/styled-export'
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
  /** Как на точке при создании долга (UTC-понедельник), иначе список пустой при сдвиге TZ. */
  const currentWeek = weekStartUtcISO(new Date())
  const [weekStart, setWeekStart] = useState(currentWeek)
  const [companyId, setCompanyId] = useState<string>('')
  const [data, setData] = useState<LoadData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [settling, setSettling] = useState(false)

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
  const allSelected = items.length > 0 && items.every((r) => selected[r.id])
  const someSelected = items.some((r) => selected[r.id])
  const selectedIds = useMemo(() => items.filter((r) => selected[r.id]).map((r) => r.id), [items, selected])
  const selectedTotal = useMemo(
    () => items.filter((r) => selected[r.id]).reduce((s, r) => s + Number(r.total_amount || 0), 0),
    [items, selected],
  )

  const toggleAll = () => {
    if (!items.length) return
    if (allSelected) setSelected({})
    else {
      const next: Record<string, boolean> = {}
      for (const r of items) next[r.id] = true
      setSelected(next)
    }
  }

  const toggleOne = (id: string) => {
    setSelected((p) => ({ ...p, [id]: !p[id] }))
  }

  const downloadExcel = async () => {
    if (!data) return
    const wb = createWorkbook()
    const rows = items.map((r) => ({
      id: r.id,
      debtor: r.debtor_name,
      company: r.company_name,
      point: r.point_device_name || '—',
      item: r.item_name,
      barcode: r.barcode || '—',
      qty: r.quantity,
      unit: Math.round(r.unit_price * 100) / 100,
      total: Math.round(r.total_amount * 100) / 100,
      comment: r.comment || '—',
      cashier: r.created_by_name,
      created: r.created_at ? new Date(r.created_at).toLocaleString('ru-RU') : '—',
      source: r.source || '—',
    }))
    buildStyledSheet(
      wb,
      'Долги точки',
      'Долги с точки (позиции)',
      `Неделя ${data.weekStart} — ${data.weekEnd} · строк: ${items.length} · сумма: ${money(data.totals.amount)}`,
      [
        { header: 'ID позиции', key: 'id', width: 38, type: 'text' },
        { header: 'Должник', key: 'debtor', width: 22, type: 'text' },
        { header: 'Компания / точка учёта', key: 'company', width: 20, type: 'text' },
        { header: 'Устройство точки', key: 'point', width: 18, type: 'text' },
        { header: 'Товар', key: 'item', width: 28, type: 'text' },
        { header: 'Штрихкод', key: 'barcode', width: 16, type: 'text' },
        { header: 'Кол-во', key: 'qty', width: 8, type: 'number', align: 'right' },
        { header: 'Цена', key: 'unit', width: 12, type: 'money' },
        { header: 'Сумма', key: 'total', width: 12, type: 'money' },
        { header: 'Комментарий', key: 'comment', width: 24, type: 'text' },
        { header: 'Оформил', key: 'cashier', width: 18, type: 'text' },
        { header: 'Создано', key: 'created', width: 20, type: 'text' },
        { header: 'Источник', key: 'source', width: 14, type: 'text' },
      ],
      rows,
    )
    if (legacyRows.length > 0) {
      const leg = legacyRows.map((r) => ({
        id: r.id,
        debtor: r.debtor_name,
        company: r.company_name,
        amount: Math.round(r.amount * 100) / 100,
        source: r.source || '—',
        comment: r.comment || '—',
        created: r.created_at ? new Date(r.created_at).toLocaleString('ru-RU') : '—',
      }))
      buildStyledSheet(
        wb,
        'debts агрегат',
        'Таблица debts (не point-client)',
        `Неделя ${data.weekStart}: PyQt и прочие источники без строк point_debt_items · ${legacyRows.length} шт. · ${money(data.legacyTotals?.amount ?? 0)}`,
        [
          { header: 'ID debts', key: 'id', width: 38, type: 'text' },
          { header: 'Должник', key: 'debtor', width: 22, type: 'text' },
          { header: 'Компания', key: 'company', width: 20, type: 'text' },
          { header: 'Сумма', key: 'amount', width: 14, type: 'money' },
          { header: 'Источник', key: 'source', width: 14, type: 'text' },
          { header: 'Комментарий', key: 'comment', width: 28, type: 'text' },
          { header: 'Создано', key: 'created', width: 20, type: 'text' },
        ],
        leg,
      )
    }
    await downloadWorkbook(wb, `point_debts_${data.weekStart}.xlsx`)
  }

  const markPaidSelected = async () => {
    if (!selectedIds.length) {
      setError('Отметьте галочками позиции для списания')
      return
    }
    const ok = window.confirm(
      `Списать ${selectedIds.length} поз. на сумму ${money(selectedTotal)}? Позиции исчезнут из долгов точки; агрегат по неделе уменьшится (как при оплате с кассы).`,
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
    <div className="mx-auto max-w-[1800px] space-y-4 px-4 pb-6 pt-4 md:px-6 md:py-6 xl:px-8">
      <AdminPageHeader
        title="Долги с точки"
        description="Позиции по неделям, выгрузка и списание"
        accent="amber"
        icon={<Receipt className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={loading || (!items.length && !legacyRows.length)}
              className="h-8 rounded-xl border-white/10 bg-white/5 text-xs text-slate-300 hover:bg-white/10"
              onClick={() => void downloadExcel()}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Excel
            </Button>
            <Button
              type="button"
              disabled={!someSelected || settling}
              className="h-8 rounded-xl bg-amber-600 text-xs text-white hover:bg-amber-500 disabled:opacity-50"
              onClick={() => void markPaidSelected()}
            >
              {settling ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Списать выбранные ({selectedIds.length})
            </Button>
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
            {data ? (
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-amber-200">
                Позиций: <span className="font-semibold text-white">{data.totals.count}</span> · на сумму{' '}
                <span className="font-semibold text-white">{money(data.totals.amount)}</span>
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
          выравниванием недели (UTC); если снова пусто — проверьте, что позиции не списаны и{' '}
          <code className="rounded bg-black/20 px-1">week_start</code> в БД совпадает с выбранной неделей.
        </Card>
      ) : null}

      <AdminTableViewport maxHeight="min(70vh, 40rem)">
          <table className="min-w-full text-sm">
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
                <th className="px-3 py-3 text-left">Компания</th>
                <th className="px-3 py-3 text-left">Точка (устр.)</th>
                <th className="px-3 py-3 text-left">Товар</th>
                <th className="px-3 py-3 text-left">Штрихкод</th>
                <th className="px-3 py-3 text-right">Кол-во</th>
                <th className="px-3 py-3 text-right">Цена</th>
                <th className="px-3 py-3 text-right">Сумма</th>
                <th className="px-3 py-3 text-left">Комментарий</th>
                <th className="px-3 py-3 text-left">Оформил</th>
                <th className="px-3 py-3 text-left">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Создано
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-16 text-center text-slate-400">
                    <div className="inline-flex items-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Загрузка…
                    </div>
                  </td>
                </tr>
              ) : null}
              {!loading && items.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-16 text-center text-slate-400">
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
              {!loading
                ? items.map((r) => (
                    <tr key={r.id} className="border-t border-white/5 align-top text-slate-200">
                      <td className="px-2 py-3 text-center">
                        <button type="button" className="text-slate-400 hover:text-white" onClick={() => toggleOne(r.id)}>
                          {selected[r.id] ? <CheckSquare className="h-4 w-4 text-amber-400" /> : <Square className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-3 py-3 font-medium text-white">{r.debtor_name}</td>
                      <td className="px-3 py-3 text-slate-300">{r.company_name}</td>
                      <td className="px-3 py-3 text-slate-400">{r.point_device_name || '—'}</td>
                      <td className="px-3 py-3 text-white">{r.item_name}</td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-400">{r.barcode || '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.quantity}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(r.unit_price)}</td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums text-amber-200">{money(r.total_amount)}</td>
                      <td className="max-w-[200px] truncate px-3 py-3 text-xs text-slate-400" title={r.comment || ''}>
                        {r.comment || '—'}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-400">{r.created_by_name}</td>
                      <td className="px-3 py-3 text-xs text-slate-500">
                        {r.created_at ? new Date(r.created_at).toLocaleString('ru-RU') : '—'}
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
            <table className="min-w-full text-sm">
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
                {legacyRows.map((r) => (
                  <tr key={r.id} className="border-t border-white/5 text-slate-200">
                    <td className="px-4 py-3 font-medium text-white">{r.debtor_name}</td>
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
                ))}
              </tbody>
            </table>
          </AdminTableViewport>
        </Card>
      ) : null}

      <Card className="border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
        <p>
          Доступ с правами как у страницы «Зарплата». Списание выбранных строк повторяет логику оплаты с кассы: позиции
          помечаются закрытыми, недельный агрегат <code className="rounded bg-white/10 px-1">debts</code> уменьшается. Для
          полного закрытия всех долгов оператора за неделю по-прежнему можно использовать кнопку на странице зарплаты.
        </p>
      </Card>
    </div>
  )
}
