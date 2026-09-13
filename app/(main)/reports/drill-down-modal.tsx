'use client'

/** Детализация операций /reports: модалка по клику на карточку, график или статью. */

import { useMemo, useState } from 'react'
import { AppModal } from '@/components/ui/app-modal'
import { NativeSelect } from '@/components/ui/native-select'
import { Input } from '@/components/ui/input'
import { useCashlessLabels } from '@/lib/client/use-cashless-labels'
import { Search } from 'lucide-react'
import { SHIFT_LABELS, fromISO, formatMoneyFull, formatMoneyCompact } from './report-shared'
import type { IncomeRow, ExpenseRow, Company } from './report-shared'

export type DrillDownType = 'income' | 'expense' | 'profit'

/** Что открыть в детализации: по умолчанию весь период, либо срез из клика по графику или статье. */
export type DrillDownState = {
  type: DrillDownType
  from?: string
  to?: string
  /** Только эти категории расходов (клик по статье) */
  categories?: string[]
  /** Точка, выбранная в фильтре модалки сразу (клик по столбцу компании) */
  companyId?: string
  title?: string
}

export const DRILL_TITLES: Record<DrillDownType, string> = {
  income: 'Доходы — детализация',
  expense: 'Расходы — детализация',
  profit: 'Доходы и расходы — детализация',
}

export function SortIcon({ f, sortField, sortDir }: { f: string; sortField: string; sortDir: string }) {
  return sortField === f ? (
    <span className="ml-1 text-amber-400">{sortDir === 'asc' ? '↑' : '↓'}</span>
  ) : (
    <span className="ml-1 text-slate-600">↕</span>
  )
}

export function DrillDownModal({
  type,
  incomes,
  expenses,
  companies,
  companyName,
  dateFrom,
  dateTo,
  loading,
  categories,
  initialCompanyId,
  title,
  onClose,
}: {
  type: DrillDownType
  incomes: IncomeRow[]
  expenses: ExpenseRow[]
  companies: Company[]
  companyName: (id: string) => string
  dateFrom: string
  dateTo: string
  /** Строки периода ещё догружаются */
  loading: boolean
  categories?: string[]
  initialCompanyId?: string
  title?: string
  onClose: () => void
}) {
  const cashLabels = useCashlessLabels()
  const [filterCompany, setFilterCompany] = useState<'all' | string>(initialCompanyId ?? 'all')
  const categorySet = useMemo(() => (categories ? new Set(categories) : null), [categories])
  const [sortField, setSortField] = useState<'date' | 'company' | 'amount'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const result: Array<{
      id: string
      date: string
      type: 'income' | 'expense'
      companyId: string
      companyName: string
      amount: number
      cash: number
      kaspi: number
      label: string
    }> = []

    if (type === 'income' || type === 'profit') {
      for (const r of incomes) {
        if (r.date < dateFrom || r.date > dateTo) continue // только текущий период
        const amount = (r.cash_amount ?? 0) + (r.kaspi_amount ?? 0) + (r.online_amount ?? 0) + (r.card_amount ?? 0)
        result.push({
          id: r.id,
          date: r.date,
          type: 'income',
          companyId: r.company_id,
          companyName: companyName(r.company_id),
          amount,
          cash: r.cash_amount ?? 0,
          kaspi: r.kaspi_amount ?? 0,
          label: [r.zone, r.shift ? SHIFT_LABELS[r.shift] : null, r.comment].filter(Boolean).join(' · ') || '—',
        })
      }
    }

    if (type === 'expense' || type === 'profit') {
      for (const r of expenses) {
        if (r.date < dateFrom || r.date > dateTo) continue // только текущий период
        // Клик по статье: только её категории (имена — как в разбивке по статьям)
        if (categorySet && !categorySet.has(String(r.category || '').trim() || 'Без категории')) continue
        const amount = (r.cash_amount ?? 0) + (r.kaspi_amount ?? 0)
        result.push({
          id: r.id,
          date: r.date,
          type: 'expense',
          companyId: r.company_id,
          companyName: companyName(r.company_id),
          amount,
          cash: r.cash_amount ?? 0,
          kaspi: r.kaspi_amount ?? 0,
          label: r.category || r.comment || '—',
        })
      }
    }

    return result
  }, [type, incomes, expenses, companyName, dateFrom, dateTo, categorySet])

  const filtered = useMemo(() => {
    let r = rows
    if (filterCompany !== 'all') r = r.filter((x) => x.companyId === filterCompany)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      r = r.filter((x) =>
        x.companyName.toLowerCase().includes(q) ||
        x.label.toLowerCase().includes(q) ||
        x.date.includes(q)
      )
    }
    return [...r].sort((a, b) => {
      let v = 0
      if (sortField === 'date') v = a.date.localeCompare(b.date)
      else if (sortField === 'company') v = a.companyName.localeCompare(b.companyName)
      else if (sortField === 'amount') v = a.amount - b.amount
      return sortDir === 'asc' ? v : -v
    })
  }, [rows, filterCompany, search, sortField, sortDir])

  const totalIncome = filtered.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0)
  const totalExpense = filtered.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0)

  const toggleSort = (f: typeof sortField) => {
    if (sortField === f) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortField(f); setSortDir('desc') }
  }

  // Esc, клик по фону, блокировка прокрутки и фокус — забота общего AppModal.
  return (
    <AppModal open onClose={onClose} maxWidth="max-w-5xl" title={title ?? DRILL_TITLES[type]}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <NativeSelect
            value={filterCompany}
            onChange={(e) => setFilterCompany(e.target.value)}
            className="w-auto min-w-[180px]"
          >
            <option value="all">Все компании</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </NativeSelect>

          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по компании, категории…"
              className="pl-9"
            />
          </div>

          <span className="text-xs text-muted-foreground ml-auto">{filtered.length} записей</span>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-border bg-slate-50 px-4 py-2.5 text-sm dark:bg-white/[0.03]">
          {(type === 'income' || type === 'profit') && (
            <span>Доходы: <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatMoneyFull(totalIncome)}</span></span>
          )}
          {(type === 'expense' || type === 'profit') && (
            <span>Расходы: <span className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">{formatMoneyFull(totalExpense)}</span></span>
          )}
          {type === 'profit' && (
            <span>Прибыль: <span className={`font-semibold tabular-nums ${totalIncome - totalExpense >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{formatMoneyFull(totalIncome - totalExpense)}</span></span>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm z-10">
              <tr className="text-muted-foreground border-b border-slate-200 dark:border-white/5">
                <th
                  className="text-left px-4 py-3 font-medium cursor-pointer hover:text-slate-900 dark:hover:text-white select-none whitespace-nowrap"
                  onClick={() => toggleSort('date')}
                >
                  Дата <SortIcon f="date" sortField={sortField} sortDir={sortDir} />
                </th>
                <th
                  className="text-left px-4 py-3 font-medium cursor-pointer hover:text-slate-900 dark:hover:text-white select-none"
                  onClick={() => toggleSort('company')}
                >
                  Компания <SortIcon f="company" sortField={sortField} sortDir={sortDir} />
                </th>
                {type === 'profit' && (
                  <th className="text-left px-4 py-3 font-medium">Тип</th>
                )}
                <th className="text-left px-4 py-3 font-medium">Категория / смена</th>
                <th className="text-right px-4 py-3 font-medium">Нал</th>
                <th className="text-right px-4 py-3 font-medium">{cashLabels.providerName}</th>
                <th
                  className="text-right px-4 py-3 font-medium cursor-pointer hover:text-slate-900 dark:hover:text-white select-none"
                  onClick={() => toggleSort('amount')}
                >
                  Итого <SortIcon f="amount" sortField={sortField} sortDir={sortDir} />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={type === 'profit' ? 7 : 6} className="text-center py-16 text-muted-foreground">
                    {loading ? 'Загружаю операции…' : 'Нет данных'}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr
                    key={`${row.type}-${row.id}`}
                    className="border-b border-slate-100 dark:border-white/5 hover:bg-surface-muted transition-colors"
                  >
                    <td className="px-4 py-2.5 text-body whitespace-nowrap">
                      {fromISO(row.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-2.5 text-foreground font-medium">{row.companyName}</td>
                    {type === 'profit' && (
                      <td className="px-4 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          row.type === 'income'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-rose-500/20 text-rose-400'
                        }`}>
                          {row.type === 'income' ? 'Доход' : 'Расход'}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-muted-foreground max-w-[200px] truncate">{row.label}</td>
                    <td className="px-4 py-2.5 text-right text-body">{row.cash > 0 ? formatMoneyCompact(row.cash) : '—'}</td>
                    <td className="px-4 py-2.5 text-right text-body">{row.kaspi > 0 ? formatMoneyCompact(row.kaspi) : '—'}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${
                      row.type === 'income' ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {row.type === 'expense' ? '−' : ''}{formatMoneyFull(row.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppModal>
  )
}
